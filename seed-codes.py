#!/usr/bin/env python3
"""
Seed the Upstash Redis 'pb-unused-codes' list with all codes from codes-private.txt.

Run ONCE locally after setting up Upstash:
    export KV_REST_API_URL='https://...upstash.io'
    export KV_REST_API_TOKEN='AY...'
    python3 seed-codes.py
"""

import os
import sys
import json
import urllib.request
from pathlib import Path

KV_URL = os.environ.get("KV_REST_API_URL", "").rstrip("/")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN", "")
POOL_KEY = os.environ.get("PB_UNUSED_CODES_KEY", "pb-unused-codes")
CODES_FILE = Path(__file__).parent / "codes-private.txt"

if not KV_URL or not KV_TOKEN:
    sys.exit(
        "❌ Set KV_REST_API_URL and KV_REST_API_TOKEN env vars first.\n"
        "Get them from Vercel → Storage → Upstash → .env tab\n"
    )

if not CODES_FILE.exists():
    sys.exit(f"❌ {CODES_FILE} not found")


def kv_request(path, method="POST"):
    url = f"{KV_URL}/{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"Bearer {KV_TOKEN}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def kv_pipeline(commands):
    url = f"{KV_URL}/pipeline"
    body = json.dumps(commands).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {KV_TOKEN}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    raw = CODES_FILE.read_text(encoding="utf-8").splitlines()
    codes = []
    used = []
    for line in raw:
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue
        if "#" in line:
            code = line.split("#")[0].strip()
            used.append(code)
            continue
        codes.append(line)

    print(f"📋 codes-private.txt: {len(codes)} unused, {len(used)} used (skipped)")

    info = kv_request(f"LLEN/{POOL_KEY}")
    existing = info.get("result", 0)
    if existing:
        ans = input(f"⚠ Pool '{POOL_KEY}' bevat al {existing} codes. Toevoegen (a), vervangen (r), of annuleren (c)? [a/r/c] ").strip().lower()
        if ans == "c": sys.exit("Geannuleerd.")
        if ans == "r":
            kv_request(f"DEL/{POOL_KEY}")
            print("✓ Bestaande pool gewist.")

    batch_size = 50
    for i in range(0, len(codes), batch_size):
        batch = codes[i:i + batch_size]
        commands = [["RPUSH", POOL_KEY] + batch]
        result = kv_pipeline(commands)
        added = result[0].get("result", 0) if isinstance(result, list) else 0
        print(f"  · Batch {i // batch_size + 1}: pushed {len(batch)} codes (pool size: {added})")

    final = kv_request(f"LLEN/{POOL_KEY}").get("result", 0)
    print(f"\n✅ Done. Pool '{POOL_KEY}' bevat nu {final} codes.")
    head = kv_request(f"LRANGE/{POOL_KEY}/0/4").get("result", [])
    print(f"   Top 5: {head}")


if __name__ == "__main__":
    main()
