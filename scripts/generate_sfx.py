#!/usr/bin/env python3
"""
Generates every sound effect used by Blip's Big Adventure via the ElevenLabs
Sound Generation API, and saves them under assets/sfx/.

Requires the ELEVENLABS_API_KEY environment variable (the repo's GitHub
Actions secret of the same name). Run from the repo root:

    ELEVENLABS_API_KEY=... python3 scripts/generate_sfx.py
"""
import os
import sys
import time
import urllib.request
import urllib.error
import json

API_URL = "https://api.elevenlabs.io/v1/sound-generation"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "sfx")

# name -> (prompt, duration_seconds, prompt_influence)
SOUNDS = {
    "jump":        ("a short cute cartoonish boing jump sound effect for a kids video game, "
                     "bouncy, playful, high-pitched, quick pop", 0.4, 0.4),
    "double-jump": ("a short cute cartoonish airy whoosh double-jump sound effect for a kids "
                     "video game, higher pitched and lighter than a regular jump, playful", 0.4, 0.4),
    "coin":        ("a short bright cheerful coin collect chime for a kids video game, "
                     "sparkly bell-like ding, like picking up a star", 0.4, 0.3),
    "hazard":      ("a short cartoonish comedic boom explosion sound effect for a kids video "
                     "game, soft and bouncy, not scary, a low thud with a puff of air", 0.6, 0.4),
    "stage-clear": ("a short cheerful triumphant two-note chime jingle for clearing a level in "
                     "a cute kids video game, bright, playful, bell-like", 0.7, 0.3),
    "win":         ("a short triumphant victory fanfare jingle for winning a cute kids video "
                     "game, cheerful ascending melody, playful and bright, orchestral toy bells", 1.6, 0.3),
}


def generate(name, prompt, duration, prompt_influence, api_key):
    payload = json.dumps({
        "text": prompt,
        "duration_seconds": duration,
        "prompt_influence": prompt_influence,
    }).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            last_err = f"HTTP {e.code}: {body[:800]}"
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(2 ** attempt * 2)
                continue
            break
        except Exception as e:
            last_err = str(e)
            time.sleep(2)
    raise RuntimeError(f"Failed to generate '{name}': {last_err}")


def main():
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    for name, (prompt, duration, influence) in SOUNDS.items():
        print(f"Generating {name}.mp3 ...", flush=True)
        audio = generate(name, prompt, duration, influence, api_key)
        out_path = os.path.join(OUT_DIR, f"{name}.mp3")
        with open(out_path, "wb") as f:
            f.write(audio)
        print(f"  saved {out_path} ({len(audio)} bytes)", flush=True)

    print("All sound effects generated.")


if __name__ == "__main__":
    main()
