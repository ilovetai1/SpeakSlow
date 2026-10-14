"""Summarize Instruments ANE/GPU evidence and protected-service validation."""
from collections import defaultdict
import json
from pathlib import Path
import xml.etree.ElementTree as ET

OUT=Path(__file__).resolve().parents[2]/"out/asr-benchmark-2026-10-14/resources"

def table(path):
    tree=ET.parse(path)
    ids={e.attrib["id"]:e for e in tree.iter() if "id" in e.attrib}
    def resolve(element):
        while "ref" in element.attrib:
            element=ids[element.attrib["ref"]]
        return element
    return tree,resolve

def main():
    result={"ane":{},"gpu":{},"protected_services":{}}
    for engine in ("speech","sherpa"):
        tree,resolve=table(OUT/(engine+"-ane.xml"))
        labels=[]
        for row in tree.iter("row"):
            element=resolve(list(row)[4])
            labels.append(element.attrib.get("fmt",""))
        result["ane"][engine]=dict(events=len(labels),labels_sample=sorted(set(labels))[:8],scope="ANE activity intervals include model loading and inference; not a utilization percentage or count of transcriptions")
        tree,resolve=table(OUT/(engine+"-system-memory.xml"))
        updates=defaultdict(dict)
        cpu=defaultdict(list)
        names=set()
        missing=0
        for row in tree.iter("row"):
            cells=list(row)
            name=resolve(cells[1]).attrib.get("fmt","")
            if not any(key in name.lower() for key in ("aned (","modelmanagerd","modelcatalogd","anecompilerservice","corespeechd_system")):
                continue
            footprint=resolve(cells[10])
            if footprint.text is None:
                missing+=1
                continue
            updates[int(resolve(cells[0]).text)][name]=float(footprint.text)
            names.add(name)
            cpu_time=resolve(cells[7])
            if cpu_time.text is not None:
                cpu[name].append(float(cpu_time.text)/1e9)
        assert len(names)==5 and not missing
        # Live rows may be emitted at different times for each process. Carry the
        # latest known value forward, rather than summing only simultaneous rows.
        latest={}
        memory=[]
        for timestamp,values in sorted(updates.items()):
            latest.update(values)
            if len(latest)==len(names):
                memory.append(sum(latest.values()))
        result["protected_services"][engine]=dict(processes=sorted(names),peak_mib=max(memory)/2**20,min_mib=min(memory)/2**20,total_cpu_delta_s=sum(max(values)-min(values) for values in cpu.values()),scope="One all-process Activity Monitor trace, 30s including startup, workload, idle and pre-existing shared services; separate from the three main trials; latest per-process values carried forward")
    tree,resolve=table(OUT/"speech-gpu.xml")
    scopes=set()
    for row in tree.iter("row"):
        name=resolve(list(row)[10]).attrib.get("fmt","")
        if name:
            scopes.add(name)
    result["gpu"]=dict(observed_processes=sorted(scopes),engine_gpu_attribution="No rows attributed to apple-speech-resources or localspeechrecognition in this trace. UI/WindowServer GPU events exist. This does not establish zero GPU use under every configuration.")
    (OUT/"hardware-summary.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
    lines=["Instruments 硬體與受保護服務補測", "", f"Apple 新版：ANE 活動記錄 {result['ane']['speech']['events']} 筆；Paraformer CPU 對照：{result['ane']['sherpa']['events']} 筆。", "ANE 表格包含模型載入與推論階段，筆數不等於辨識次數；沒有把它換算成 ANE 使用率或耗電。", "", "GPU 追蹤有 WindowServer、SpeakSlow Helper (GPU) 等介面工作；沒有可歸屬到 Apple 辨識呼叫端或 localspeechrecognition 的 GPU 列。", "不能據此宣稱所有情境 GPU 都為零。", "", "主測試直接讀不到的5個 root 系統服務，另透過 Instruments Activity Monitor 全程序追蹤補查："]
    for engine in ("sherpa","speech"):
        r=result["protected_services"][engine]
        lines.append(f"{engine}: physical footprint 合計 {r['min_mib']:.2f}–{r['peak_mib']:.2f} MiB；整段30秒CPU累計變化 {r['total_cpu_delta_s']:.3f} 秒。")
    lines += ["", "這5個服務包含既有共用快取；屬另一輪驗證，不能直接加到主表三輪中位數，當作同一時刻精確總量。", "受保護服務的程序帳務在這次補測中沒有大到改變記憶體比較方向；驅動層與全機功耗仍未完整計入。", "", "原始證據：speech-ane.xml、sherpa-ane.xml、speech-gpu.xml、speech-system-memory.xml、sherpa-system-memory.xml 及對應 .trace。"]
    (OUT/"hardware-report.txt").write_text("\n".join(lines)+"\n")
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
