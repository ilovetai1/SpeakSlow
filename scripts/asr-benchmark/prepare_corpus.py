"""Download a deterministic, speaker-diverse Taiwan Mandarin pilot corpus."""
import hashlib
import argparse
import json
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "out/asr-benchmark-2026-10-14"
OUT.mkdir(parents=True, exist_ok=True)
DATASET = "OpenFormosa/common_voice_25_zh-TW"

def fetch_json(url):
    with urllib.request.urlopen(url, timeout=40) as response:
        return json.load(response)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--revision", default="9e969df60ad63f812b68a755581c961bc967673d")
    args = parser.parse_args()
    metadata = fetch_json("https://huggingface.co/api/datasets/" + DATASET + "/revision/" + args.revision)
    selected, speakers = [], set()
    for offset in (0, 100, 300, 600, 1000, 1500, 2200, 3000):
        query = urllib.parse.urlencode(dict(dataset=DATASET, revision=args.revision, config="default", split="test", offset=offset, length=100))
        response = fetch_json("https://datasets-server.huggingface.co/rows?" + query)
        for entry in response["rows"]:
            row = entry["row"]
            if row["client_id"] in speakers or row["down_votes"] != 0 or row["up_votes"] < 2:
                continue
            if not (1500 <= row["duration_ms"] <= 10000 and len(row["sentence"]) >= 8):
                continue
            idx = entry["row_idx"]
            if "/--/" + metadata["sha"] + "/--/" not in row["audio"][0]["src"]:
                raise RuntimeError("Dataset server returned an unexpected revision")
            audio_path = OUT / f"cv-{idx}.mp3"
            wav_path = OUT / f"cv-{idx}.wav"
            if not audio_path.exists():
                with urllib.request.urlopen(row["audio"][0]["src"], timeout=40) as source:
                    audio_path.write_bytes(source.read())
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(audio_path), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav_path)], check=True)
            with wave.open(str(wav_path)) as wav:
                duration = wav.getnframes() / wav.getframerate()
            selected.append(dict(id=f"cv-{idx}", path=str(wav_path), sha256=hashlib.sha256(wav_path.read_bytes()).hexdigest(), reference=row["sentence"], duration_s=duration, speaker=hashlib.sha256(row["client_id"].encode()).hexdigest()[:12], source_file=row["path"], row_index=idx))
            speakers.add(row["client_id"])
            print(json.dumps({"downloaded": len(selected), "id": f"cv-{idx}", "duration_s": duration}, ensure_ascii=False), flush=True)
            if len(selected) == args.count:
                break
        if len(selected) == args.count:
            break
    if len(selected) < args.count:
        raise RuntimeError(f"Only {len(selected)} eligible speakers found")
    (OUT / "manifest.json").write_text(json.dumps(selected, ensure_ascii=False, indent=2))
    (OUT / "realtime-manifest.json").write_text(json.dumps(selected[:12], ensure_ascii=False, indent=2))
    (OUT / "corpus-source.json").write_text(json.dumps(dict(dataset=DATASET, revision=metadata["sha"], split="test", license="cc0-1.0", selection="First eligible clip per distinct client_id, scanned offsets 0,100,300,600,1000,1500,2200,3000; down_votes=0, up_votes>=2, duration 1.5..10s, sentence>=8 codepoints", clips=args.count), indent=2))

if __name__ == "__main__":
    main()
