"""Activity Monitor validation including root speech services via Instruments."""
import json
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"out/asr-benchmark-2026-10-14/resources"

def main():
    for engine in ("sherpa","speech"):
        stem=engine+"-system"
        command=["xcrun","xctrace","record","--template","Activity Monitor","--all-processes","--time-limit","30s","--output",str(OUT/(stem+".trace"))]
        with (OUT/(stem+".stdout")).open("w") as stdout, (OUT/(stem+".stderr")).open("w") as stderr:
            trace=subprocess.Popen(command,stdout=stdout,stderr=stderr)
            time.sleep(4)
            if trace.poll() is not None:
                raise RuntimeError("Instruments failed to start")
            if engine=="sherpa":
                worker=[str(ROOT/".venv/bin/python"),str(ROOT/"scripts/asr-benchmark/resource_sherpa_worker.py"),str(OUT/"workload.json")]
            else:
                worker=[str(OUT.parent/"apple-speech-resources"),str(OUT/"workload.json"),engine,"bulk","resources"]
            with (OUT/(stem+"-worker.jsonl")).open("w") as wout, (OUT/(stem+"-worker.stderr")).open("w") as werr:
                run=subprocess.run(worker,stdout=wout,stderr=werr,timeout=25)
            if run.returncode:
                raise RuntimeError("Worker failed")
            if trace.wait(timeout=40):
                raise RuntimeError("Instruments failed")
        results=[json.loads(line) for line in (OUT/(stem+"-worker.jsonl")).read_text().splitlines()]
        assert sum(r.get("type")=="result" for r in results)==100
        subprocess.run(["xcrun","xctrace","export","--input",str(OUT/(stem+".trace")),"--xpath",'/trace-toc/run[@number="1"]/data/table[@schema="activity-monitor-process-live"]',"--output",str(OUT/(stem+"-memory.xml"))],check=True,stdout=subprocess.DEVNULL,timeout=45)
        print("Completed all-process Activity Monitor validation",engine,flush=True)

if __name__=="__main__":
    main()
