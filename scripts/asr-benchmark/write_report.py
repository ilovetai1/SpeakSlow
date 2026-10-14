"""Write a plain-text review and per-clip CSV from measured benchmark output."""
import csv
import hashlib
import json
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "out/asr-benchmark-2026-10-14"
NAMES = {"sherpa": "目前 Paraformer / CPU", "speech": "Apple SpeechTranscriber 預設", "speech-fast": "Apple SpeechTranscriber fastResults", "dictation": "Apple DictationTranscriber"}

def main():
    summary = json.loads((OUT / "summary.json").read_text())
    rows = json.loads((OUT / "scored-results.json").read_text())
    manifest = json.loads((OUT / "manifest.json").read_text())
    environment = json.loads((OUT / "environment.json").read_text())
    source = json.loads((OUT / "corpus-source.json").read_text())
    # Validate coverage and timing invariants before publishing figures.
    assert len(manifest) == len({r["speaker"] for r in manifest}) == 50
    expected_ids = {r["id"] for r in manifest}
    for engine in NAMES:
        subset = [r for r in rows if r["engine"] == engine and r["mode"] == "bulk"]
        assert len(subset) == 150 and {r["id"] for r in subset} == expected_ids
        assert {r["repetition"] for r in subset} == {0,1,2}
    for r in rows:
        assert r["complete_ms"] > 0 and r["tail_ms"] >= 0
        if r["mode"] == "realtime":
            assert abs(r["feed_end_ms"] - r["duration_s"] * 1000) < 100
            assert all(a["elapsed_ms"] <= b["elapsed_ms"] for a,b in zip(r["events"],r["events"][1:]))
    realtime_ids = {r["id"] for r in json.loads((OUT / "realtime-manifest.json").read_text())}
    for engine in ("speech", "speech-fast", "dictation"):
        selected = [r for r in rows if r["engine"] == engine and r["mode"] == "realtime"]
        assert len(selected) == 12 and {r["id"] for r in selected} == realtime_ids
    for item in manifest:
        item["sha256"] = hashlib.sha256(Path(item["path"]).read_bytes()).hexdigest()
    (OUT / "manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    lines = ["SpeakSlow：Apple 語音 SDK 與現有引擎實測", "測試日期：2026-10-14（Asia/Taipei）", "", f"環境：{environment['platform']}；sherpa-onnx {environment['sherpa']}；{environment['threads']} threads；provider={environment['provider']}", f"原始碼版本：{environment['git_head']}", "", f"樣本：{summary['speakers']} 位說話者、{summary['clips']} 份台灣中文真人朗讀，共 {summary['duration_s']:.3f} 秒。", "來源：https://huggingface.co/datasets/" + source["dataset"], "語料 revision：" + source["revision"], "授權：CC0-1.0。來源為 Common Voice 25 zh-TW 的 OpenFormosa 鏡像。", "選樣規則在辨識前固定，詳 corpus-source.json；不按引擎結果挑選音檔。", "所有引擎使用相同的 16 kHz / mono / PCM16 WAV；檔案 SHA-256 在 manifest.json。", "", "準確度與整段檔案處理：", "每引擎 50 份音訊、各跑 3 次；CER 每份只計一次，不以重複次數擴大樣本數。", "下列 CER 為最後一輪；若有跨輪變化，另列範圍與音檔。", "正規化：NFKC、英文小寫、排除標點空白；主要 CER 另以 OpenCC t2s 統一繁簡異體。", "嚴格繁體 CER 保留繁簡差異，也排除標點空白。CER 是編輯錯誤率，不能直接當成整句正確率。", "", "引擎 | 錯字/參考字 | CER | 嚴格繁體 CER | 完全正確句/50 | 檔案完成時間中位數"]
    bulk = [g for g in summary["groups"] if g["mode"] == "bulk"]
    for g in bulk:
        lines.append(f"{NAMES[g['engine']]} | {g['normalized_errors']}/{g['reference_chars']} | {g['normalized_cer']:.2%} | {g['strict_traditional_cer']:.2%} | {g['exact_clips']}/50 | {g['median_complete_ms']:.1f} ms")
        subset = [r for r in rows if r["engine"] == g["engine"] and r["mode"] == "bulk"]
        passes = [sum(r["normalized_errors"] for r in subset if r["repetition"] == repeat)/sum(r["normalized_reference_chars"] for r in subset if r["repetition"] == repeat) for repeat in range(3)]
        lines.append("  三輪 CER：" + "、".join(f"{value:.2%}" for value in passes))
        if g["unstable_clips"]:
            lines.append("  跨輪結果不同：" + ", ".join(g["unstable_clips"]))
    lines += ["", "以實際時間餵音訊（100ms 一批）：", "固定使用最前面的 12 份音訊，共 58.044 秒，每設定 1 輪。", "引擎 | 第一段非空文字中位數（從檔案開始） | 音檔結束到完成中位數 | 結束前已出字的音檔"]
    for g in [g for g in summary["groups"] if g["mode"] == "realtime"]:
        selected = [r for r in rows if r["engine"] == g["engine"] and r["mode"] == "realtime"]
        before = sum(r["first_text_ms"] is not None and r["first_text_ms"] < r["feed_end_ms"] for r in selected)
        lines.append(f"{NAMES[g['engine']]} | {g['median_first_text_ms']:.1f} ms | {g['median_tail_ms']:.1f} ms | {before}/{len(selected)}")
    lines += ["", "目前一般模式在這批短句停止後才開始辨識，沒有錄音中的第一段文字指標。", "第一段文字時間包含錄音開頭的靜音；尾端等待從 WAV 檔案結尾起算，不是最後一個語音音素。", "檔案處理 ms 與即時串流第一段文字 ms 定義不同，不能互相替代。", "", "準備時間：", f"Sherpa 初始化 {environment['sherpa_initialization_ms']:.1f} ms；第一次標點模型載入已包含在第一份辨識時間。", "Apple 每份的 prepare_ms、assets_ms 與逐次結果保存在原始 JSONL；上表處理時間不含 prepareToAnalyze。", "這次 Apple 的 zh_TW 模型已安裝，沒有下載等待；沒有測首次安裝或清除 OS 快取後的啟動。", "", "測試邊界：", "1. 這是辨識引擎測試。未納入 Electron IPC、錄音裝置、應用字典、AI 潤稿及貼上。", "2. 現有後端使用專案正式 SherpaServer.transcribe_audio、標準 Paraformer、VAD、標點和簡轉繁。", "3. 測試沒有修改 SpeakSlow 設定、安裝應用或使用者資料庫。", "4. 50 份短句不代表自由口述、長句、中英混合、專有名詞或噪音環境。", "5. 沒有直接比較實體 iPhone；不能宣稱等同 iPhone。", "6. 沒有量測硬體 dispatch 或 ANE 使用率；SDK 成功不代表每一步都使用 ANE。", "7. 未確認各模型訓練資料是否包含此公開語料。", "8. 此次延遲為本機當時負載下的測量；重複辨識的中位數不是跨裝置效能保證。", "", "各句比較（最新 bulk 輪次）："]
    latest = {(r["engine"],r["id"]):r for r in rows if r["mode"] == "bulk" and r["repetition"] == 2}
    with (OUT / "per-clip.csv").open("w",newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["id","reference","engine","text","errors","reference_chars","complete_ms"])
        for item in manifest:
            lines += ["", item["id"] + " 原文：" + item["reference"]]
            for engine in NAMES:
                r = latest[(engine,item["id"])]
                lines.append(f"  {NAMES[engine]}：{r['text']}（錯 {r['normalized_errors']} 字）")
                writer.writerow([item["id"],item["reference"],engine,r["text"],r["normalized_errors"],r["normalized_reference_chars"],round(r["complete_ms"],3)])
    lines += ["", "本次判讀：", "Apple 新版預設在統一繁簡字形後少錯 3 字，但保留字形時錯誤率略高；不能宣稱明顯更準。", "例如 Apple 把『裡面』輸出為『裏麵』、『若干』輸出為『若幹』；t2s 正規化會掩蓋這類差異，所以應同時看嚴格分數與逐句原文。", "新版預設在這 12 份短音檔均未於結束前出字。fastResults 能即時出字，但準確度下降。", "目前 CPU 引擎在這批短句的辨識處理中位數已約 0.12 秒；換引擎的純處理時間差僅數十毫秒。", "功能上可以建立邊講邊出字模式；尚無證據證明接入後會等同 iPhone 的真實麥克風輸入體驗。", "建議先保留現有引擎，下一階段以可切換 Apple 模式測使用者自由口述與完整貼上延遲。", "", "重跑方式（repo 根目錄）：", "mkdir -p out/asr-benchmark-2026-10-14", "xcrun swiftc -parse-as-library -O scripts/asr-benchmark/AppleSpeechBenchmark.swift -o out/asr-benchmark-2026-10-14/apple-speech-benchmark", ".venv/bin/python scripts/asr-benchmark/prepare_corpus.py --count 50", ".venv/bin/python scripts/asr-benchmark/run_comparison.py", ".venv/bin/python scripts/asr-benchmark/write_report.py", "", "Apple fastResults 說明：https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/fastresults", "原始資料：all-results.json、scored-results.json、apple-*.jsonl、environment.json、corpus-source.json、manifest.json。"]
    (OUT / "report.txt").write_text("\n".join(lines) + "\n")
    print("Validated 600 bulk runs and 36 real-time runs; wrote report.txt and per-clip.csv")

if __name__ == "__main__":
    main()
