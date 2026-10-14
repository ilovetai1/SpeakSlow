import json
from collections import defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/apple-engine-product/hardware'
result = {'scope': 'separate 30-second all-process traces; no power or ANE utilization percentage', 'runs': []}
for engine in ['sherpa','apple']:
    def table(name):
        tree = ET.parse(OUT / f'{engine}-{name}.xml')
        ids = {element.attrib['id']: element for element in tree.iter() if 'id' in element.attrib}
        def resolve(element):
            while 'ref' in element.attrib: element = ids[element.attrib['ref']]
            return element
        return tree, resolve
    tree, resolve = table('ane-hw-intervals')
    labels = [resolve(list(row)[4]).attrib.get('fmt','') for row in tree.iter('row')]
    gpu, resolve_gpu = table('metal-gpu-intervals')
    gpu_processes = sorted({resolve_gpu(list(row)[10]).attrib.get('fmt','') for row in gpu.iter('row')})
    tree, resolve = table('activity-monitor-process-live')
    snapshots = defaultdict(dict); cpu = defaultdict(list)
    for row in tree.iter('row'):
        cells = list(row); name = resolve(cells[1]).attrib.get('fmt','')
        if not any(term in name.lower() for term in ['aned (','modelmanagerd','modelcatalogd','anecompilerservice','corespeechd_system']): continue
        memory = resolve(cells[10]).text; elapsed = resolve(cells[7]).text
        if memory is not None: snapshots[int(resolve(cells[0]).text)][name] = float(memory)
        if elapsed is not None: cpu[name].append(float(elapsed)/1e9)
    names = sorted({name for values in snapshots.values() for name in values})
    latest = {}; totals = []
    for timestamp, values in sorted(snapshots.items()):
        latest.update(values)
        if len(latest) == len(names): totals.append(sum(latest.values())/2**20)
    run = dict(engine=engine, ane_events=len(labels), ane_labels=sorted(set(labels))[:8], gpu_observed_processes=gpu_processes, gpu_engine_attributed_processes=[name for name in gpu_processes if any(term in name.lower() for term in ['apple-speech (','localspeechrecognition (','sherpa_server ('])], protected_service_names=names, protected_service_footprint_min_mib=min(totals) if totals else None, protected_service_footprint_peak_mib=max(totals) if totals else None, protected_service_cpu_delta_s=sum(max(values)-min(values) for values in cpu.values()))
    result['runs'].append(run)
(OUT/'analysis.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
