"""Score declared natural/synthetic cohorts and process-accounting boundaries."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import statistics
import unicodedata
from opencc import OpenCC

parser = argparse.ArgumentParser()
parser.add_argument('--scope', required=True, choices=['core', 'app'])
scope = parser.parse_args().scope
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/apple-engine-product'
data = json.loads((OUT / ('core-data' if scope == 'core' else 'app-data') / 'speech-acceptance.json').read_text())
assert data['status'] == 'completed', data.get('error')
convert = OpenCC('s2tw')
def clean(text, normalized=False):
    text = unicodedata.normalize('NFKC', text).lower()
    if normalized: text = convert.convert(text).replace('臺', '台').replace('裏', '裡')
    return ''.join(char for char in text if char.isalnum())

def alignment(reference, actual):
    n, m = len(reference), len(actual)
    table = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1): table[i][0] = i
    for j in range(m + 1): table[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            table[i][j] = min(table[i-1][j]+1, table[i][j-1]+1, table[i-1][j-1]+(reference[i-1] != actual[j-1]))
    i, j = n, m
    mapping = {m: n}
    while i or j:
        if i and j and table[i][j] == table[i-1][j-1] + (reference[i-1] != actual[j-1]): i -= 1; j -= 1
        elif j and table[i][j] == table[i][j-1] + 1: j -= 1
        else: i -= 1
        mapping[j] = i
    return table[n][m], mapping

PUNCT = {',': 'comma', '，': 'comma', '、': 'comma', '.': 'period', '。': 'period', '?': 'question', '？': 'question', '!': 'exclamation', '！': 'exclamation', ';': 'semicolon', '；': 'semicolon', ':': 'colon', '：': 'colon'}
def punctuation(text):
    content = ''; events = set()
    for char in unicodedata.normalize('NFKC', convert.convert(text)).lower():
        if char.isalnum(): content += char.replace('臺', '台').replace('裏', '裡')
        elif char in PUNCT: events.add((len(content), PUNCT[char]))
    return content, events

def percentile(values, p):
    ordered = sorted(values)
    import math
    return ordered[max(0, math.ceil(len(ordered)*p)-1)] if ordered else None

groups = defaultdict(list)
for item in data['results']: groups[(item['engine'], item['profile'], item['cohort'])].append(item)
quality = []
for (engine, profile, cohort), rows in groups.items():
    chars = errors = normalized_errors = normalized_chars = 0
    true = predicted = expected = sentence_true = sentence_pred = sentence_ref = 0
    for row in rows:
        ref, got = clean(row['reference']), clean(row['text'])
        chars += len(ref); errors += alignment(ref, got)[0]
        refn, gotn = clean(row['reference'], True), clean(row['text'], True)
        normalized_chars += len(refn); normalized_errors += alignment(refn, gotn)[0]
        rbase, rpunct = punctuation(row['reference']); hbase, hpunct = punctuation(row['text'])
        _, mapping = alignment(rbase, hbase)
        mapped = {(mapping.get(position, len(rbase)), kind) for position, kind in hpunct}
        true += len(rpunct & mapped); expected += len(rpunct); predicted += len(mapped)
        rend = {(pos, kind) for pos, kind in rpunct if kind in ['period','question','exclamation']}
        hend = {(pos, kind) for pos, kind in mapped if kind in ['period','question','exclamation']}
        sentence_true += len(rend & hend); sentence_ref += len(rend); sentence_pred += len(hend)
    quality.append(dict(engine=engine, profile=profile, cohort=cohort, clips=len(rows), audio_s=sum(row['duration_s'] for row in rows), reference_chars=chars, errors=errors, cer=errors/chars, normalized_cer=normalized_errors/normalized_chars, script_punctuation_f1=2*true/(predicted+expected) if predicted+expected else None, script_sentence_f1=2*sentence_true/(sentence_pred+sentence_ref) if sentence_pred+sentence_ref else None, submit_to_final_p50_ms=percentile([row['elapsed_ms'] for row in rows],.5), submit_to_final_p95_ms=percentile([row['elapsed_ms'] for row in rows],.95)))

resources_path = OUT / ('core-resources.jsonl' if scope == 'core' else 'resources.jsonl')
samples = [json.loads(line) for line in resources_path.read_text().splitlines()]
unit = json.loads((OUT/'cpu-calibration.json').read_text())['seconds_per_unit']
resources = {}
for engine, profile in sorted({(row['engine'], row['profile']) for row in data['results']}):
    matching = [sample for sample in samples if sample['phase'].get('engine') == engine and sample['phase'].get('profile') == profile]
    workloads = [sample for sample in matching if sample['phase']['phase'] == 'workload']
    def footprint(sample, kind): return sum(proc.get('footprint_bytes',0) for proc in sample['processes'] if proc['scope'] == kind) / 2**20
    cpu = defaultdict(float)
    peak_cpu = 0
    for previous, current in zip(matching, matching[1:]):
        if previous['phase']['phase'] != 'workload' or current['phase']['phase'] != 'workload': continue
        before = {proc['pid']:proc for proc in previous['processes']}
        increment = 0
        for proc in current['processes']:
            old = before.get(proc['pid'])
            if old and 'cpu_raw' in proc and 'cpu_raw' in old:
                elapsed = max(0,proc['cpu_raw']-old['cpu_raw'])*unit
                cpu[proc['scope']] += elapsed
                if proc['scope'] in ['client','service']: increment += elapsed
        peak_cpu=max(peak_cpu,increment/(current['t']-previous['t'])*100)
    resources[f'{engine}-{profile}'] = dict(workload_client_peak_mib=max(footprint(sample,'client') for sample in workloads), workload_accessible_service_peak_mib=max(footprint(sample,'service') for sample in workloads), workload_combined_peak_mib=max(footprint(sample,'client')+footprint(sample,'service') for sample in workloads), ready_client_median_mib=statistics.median(footprint(sample,'client') for sample in matching if sample['phase']['phase']=='ready_idle'), post_client_median_mib=statistics.median(footprint(sample,'client') for sample in matching if sample['phase']['phase']=='post_idle'), workload_client_cpu_s=cpu['client'], workload_accessible_service_cpu_s=cpu['service'], workload_combined_cpu_s=cpu['client']+cpu['service'], workload_sampled_peak_cpu_percent=peak_cpu, protected_or_failed_service_pids=sorted({proc['pid'] for sample in matching for proc in sample['processes'] if proc['scope']=='service' and 'error' in proc}))

summary = dict(scope=data['scope'], quality=quality, resources=resources, checks=data['checks'], limitations=['File submission to final is not microphone stop to paste.', 'Synthetic punctuation is scored against the synthesis script, not human annotations.', 'Natural Common Voice references are short and omit punctuation; their punctuation F1 is not an acceptance score.', 'Process accounting omits unreadable protected services and driver allocations; shared services are not exclusively attributable.', 'One block per engine/profile; no repeated-trial statistical confidence or iPhone comparison.'])
(OUT/f'{scope}-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
lines = [f'# Apple 引擎 {scope} 配對測試', '', data['scope'], '', '|語料|引擎／偏好|段數|繁中 CER|字形正規化 CER|交付到定稿 P50／P95|腳本標點 F1|腳本句界 F1|', '|---|---|---:|---:|---:|---:|---:|---:|']
for row in quality:
    fmt = lambda value: f'{value*100:.2f}%'
    lines.append(f"|{row['cohort']}|{row['engine']}／{row['profile']}|{row['clips']}|{fmt(row['cer'])}|{fmt(row['normalized_cer'])}|{row['submit_to_final_p50_ms']:.1f}／{row['submit_to_final_p95_ms']:.1f} ms|{fmt(row['script_punctuation_f1']) if row['cohort']=='synthetic' else '不評分'}|{fmt(row['script_sentence_f1']) if row['cohort']=='synthetic' else '不評分'}|")
lines += ['', '|引擎／偏好|呼叫端 peak footprint|可讀服務 peak|同時合計 peak|workload CPU 合計|', '|---|---:|---:|---:|---:|']
for label, row in resources.items(): lines.append(f"|{label}|{row['workload_client_peak_mib']:.1f} MiB|{row['workload_accessible_service_peak_mib']:.1f} MiB|{row['workload_combined_peak_mib']:.1f} MiB|{row['workload_combined_cpu_s']:.2f} s|")
lines += ['', 'CER 越低越好；F1 越高越好。字形正規化只處理繁簡、臺／台、裏／裡，不把數字或專有名詞錯誤豁免。', '', '## 限制', '', *['- '+value for value in summary['limitations']]]
(OUT/f'{scope}-report.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
