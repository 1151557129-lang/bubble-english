#!/usr/bin/env python3
"""
泡泡英语 - 批量生成单词发音 mp3
读取 data/words.json，用 Edge-TTS 为每个单词生成音频到 audio/words/{id}.mp3
已存在的文件会跳过（可重复运行增量生成）。

用法:
    python3 scripts/gen_audio.py [--voice en-US-AnaNeural] [--rate -10%]
"""
import asyncio
import json
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
WORDS_JSON = ROOT / "data" / "words.json"
AUDIO_DIR = ROOT / "audio" / "words"
PHRASES_DIR = ROOT / "audio" / "phrases"

VOICE = "en-US-AnaNeural"
RATE = "-10%"
PHRASE_RATE = "+0%"
CONCURRENCY = 5

# 某些单词用自然语速，避免 -10% 拉长后听感异常（如数字）
RATE_OVERRIDES = {
    "one": "+0%", "two": "+0%", "three": "+0%", "four": "+0%", "five": "+0%",
    "six": "+0%", "seven": "+0%", "eight": "+0%", "nine": "+0%", "ten": "+0%",
    "eleven": "+0%", "twelve": "+0%", "thirteen": "+0%", "fourteen": "+0%", "fifteen": "+0%",
    "sixteen": "+0%", "seventeen": "+0%", "eighteen": "+0%", "nineteen": "+0%", "twenty": "+0%",
    "hundred": "+0%",
}

# 闯关模式的提示语/鼓励语（(文件名, 文本)）
PHRASES = [
    ("find_listen", "Listen and find!"),
    ("great_job", "Great job!"),
    ("excellent", "Excellent!"),
    ("well_done", "Well done!"),
    ("you_did_it", "You did it!"),
]


def parse_args():
    args = sys.argv[1:]
    voice = VOICE
    rate = RATE
    for a in args:
        if a.startswith("--voice="):
            voice = a.split("=", 1)[1]
        elif a.startswith("--rate="):
            rate = a.split("=", 1)[1]
    return voice, rate


def load_data():
    with open(WORDS_JSON, encoding="utf-8") as f:
        return json.load(f)


def load_words(data):
    words = []
    for cat in data["categories"]:
        for w in cat["words"]:
            words.append((w["id"], w["word"]))
    return words


def js(s):
    return json.dumps(s, ensure_ascii=False)


def sync_js(data):
    """从 words.json 生成前端用的 data/words.js（words.json 是唯一数据源）"""
    lines = [
        "// 本文件由 scripts/gen_audio.py 从 data/words.json 自动生成，勿手动修改",
        "export default [",
    ]
    for c in data["categories"]:
        lines.append(
            "  { id: %s, name: %s, emoji: %s, words: ["
            % (js(c["id"]), js(c["name"]), js(c["emoji"]))
        )
        for w in c["words"]:
            lines.append(
                "    { id: %s, word: %s, phonetic: %s, cn: %s, emoji: %s },"
                % (js(w["id"]), js(w["word"]), js(w["phonetic"]), js(w["cn"]), js(w["emoji"]))
            )
        lines.append("  ]},")
    lines.append("]")
    (ROOT / "data" / "words.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("已生成 data/words.js")


async def gen_one(word_id, text, voice, rate, sem):
    out = AUDIO_DIR / f"{word_id}.mp3"
    if out.exists() and out.stat().st_size > 0:
        return (word_id, "skip")
    async with sem:
        try:
            comm = edge_tts.Communicate(text, voice, rate=RATE_OVERRIDES.get(word_id, rate))
            await comm.save(str(out))
            return (word_id, "ok")
        except Exception as e:
            return (word_id, f"ERR: {e}")


async def gen_phrases(voice, sem):
    """生成闯关模式的提示语/鼓励语音频"""
    PHRASES_DIR.mkdir(parents=True, exist_ok=True)
    for fid, text in PHRASES:
        out = PHRASES_DIR / f"{fid}.mp3"
        if out.exists() and out.stat().st_size > 0:
            continue
        async with sem:
            try:
                comm = edge_tts.Communicate(text, voice, rate=PHRASE_RATE)
                await comm.save(str(out))
                print(f"  phrase {fid}: ok")
            except Exception as e:
                print(f"  phrase {fid}: ERR {e}")


async def main():
    voice, rate = parse_args()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    data = load_data()
    sync_js(data)
    words = load_words(data)
    sem = asyncio.Semaphore(CONCURRENCY)
    print(f"voice={voice} rate={rate} 共 {len(words)} 词")
    results = await asyncio.gather(
        *(gen_one(wid, txt, voice, rate, sem) for wid, txt in words)
    )
    await gen_phrases(voice, sem)
    ok = skip = err = 0
    for wid, status in results:
        if status == "ok":
            ok += 1
        elif status == "skip":
            skip += 1
        else:
            err += 1
            print(f"  ✗ {wid}: {status}")
    print(f"完成: 新生成 {ok} / 跳过 {skip} / 失败 {err}")


if __name__ == "__main__":
    asyncio.run(main())
