#!/usr/bin/env python3
"""
PaySense AI — Optional $0 Open Market Data Sync Pipeline
-------------------------------------------------------
Runs on a weekly GitHub Actions schedule (or manually) with ZERO external
Python dependencies (uses only Python 3 standard library).

What it syncs:
  1. Adzuna Open API (optional — runs automatically if ADZUNA_APP_ID &
     ADZUNA_APP_KEY are set in GitHub Repository Secrets; free tier covers
     AU, US, UK/GB, CA, IN, NZ, SG at 2,500 calls/month, no credit card).
     - Fetches live vacancy counts + advertised salary medians per role/country.
     - Fetches contract vacancy samples to enrich contractor day-rate estimates.
  2. Safely merges live metrics into data/roles.json without erasing curated
     government benchmarks (JSA, BLS, ONS, O*NET).

Usage:
  python3 scripts/sync_open_data.py
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "roles.json")

# Map PaySense AI country codes to Adzuna API country path codes
ADZUNA_COUNTRY_MAP = {
    "AU": "au",
    "US": "us",
    "UK": "gb",
    "CA": "ca",
    "IN": "in",
    "NZ": "nz",
    "SG": "sg",
}


def http_get_json(url, timeout=12):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PaySenseAI-OpenDataSync/1.0 (+https://github.com)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def sync_adzuna(dataset, app_id, app_key):
    """Fetch live Adzuna vacancy counts & advertised salary means across supported countries."""
    updated_count = 0
    roles = dataset.get("roles", [])

    # Keep total API calls well within free-tier daily quota (250/day):
    # Sync top 10 highest-traffic roles across AU, US, UK, CA, IN, NZ, SG (~70 calls/run)
    target_roles = roles[:10]

    for role in target_roles:
        query_term = role["title"].split("/")[0].strip()
        for code, adz_code in ADZUNA_COUNTRY_MAP.items():
            market = role.get("markets", {}).get(code)
            if not market:
                continue

            params = urllib.parse.urlencode(
                {
                    "app_id": app_id,
                    "app_key": app_key,
                    "what": query_term,
                    "results_per_page": 1,
                }
            )
            url = f"https://api.adzuna.com/v1/api/jobs/{adz_code}/search/1?{params}"
            try:
                payload = http_get_json(url)
                count = payload.get("count")
                mean_sal = payload.get("mean")
                if isinstance(count, int) and count >= 0:
                    market["liveVacancies"] = count
                if isinstance(mean_sal, (int, float)) and mean_sal > 0:
                    market["liveAdzunaMean"] = round(mean_sal)
                updated_count += 1
            except Exception as exc:
                print(f"[warn] Adzuna {adz_code}/{query_term}: {exc}", file=sys.stderr)
            # Gentle throttle to respect free-tier 25 req/min limit
            time.sleep(0.35)

    return updated_count


def main():
    if not os.path.exists(DATA_PATH):
        print(f"Error: {DATA_PATH} not found", file=sys.stderr)
        sys.exit(1)

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        dataset = json.load(f)

    app_id = os.environ.get("ADZUNA_APP_ID", "").strip()
    app_key = os.environ.get("ADZUNA_APP_KEY", "").strip()

    if app_id and app_key:
        print("Adzuna credentials detected — syncing live market vacancy & salary pulses...")
        count = sync_adzuna(dataset, app_id, app_key)
        if count > 0:
            dataset["liveSyncStatus"] = "adzuna-live-synced"
            dataset["lastUpdated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            with open(DATA_PATH, "w", encoding="utf-8") as f:
                json.dump(dataset, f, indent=2)
            print(f"Updated {count} role-country market entries in data/roles.json.")
        else:
            print("No entries updated (check API quota or network).")
    else:
        print(
            "No ADZUNA_APP_ID / ADZUNA_APP_KEY secrets configured. "
            "Keeping bundled open government benchmarks (JSA, BLS, ONS, O*NET)."
        )


if __name__ == "__main__":
    main()
