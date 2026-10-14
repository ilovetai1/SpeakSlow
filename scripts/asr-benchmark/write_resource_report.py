"""Aggregate measured resource results; explicitly retain access limitations."""
import json
from pathlib import Path
import statistics

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"out/asr-benchmark-2026-10-14/resources"
NAMES={"sherpa":"目前 Paraformer / CPU","speech":"Apple SpeechTranscriber 預設","speech-fast":"Apple SpeechTranscriber fastResults","dictation":"Apple DictationTranscriber"}

def clean_samples(value):
    if isinstance(value,dict):
        # Only footprint, RSS, CPU and process metadata are used in this experiment.
        # Omit unused experimental counters from initial sampling revisions.
        return {k:clean_samples(v) for k,v in value.items() if k not in ("lifetime_peak_bytes","instructions","cycles")}
    if isinstance(value,list):
        return [clean_samples(v) for v in value]
    return value

def main():
    summary=json.loads((OUT/"summary.json").read_text())
    assert len(summary["runs"])==12
    baseline=clean_samples(json.loads((OUT/"existing-app-baseline.json").read_text()))
    (OUT/"existing-app-baseline.json").write_text(json.dumps(baseline,ensure_ascii=False,indent=2))
    data=[]
    denied={}
    for engine,name in NAMES.items():
        runs=[r for r in summary["runs"] if r["engine"]==engine]
        assert len(runs)==3 and {r["repeat"] for r in runs}=={0,1,2}
        samples=[]
        for run in runs:
            path=OUT/f"{run['repeat']}-{engine}-samples.json"
            sample=clean_samples(json.loads(path.read_text()))
            path.write_text(json.dumps(sample,ensure_ascii=False))
            samples.append(sample)
            for record in sample["observations"]:
                for proc in record["processes"]:
                    if "error" in proc and proc["error"]==1:
                        denied[proc["path"]]=proc["error"]
        def total(record,scopes):
            return sum(p["footprint_bytes"] for p in record["processes"] if p["scope"] in scopes and "footprint_bytes" in p)/2**20
        def median(key):
            return statistics.median(r[key] for r in runs)
        startup=[max(total(o,("client","service")) for o in sample["observations"] if o["phase"] not in ("baseline","after_exit")) for sample in samples]
        ready=[statistics.median(total(o,("client","service")) for o in sample["observations"] if o["phase"]=="ready_idle") for sample in samples]
        post=[statistics.median(total(o,("client","service")) for o in sample["observations"] if o["phase"]=="post_idle") for sample in samples]
        data.append(dict(engine=engine,name=name,client_peak_mib=median("client_peak_mib"),accessible_combined_peak_mib=median("combined_peak_mib"),combined_peak_range_mib=[min(r["combined_peak_mib"] for r in runs),max(r["combined_peak_mib"] for r in runs)],ready_combined_mib=statistics.median(ready),post_combined_mib=statistics.median(post),max_including_load_mib=statistics.median(startup),combined_cpu_s=median("combined_cpu_s"),cpu_s_per_audio_minute=median("cpu_s_per_audio_minute"),mean_cpu_percent=median("combined_mean_cpu_percent"),sampled_peak_cpu_percent=median("sampled_peak_cpu_percent"),audio_s=runs[0]["audio_s"],workload_wall_s=median("wall_s")))
    installed=[p for p in baseline["processes"] if p["scope"]=="existing_app" and "footprint_bytes" in p]
    backend=sum(p["footprint_bytes"] for p in installed if Path(p["path"]).name=="sherpa_server")/2**20
    ui=sum(p["footprint_bytes"] for p in installed if Path(p["path"]).name!="sherpa_server")/2**20
    hardware_path=OUT/"hardware-summary.json"
    hardware=json.loads(hardware_path.read_text()) if hardware_path.exists() else None
    output=dict(groups=data,installed_idle_snapshot=dict(total_mib=backend+ui,backend_mib=backend,frontend_helpers_mib=ui,processes=len(installed)),unreadable_services=sorted(denied),scope="Main three-trial table: accessible client + speech/ML services subtotal. Protected root services validated separately via Instruments; driver allocations and full system power remain excluded",hardware_trace=hardware)
    (OUT/"aggregate.json").write_text(json.dumps(output,ensure_ascii=False,indent=2))
    lines=["SpeakSlow 語音引擎：記憶體與硬體資源實測", "2026-10-14；Apple M5，16 GiB RAM，macOS 27.0.1。", "", "工作量：同一批 50 份台灣中文音檔循環兩次，共 100 次辨識、462.696 秒音訊；每種引擎跑三輪。", "本表為批次辨識資源成本，沒有測整段實時麥克風錄音。", "記憶體：每約 100ms 讀取 proc_pid_rusage 的 physical footprint，含壓縮記憶體的程序帳務值；不是 RSS 或虛擬記憶體。", "CPU：累積 user + system time，已用 getrusage 驗證這台主機回傳 Mach ticks（125/3 ns）。", "100% CPU = 一個核心；此機有 10 個 CPU 核心。CPU 秒可超過經過的實際秒數。", "", "注意：Apple 模型在 localspeechrecognition 等系統服務運作，必須把呼叫端與服務一起看。", "下列為可讀程序小計。受保護的 root 服務、驅動層配置與全部機器成本未完整納入；不得稱為全系統總量。", "", "三輪中位數：", "引擎 | 呼叫端工作期記憶體高點 | 可讀程序工作期合計高點 | 100次辨識CPU秒 | 每分鐘音訊CPU秒 | 工作期平均CPU"]
    for g in data:
        lines.append(f"{g['name']} | {g['client_peak_mib']:.1f} MiB | {g['accessible_combined_peak_mib']:.1f} MiB | {g['combined_cpu_s']:.2f} s | {g['cpu_s_per_audio_minute']:.2f} s | {g['mean_cpu_percent']:.0f}%")
    lines += ["", "記憶體階段（相同可讀程序小計，三輪中位數）：", "引擎 | 模型準備後閒置 | 工作期高點範圍 | 含初始化/暖身的整段高點 | 完成後5秒保留"]
    for g in data:
        lo,hi=g["combined_peak_range_mib"]
        lines.append(f"{g['name']} | {g['ready_combined_mib']:.1f} MiB | {lo:.1f}–{hi:.1f} MiB | {g['max_including_load_mib']:.1f} MiB | {g['post_combined_mib']:.1f} MiB")
    lines += ["", "正在執行的已安裝 SpeakSlow（一次閒置快照）：", f"共 {len(installed)} 個程序，physical footprint 合計 {backend+ui:.1f} MiB（{(backend+ui)/1024:.2f} GiB）。", f"辨識後端 {backend:.1f} MiB；Electron 主程序、視窗與 GPU 等輔助程序 {ui:.1f} MiB。", "這是既有實際應用的快照；不可拿它直接與 Apple CLI 比較。替換辨識後端不會自動消除 Electron 與多視窗成本。", "", "限制：", "1. physical footprint 是各程序的記憶體帳務值；不等於全機唯一實體 RAM，乾淨檔案映射及驅動層可能不在此值內。", "2. 部分共用服務在測試前已存在。可讀程序小計包含其原本保留量，不代表全部都是本次新增。", "3. 已安裝 SpeakSlow 全程保留執行；其資源從引擎測試小計排除，沒有關閉使用者程序。", "4. Apple 模型以 processLifetime 保留於測試程序生命週期，完成後在相同程序觀察5秒，退出後另觀察2秒。不是長期背景服務測試。", "5. 工作期高點是100ms取樣高點，可能漏掉更短暫的尖峰；初始化和暖身高點另列。", "6. 新版預設/快速模式分別測量；資源差異不能取代準確度評估。", "7. powermetrics 需要管理員權限，現有非互動授權不可用；未取得mW、耗電量或電池續航數字。", "8. 未讀到下列受保護服務的完整 CPU/記憶體："]
    lines += ["  "+p for p in sorted(denied)]
    if hardware:
        lines += ["", "Instruments 補測結果（另一輪，詳 hardware-report.txt）：", "直接 API 讀不到的5個受保護服務，已透過 Activity Monitor 的全程序追蹤補查。主表三輪數值仍維持原本取樣範圍，不把不同輪次的高點當成同時總量。"]
        for engine in ("sherpa","speech"):
            h=hardware["protected_services"][engine]
            lines.append(f"{engine}：受保護服務合計 {h['min_mib']:.2f}–{h['peak_mib']:.2f} MiB；整段30秒 CPU 變化 {h['total_cpu_delta_s']:.3f} 秒。")
        lines += [f"Apple 新版有 {hardware['ane']['speech']['events']} 筆 ANE 活動記錄，Paraformer CPU 對照為 {hardware['ane']['sherpa']['events']} 筆；不是利用率或推論次數。", "GPU 表格可見 SpeakSlow 介面等繪圖工作，未觀察到可歸屬於 Apple 語音呼叫端或 localspeechrecognition 的 GPU 列。", "這次受保護服務的程序帳務沒有改變資源比較方向；全機功耗、電池續航與驅動層配置仍未完整量測。", "", "工程判讀：若以此次資源效率為優先，Apple 新版預設較有優勢。要把收益帶進產品，Apple 模式應避免同時常駐 Sherpa 後端；Electron 介面成本則需另行處理。", "準確度沿用前一份報告，Apple 新版並未在保留繁體字形的分數上勝出；本次資源優勢不能當成準確度優勢。"]
    lines += ["", "資料：summary.json、aggregate.json、*-samples.json、existing-app-baseline.json、cpu-calibration.json。", "原始碼：scripts/asr-benchmark/measure_resources.py、resource_sherpa_worker.py、AppleSpeechBenchmark.swift。", "重跑：先編譯 AppleSpeechBenchmark.swift 成 out/asr-benchmark-2026-10-14/apple-speech-resources，再執行 .venv/bin/python scripts/asr-benchmark/measure_resources.py，最後執行 write_resource_report.py。", "Apple 官方說明：https://developer.apple.com/videos/play/wwdc2025/277/", "硬體追蹤說明：https://developer.apple.com/videos/play/wwdc2022/10027/"]
    (OUT/"report.txt").write_text("\n".join(lines)+"\n")
    print(json.dumps(output,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
