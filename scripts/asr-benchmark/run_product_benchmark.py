"""Run the built Electron application's isolated acceptance and sample resources.

physical footprint != RSS. Shared Speech services are a separately labelled scope;
protected services, GPU/ANE occupancy, power and target-app receipt are not inferred.
"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/apple-engine-product'
OUT.mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location('resource_probe', Path(__file__).with_name('measure_resources.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
unit = probe.calibrate()
(OUT / 'cpu-calibration.json').write_text(json.dumps(unit, indent=2))
core = '--core' in sys.argv
packaged = '--packaged' in sys.argv
data = OUT / ('core-data' if core else 'app-data')
data.mkdir(exist_ok=True)
phase_file = data / 'speech-phase.json'
if phase_file.exists(): phase_file.unlink()  # only this run's generated phase marker
environment = dict(os.environ)
environment.pop('ELECTRON_RUN_AS_NODE', None)
environment.pop('NODE_ENV', None)
with (OUT / ('core-test.log' if core else 'electron-test.log')).open('w') as log, (OUT / ('core-resources.jsonl' if core else 'resources.jsonl')).open('w') as samples:
    executable = [str(ROOT / 'dist/mac-arm64/SpeakSlow.app/Contents/MacOS/SpeakSlow')] if packaged else ['node', 'start-electron.js']
    command = ['node', 'scripts/asr-benchmark/run_core_benchmark.cjs'] if core else [*executable, f'--acceptance-data-dir={data}', f'--acceptance-plan={OUT / "plan.json"}']
    process = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT)
    start = time.monotonic()
    last = None
    root_pid = None
    try:
        while process.poll() is None:
            if time.monotonic() - start > 900: raise TimeoutError('acceptance exceeded 15 minutes')
            try: phase = json.loads(phase_file.read_text())
            except (FileNotFoundError, json.JSONDecodeError): phase = {'phase': 'startup'}
            root_pid = phase.get('rootPid', root_pid)
            inventory = probe.processes()
            selected = probe.scopes(inventory, root_pid) if root_pid else probe.scopes(inventory)
            snapshot = probe.sample(selected, phase)
            samples.write(json.dumps(snapshot, ensure_ascii=False) + '\n')
            samples.flush()
            label = (phase.get('phase'), phase.get('engine'), phase.get('profile'), phase.get('cohort'), phase.get('index'))
            if label != last:
                print(json.dumps(phase, ensure_ascii=False), flush=True); last = label
            time.sleep(.1)
        print(json.dumps({'electron_exit_code': process.returncode, 'wall_s': time.monotonic() - start}), flush=True)
    except BaseException:
        if root_pid:
            try: os.kill(root_pid, signal.SIGTERM)
            except ProcessLookupError: pass
        process.terminate()
        raise
    for _ in range(10):
        samples.write(json.dumps(probe.sample(probe.scopes(probe.processes()), {'phase': 'after_exit'}), ensure_ascii=False) + '\n')
        time.sleep(.1)
    if process.returncode: raise SystemExit(process.returncode)
