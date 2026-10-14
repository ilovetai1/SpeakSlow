"""macOS physical footprint / CPU accounting for clients and speech XPC services.

Uses proc_pid_rusage (not RSS). CPU units are calibrated against getrusage;
this host returns Mach ticks. No app settings, microphones or secrets accessed.
"""
import ctypes
import ctypes.util
import json
import os
from pathlib import Path
import queue
import resource
import statistics
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "out/asr-benchmark-2026-10-14/resources"
OUT.mkdir(parents=True, exist_ok=True)
PROC = ctypes.CDLL(ctypes.util.find_library("proc"),use_errno=True)
PROC.proc_pid_rusage.argtypes = [ctypes.c_int,ctypes.c_int,ctypes.c_void_p]
PROC.proc_pid_rusage.restype = ctypes.c_int

def raw_usage(pid):
    buf = (ctypes.c_uint64 * 64)()
    if PROC.proc_pid_rusage(pid,4,ctypes.byref(buf)):
        return {"error":ctypes.get_errno()}
    return dict(cpu_raw=buf[2]+buf[3], footprint_bytes=buf[9], rss_bytes=buf[8])

def calibrate():
    before = raw_usage(os.getpid())
    r = resource.getrusage(resource.RUSAGE_SELF)
    c0 = r.ru_utime+r.ru_stime
    start = time.monotonic()
    while time.monotonic()-start < .25:
        pass
    after = raw_usage(os.getpid())
    r = resource.getrusage(resource.RUSAGE_SELF)
    cpu = r.ru_utime+r.ru_stime-c0
    class Timebase(ctypes.Structure):
        _fields_=[("numer",ctypes.c_uint32),("denom",ctypes.c_uint32)]
    tb=Timebase()
    ctypes.CDLL("/usr/lib/libSystem.B.dylib").mach_timebase_info(ctypes.byref(tb))
    candidates = {"nanoseconds":1e-9,"mach_ticks":tb.numer/tb.denom*1e-9}
    delta = after["cpu_raw"]-before["cpu_raw"]
    unit = min(candidates,key=lambda key:abs(delta*candidates[key]-cpu))
    assert abs(delta*candidates[unit]-cpu) < .01
    return dict(unit=unit,seconds_per_unit=candidates[unit],getrusage_delta_s=cpu,proc_delta_raw=delta,mach_numer=tb.numer,mach_denom=tb.denom)

def processes():
    output=subprocess.check_output(["ps","-axo","pid=,ppid=,comm="],text=True)
    result={}
    for line in output.splitlines():
        parts=line.strip().split(None,2)
        if len(parts)==3:
            result[int(parts[0])]=dict(ppid=int(parts[1]),path=parts[2])
    return result

def is_service(path):
    name=Path(path).name.lower()
    return any(term in name for term in ("speech","coreml","anecompiler","modelmanagerd","modelcatalogd")) or name=="aned"

def scopes(inventory,client=None):
    result={}
    for pid,item in inventory.items():
        if is_service(item["path"]):
            result[pid]=dict(item,scope="service")
        elif item["path"].startswith("/Applications/SpeakSlow.app/"):
            result[pid]=dict(item,scope="existing_app")
    if client is not None:
        children={client}
        for _ in range(3):
            children.update(pid for pid,item in inventory.items() if item["ppid"] in children)
        for pid in children:
            result[pid]=dict(inventory.get(pid,dict(ppid=0,path="worker")),scope="client")
    return result

def sample(selected,phase):
    rows=[]
    for pid,item in selected.items():
        rows.append(dict(pid=pid,**item,**raw_usage(pid)))
    return dict(t=time.monotonic(),phase=phase,processes=rows)

def capture(engine,repeat,manifest,unit):
    stem=f"{repeat}-{engine}"
    items=json.loads(manifest.read_text())
    selected=scopes(processes())
    observations=[]
    # Baseline services and installed app remain running; do not stop user processes.
    for _ in range(10):
        observations.append(sample(selected,"baseline"))
        time.sleep(.1)
    if engine=="sherpa":
        command=[str(ROOT/".venv/bin/python"),str(ROOT/"scripts/asr-benchmark/resource_sherpa_worker.py"),str(manifest)]
    else:
        command=[str(ROOT/"out/asr-benchmark-2026-10-14/apple-speech-resources"),str(manifest),engine,"bulk","resources"]
    pending=queue.Queue()
    phases={}
    events=[]
    with (OUT/(stem+".stderr")).open("w") as err, (OUT/(stem+".jsonl")).open("w") as raw:
        child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1)
        def reader():
            for line in child.stdout:
                raw.write(line);raw.flush()
                try: pending.put(json.loads(line))
                except json.JSONDecodeError: pending.put(dict(type="parse_error",line=line))
        thread=threading.Thread(target=reader,daemon=True)
        thread.start()
        phase="load"
        refresh=0
        started=time.monotonic()
        while child.poll() is None or not pending.empty():
            if time.monotonic()-started>180:
                child.kill()
                raise RuntimeError("Resource worker timed out")
            changed=False
            while not pending.empty():
                event=pending.get()
                events.append(event)
                if event.get("type")=="phase":
                    phase=event["phase"]
                    changed=True
            if changed or time.monotonic()-refresh>1:
                selected=scopes(processes(),child.pid)
                refresh=time.monotonic()
            observation=sample(selected,phase)
            observations.append(observation)
            if changed:
                phases[phase]=observation
            time.sleep(.1)
        thread.join(timeout=2)
        if child.returncode!=0 or any(e.get("type") in ("error","parse_error") for e in events):
            raise RuntimeError(f"{stem} failed; inspect captured output")
    for _ in range(20):
        observations.append(sample(scopes(processes()),"after_exit"))
        time.sleep(.1)
    if sum(e.get("type")=="result" for e in events)!=len(items):
        raise RuntimeError(f"{stem}: result count mismatch")
    payload=dict(engine=engine,repeat=repeat,pid=child.pid,audio_s=sum(i["duration_s"] for i in items),clips=len(items),cpu_unit=unit,observations=observations,phases=phases)
    (OUT/(stem+"-samples.json")).write_text(json.dumps(payload,ensure_ascii=False))
    print("Completed resource measurement",stem,flush=True)
    return payload

def summarize(runs,unit):
    results=[]
    for run in runs:
        def total(sample,scope):
            return sum(p.get("footprint_bytes",0) for p in sample["processes"] if p["scope"]==scope)
        def phase_values(phase,scope):
            return [total(s,scope) for s in run["observations"] if s["phase"]==phase]
        begin=run["phases"]["workload"]
        end=run["phases"]["post_idle"]
        seconds=end["t"]-begin["t"]
        before={p["pid"]:p for p in begin["processes"] if "cpu_raw" in p}
        after={p["pid"]:p for p in end["processes"] if "cpu_raw" in p}
        by_process=[]
        for pid,p in after.items():
            if pid in before:
                by_process.append(dict(pid=pid,scope=p["scope"],path=p["path"],cpu_s=(p["cpu_raw"]-before[pid]["cpu_raw"])*unit["seconds_per_unit"],begin_footprint_bytes=before[pid]["footprint_bytes"],end_footprint_bytes=p["footprint_bytes"]))
        workload=[s for s in run["observations"] if s["phase"]=="workload"]
        clients=sum(p["cpu_s"] for p in by_process if p["scope"]=="client")
        services=sum(p["cpu_s"] for p in by_process if p["scope"]=="service")
        peak_cpu=[]
        for prev,current in zip(workload,workload[1:]):
            previous={p["pid"]:p for p in prev["processes"] if "cpu_raw" in p and p["scope"] in ("client","service")}
            delta=sum(p["cpu_raw"]-previous[p["pid"]]["cpu_raw"] for p in current["processes"] if p["pid"] in previous and "cpu_raw" in p)
            peak_cpu.append(delta*unit["seconds_per_unit"]/(current["t"]-prev["t"])*100)
        result=dict(engine=run["engine"],repeat=run["repeat"],wall_s=seconds,audio_s=run["audio_s"],client_cpu_s=clients,service_cpu_s=services,combined_cpu_s=clients+services,cpu_s_per_audio_minute=(clients+services)/run["audio_s"]*60,combined_mean_cpu_percent=(clients+services)/seconds*100,sampled_peak_cpu_percent=max(peak_cpu),client_peak_mib=max(total(s,"client") for s in workload)/2**20,service_peak_mib=max(total(s,"service") for s in workload)/2**20,combined_peak_mib=max(total(s,"client")+total(s,"service") for s in workload)/2**20,service_baseline_mib=statistics.median(phase_values("baseline","service"))/2**20,ready_client_mib=statistics.median(phase_values("ready_idle","client"))/2**20,post_client_mib=statistics.median(phase_values("post_idle","client"))/2**20,post_services_mib=statistics.median(phase_values("post_idle","service"))/2**20,after_exit_services_mib=statistics.median(phase_values("after_exit","service"))/2**20,process_cpu=sorted(by_process,key=lambda p:-p["cpu_s"]),read_errors=[dict(pid=p["pid"],scope=p["scope"],error=p["error"]) for s in run["observations"] for p in s["processes"] if "error" in p and p["scope"]=="service"])
        results.append(result)
    (OUT/"summary.json").write_text(json.dumps(dict(unit_calibration=unit,runs=results),ensure_ascii=False,indent=2))
    for r in results:
        print(json.dumps({k:v for k,v in r.items() if k not in ("process_cpu","read_errors")},ensure_ascii=False),flush=True)

def main():
    unit=calibrate()
    (OUT/"cpu-calibration.json").write_text(json.dumps(unit,indent=2))
    inventory=processes()
    snapshot=sample(scopes(inventory),"existing_app_baseline")
    (OUT/"existing-app-baseline.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2))
    items=json.loads((OUT.parent/"manifest.json").read_text())
    manifest=OUT/"workload.json"
    manifest.write_text(json.dumps(items*2,ensure_ascii=False))
    runs=[]
    for repeat in range(3):
        engines=("sherpa","speech","speech-fast","dictation") if repeat%2==0 else ("dictation","speech-fast","speech","sherpa")
        for engine in engines:
            runs.append(capture(engine,repeat,manifest,unit))
            summarize(runs,unit)

if __name__=="__main__":
    main()
