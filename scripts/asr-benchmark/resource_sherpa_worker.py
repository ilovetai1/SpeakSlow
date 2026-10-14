"""Resource workload using the unchanged SpeakSlow transcription backend."""
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from sherpa_server import SherpaServer

def phase(name):
    print(json.dumps(dict(type="phase", phase=name, uptime_s=time.monotonic())), flush=True)

def main():
    items = json.loads(Path(sys.argv[1]).read_text())
    server = SherpaServer()
    result = server.initialize()
    if not result["success"]:
        raise RuntimeError(result)
    warmup = server.transcribe_audio(items[0]["path"], {"profile":"standard"})
    if not warmup["success"]:
        raise RuntimeError(warmup)
    phase("ready_idle")
    time.sleep(3)
    phase("workload")
    for item in items:
        result = server.transcribe_audio(item["path"], {"profile":"standard", "auto_line_break":False, "auto_format_lists":False})
        if not result["success"]:
            raise RuntimeError(result)
        print(json.dumps(dict(type="result", id=item["id"], text=result["text"]),ensure_ascii=False),flush=True)
    phase("post_idle")
    time.sleep(5)
    phase("exit")

if __name__ == "__main__":
    main()
