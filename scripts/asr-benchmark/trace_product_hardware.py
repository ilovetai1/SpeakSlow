"""Bounded hardware trace of production managers, separate from latency trials."""
import json
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/apple-engine-product/hardware'
OUT.mkdir(exist_ok=True)
summary = {'scope': '30s all-process Instruments traces; worker uses production coordinator/helper. Shared system activity is not exclusive attribution or an ANE utilization percentage.', 'runs': []}
for engine in ['sherpa', 'apple']:
    trace_path = OUT / f'{engine}.trace'
    if trace_path.exists(): raise RuntimeError('Refusing to overwrite a prior hardware trace')
    with (OUT / f'{engine}-trace.log').open('w') as log:
        trace = subprocess.Popen(['xcrun', 'xctrace', 'record', '--template', 'Activity Monitor', '--instrument', 'Neural Engine', '--instrument', 'GPU', '--all-processes', '--time-limit', '30s', '--output', str(trace_path)], stdout=log, stderr=subprocess.STDOUT)
        time.sleep(4)
        with (OUT / f'{engine}-worker.log').open('w') as worker_log:
            worker = subprocess.Popen(['node', 'scripts/asr-benchmark/hardware_workload.cjs', engine], cwd=ROOT, stdout=worker_log, stderr=subprocess.STDOUT)
            worker.wait(timeout=45)
        trace.wait(timeout=55)
    if trace.returncode or worker.returncode: raise RuntimeError(f'{engine} trace or workload failed')
    toc = OUT / f'{engine}-toc.xml'
    subprocess.run(['xcrun','xctrace','export','--input',str(trace_path),'--toc','--output',str(toc)],check=True,capture_output=True)
    schemas = sorted({table.attrib['schema'] for table in ET.parse(toc).iter('table') if 'schema' in table.attrib})
    run = {'engine': engine, 'schemas': schemas, 'tables': {}}
    for schema in schemas:
        if schema not in ['ane-hw-intervals','gpu-command-buffer','gpu-command-buffer-summary','activity-monitor-process-live']: continue
        target = OUT / f'{engine}-{schema}.xml'
        subprocess.run(['xcrun','xctrace','export','--input',str(trace_path),'--xpath',f'/trace-toc/run[@number="1"]/data/table[@schema="{schema}"]','--output',str(target)],check=True,capture_output=True)
        tree = ET.parse(target)
        run['tables'][schema] = {'rows':len(list(tree.iter('row')))}
    summary['runs'].append(run)
    (OUT / 'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    print(json.dumps(run,ensure_ascii=False),flush=True)
