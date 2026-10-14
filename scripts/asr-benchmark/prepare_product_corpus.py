"""Reproducible synthetic zh-TW regression corpus, NOT human/iPhone evidence.

The prompt is the provisional punctuation reference. No manual quality score is
claimed. Existing public Common Voice clips remain a separate natural-speech set.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'out/apple-engine-product/corpus'
OUT.mkdir(parents=True, exist_ok=True)

TOPICS = [
    ('會議', '請問明天的會議會準時開始嗎？我們需要先確認投影機和網路連線，再把資料傳給所有同事。'),
    ('回收', '今天要討論回收站的使用狀況。第一，檢查設備是否正常；第二，確認清運時間；第三，整理使用者反映的問題。'),
    ('工程', '這個版本會提供兩種語音辨識引擎，讓使用者自行選擇。切換之前必須先停止錄音，才能釋放上一個模型使用的記憶體。'),
    ('停頓', '我想確認一下，這份報告的日期是星期三，不對，應該是星期四。請保留我修正的內容，不要因為思考時停頓，就把一句話分成好幾行。'),
    ('中英', '我們先用 Apple 測試中文語音輸入，再比較 CPU 和記憶體使用量。最後把結果存成 JSON，交給 Kevin 和 Amy 一起檢查。'),
    ('問句', '為什麼停止錄音後還要等待呢？因為系統需要處理最後一段音訊，並確認前後文。這樣是否能減少錯字，也能讓標點更加自然？'),
    ('數字', '請核對報價單上的金額和數量。總共三十六個品項，每箱二十四瓶，運費另計。如果發現數字有問題，請先標記，不要直接修改原始資料。'),
    ('人名', '林怡君和陳志明今天會到台中出差。他們先去西屯的辦公室開會，下午再到北屯檢查設備。請問交通時間是否需要多留半個小時？'),
    ('操作', '辨識完成後，先套用詞庫，再依照設定決定是否潤稿與貼上。自動送出是另一個獨立選項；如果貼上失敗，就不應該繼續按下送出。'),
    ('長句', '雖然這段話比較長，但是我希望系統能保留完整的前後文，而不是每次遇到短暫停頓就重新開始。等我說完之後，再一起確認斷句、錯字和最後的標點。'),
]
manifest = []
for index in range(30):
    category, topic = TOPICS[index % len(TOPICS)]
    suffix = [
        '這是我們第一次完整測試。請把觀察結果記下來，並確認沒有遺漏句尾的聲音。',
        '測試時，請同時注意反應速度和資源使用量。速度比較快，並不代表所有句子都會辨識得比較正確。',
        '如果本次處理失敗，請清楚顯示原因，讓使用者決定是否重試。不要在背景偷偷換成另外一種引擎。',
    ][index // 10]
    reference = f'接下來是第{index + 1}段測試。{topic}{suffix}'
    spoken = reference.replace('。', '。[[slnc 350]]', 1).replace('，', '，[[slnc 650]]', 1)
    stem = OUT / f'synthetic-{index:02d}'
    text_file = stem.with_suffix('.txt')
    text_file.write_text(spoken)
    subprocess.run(['/usr/bin/say', '-v', 'Meijia', '-r', '165', '-f', str(text_file), '-o', str(stem.with_suffix('.aiff'))], check=True, capture_output=True)
    subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(stem.with_suffix('.aiff')), str(stem.with_suffix('.wav'))], check=True, capture_output=True)
    wav = stem.with_suffix('.wav')
    with wave.open(str(wav)) as source:
        duration = source.getnframes() / source.getframerate()
    manifest.append(dict(id=stem.name, path=str(wav), reference=reference, duration_s=duration, category=category, source='macOS Meijia zh-TW synthetic; script punctuation, no human annotation', sha256=hashlib.sha256(wav.read_bytes()).hexdigest()))
    print(json.dumps({'index': index, 'duration_s': duration}, ensure_ascii=False), flush=True)
(OUT.parent / 'synthetic-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
assert len(manifest) == 30
assert all(20 <= item['duration_s'] <= 60 for item in manifest), 'Duration gate: adjust the declared rate and regenerate the entire corpus, not individual failing results.'
