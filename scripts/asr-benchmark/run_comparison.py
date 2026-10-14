"""Compare real production SherpaServer with standalone Apple SDK, locally."""
import json
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time
import unicodedata

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
OUT = ROOT / "out/asr-benchmark-2026-10-14"

def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2))

def apple(engine, mode, manifest="manifest.json", repetition=0):
    stem = f"apple-{engine}-{mode}-{repetition}"
    with (OUT / (stem + ".jsonl")).open("w") as stdout, (OUT / (stem + ".stderr")).open("w") as stderr:
        result = subprocess.run([str(OUT / "apple-speech-benchmark"), str(OUT / manifest), engine, mode], stdout=stdout, stderr=stderr, timeout=180)
    rows = [json.loads(line) for line in (OUT / (stem + ".jsonl")).read_text().splitlines()]
    if result.returncode or any(r["type"] == "error" for r in rows):
        raise RuntimeError(f"{stem} failed; inspect saved output")
    rows = [dict(r, repetition=repetition) for r in rows if r["type"] == "result"]
    if len(rows) != len(json.loads((OUT / manifest).read_text())):
        raise RuntimeError(f"{stem}: missing results")
    print(f"Completed {stem}: {len(rows)} clips", flush=True)
    return rows

def normalize(text, converter=None):
    text = unicodedata.normalize("NFKC", text).lower()
    if converter:
        text = converter.convert(text)
    return "".join(c for c in text if unicodedata.category(c)[0] in "LN")

def distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1] + 1, row[j] + 1, row[j-1] + (x != y)))
        row = current
    return row[-1]

def summarize():
    from opencc import OpenCC
    converter = OpenCC("t2s")
    manifest = json.loads((OUT / "manifest.json").read_text())
    references = {r["id"]: r["reference"] for r in manifest}
    all_rows = json.loads((OUT / "all-results.json").read_text())
    for r in all_rows:
        ref = references[r["id"]]
        r["reference"] = ref
        r["normalized_errors"] = distance(normalize(ref, converter), normalize(r["text"], converter))
        r["normalized_reference_chars"] = len(normalize(ref, converter))
        r["strict_traditional_errors"] = distance(normalize(ref), normalize(r["text"]))
        r["strict_reference_chars"] = len(normalize(ref))
        if r["engine"] in ("speech", "speech-fast", "dictation"):
            events = r["events"]
            r["first_text_ms"] = events[0]["elapsed_ms"] if events else None
            # Last update containing the final lexical content, irrespective of punctuation.
            target = normalize(r["text"], converter)
            matches = [e["elapsed_ms"] for e in events if normalize(e["text"], converter) == target]
            r["lexical_complete_ms"] = min(matches) if matches else None
    groups = []
    for engine, mode in sorted(set((r["engine"], r["mode"]) for r in all_rows)):
        rows = [r for r in all_rows if (r["engine"], r["mode"]) == (engine, mode)]
        # Accuracy counted once per clip, with reproducibility reported separately.
        unique = {r["id"]: r for r in rows}
        errors = sum(r["normalized_errors"] for r in unique.values())
        chars = sum(r["normalized_reference_chars"] for r in unique.values())
        strict_errors = sum(r["strict_traditional_errors"] for r in unique.values())
        strict_chars = sum(r["strict_reference_chars"] for r in unique.values())
        groups.append(dict(engine=engine, mode=mode, clips=len(unique), runs=len(rows), normalized_errors=errors, reference_chars=chars, normalized_cer=errors/chars, strict_traditional_cer=strict_errors/strict_chars, exact_clips=sum(r["normalized_errors"] == 0 for r in unique.values()), median_complete_ms=statistics.median(r["complete_ms"] for r in rows), median_tail_ms=statistics.median(r["tail_ms"] for r in rows), median_first_text_ms=statistics.median(r["first_text_ms"] for r in rows if r.get("first_text_ms") is not None) if any(r.get("first_text_ms") is not None for r in rows) else None, median_prepare_ms=statistics.median(r["prepare_ms"] for r in rows if "prepare_ms" in r) if any("prepare_ms" in r for r in rows) else None, unstable_clips=[key for key in unique if len(set(normalize(r["text"],converter) for r in rows if r["id"]==key)) > 1]))
    save("scored-results.json", all_rows)
    save("summary.json", dict(groups=groups, duration_s=sum(r["duration_s"] for r in manifest), clips=len(manifest), speakers=len(set(r["speaker"] for r in manifest)), normalization="NFKC, lowercase, Unicode letters/numbers only; t2s for primary CER; strict Traditional CER does not fold script", limits=[f"{len(manifest)} scripted short clips; no spontaneous speech, microphone noise, personal vocabulary or iPhone comparison", "Engine boundary only; Electron IPC, dictionary, AI polishing and paste excluded", "Real-time mode supplies 100ms chunks at wall-clock pace; first text includes leading silence; tail is measured from end of WAV, not actual last spoken phoneme", "Asset loading and prepareToAnalyze measured separately; no claim of cold OS cache or ANE residency"]))
    print(json.dumps(groups,ensure_ascii=False,indent=2),flush=True)

def main():
    if "--summarize" in sys.argv:
        summarize()
        return
    from sherpa_server import SherpaServer
    import sherpa_onnx
    manifest = json.loads((OUT / "manifest.json").read_text())
    start = time.perf_counter()
    server = SherpaServer()
    initialized = server.initialize()
    if not initialized["success"]:
        raise RuntimeError(initialized)
    save("environment.json", dict(platform=platform.platform(), python=sys.version, sherpa=sherpa_onnx.__version__, sherpa_initialization_ms=(time.perf_counter()-start)*1000, provider=server.provider, threads=server.num_threads, model_dir=server.model_dir, git_head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip(), timestamp_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())))
    rows = []
    for repeat in range(3):
        for item in manifest:
            start = time.perf_counter()
            result = server.transcribe_audio(item["path"], dict(profile="standard",auto_format_lists=False,auto_line_break=False))
            elapsed = (time.perf_counter()-start)*1000
            if not result["success"]:
                raise RuntimeError(result)
            rows.append(dict(id=item["id"],engine="sherpa",mode="bulk",repetition=repeat,text=result["text"],raw_text=result["raw_text"],duration_s=item["duration_s"],complete_ms=elapsed,tail_ms=elapsed))
        print(f"Completed sherpa pass {repeat}",flush=True)
    save("sherpa-results.json",rows)
    for repeat in range(3):
        for engine in (("speech","dictation","speech-fast") if repeat % 2 == 0 else ("speech-fast","dictation","speech")):
            rows += apple(engine,"bulk",repetition=repeat)
            save("all-results.json",rows)
    # One real-time pass across all speakers; keep raw events for revision analysis.
    for engine in ("speech","dictation","speech-fast"):
        if "--reuse-realtime" in sys.argv:
            previous = [json.loads(s) for s in (OUT / f"apple-{engine}-realtime-0.jsonl").read_text().splitlines()]
            reused = [dict(r,repetition=0) for r in previous if r["type"] == "result"]
            expected = {r["id"] for r in json.loads((OUT / "realtime-manifest.json").read_text())}
            if {r["id"] for r in reused} != expected:
                raise RuntimeError("Saved real-time sample IDs do not match")
            rows += reused
        else:
            rows += apple(engine,"realtime",manifest="realtime-manifest.json")
        save("all-results.json",rows)
    summarize()

if __name__ == "__main__":
    main()
