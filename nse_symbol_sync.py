"""
NSE Symbol Master sync
-------------------------------------------------
Downloads NSE India's official list of every listed equity — which
includes BOTH the full legal company name and its trading symbol
together (something Angel One's own data doesn't provide) — and syncs
it into Supabase's `nse_symbol_master` table.

The dashboard checks this table FIRST when resolving a stock name to a
ticker, before falling back to live search or AI-assisted lookup. A
real, verified answer from the exchange itself beats a guess.

IMPORTANT — this could not be tested end-to-end before handing it off:
my own sandbox environment has no network access to nseindia.com at all
(blocked entirely, unrelated to NSE itself), so unlike other scripts in
this project, I was not able to run this against the real site and
confirm it works. It's built on NSE's well-documented, known-working
access pattern (visit the homepage first to establish session cookies,
since NSE blocks direct requests without them) — but if the first
GitHub Actions run fails, save the logs and share them; the fix is
likely a header/cookie tweak, not a rewrite.

Required environment variables (GitHub Actions secrets, already set up
from the APMI sync):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import sys
import csv
import io
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

NSE_HOMEPAGE = "https://www.nseindia.com"
NSE_EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def normalize_name(name: str) -> str:
    """Same normalization the dashboard uses when looking up a stock name,
    so a lookup at query time actually matches a row stored here."""
    s = (name or "").upper().strip()
    s = re.sub(r"\bLIMITED\b\.?$", "", s).strip()
    s = re.sub(r"\bLTD\b\.?$", "", s).strip()
    s = re.sub(r"[^A-Z0-9]", "", s)
    return s


def fetch_equity_list():
    session = requests.Session()
    session.headers.update(HEADERS)

    # NSE blocks direct requests to the archives subdomain without first
    # establishing session cookies via the main site — this step is
    # required, not optional.
    homepage_resp = session.get(NSE_HOMEPAGE, timeout=20)
    print(f"NSE homepage: {homepage_resp.status_code}")
    if homepage_resp.status_code != 200:
        raise RuntimeError(f"Could not reach NSE homepage (status {homepage_resp.status_code}) — cookies not established")

    csv_resp = session.get(
        NSE_EQUITY_LIST_URL,
        headers={**HEADERS, "Referer": NSE_HOMEPAGE},
        timeout=30,
    )
    print(f"NSE equity list: {csv_resp.status_code}, {len(csv_resp.content)} bytes")
    if csv_resp.status_code != 200:
        raise RuntimeError(f"Could not download equity list (status {csv_resp.status_code})")

    return csv_resp.text


def parse_equity_list(csv_text):
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = []
    for row in reader:
        # NSE's column headers: SYMBOL, NAME OF COMPANY, SERIES, ...
        symbol = (row.get("SYMBOL") or "").strip()
        company_name = (row.get("NAME OF COMPANY") or "").strip()
        series = (row.get(" SERIES") or row.get("SERIES") or "").strip()
        if not symbol or not company_name:
            continue
        if series and series != "EQ":
            continue  # only regular equity series, skip debt/preference/etc.
        norm = normalize_name(company_name)
        if not norm:
            continue
        rows.append({"id": norm, "company_name": company_name, "symbol": symbol})
    return rows


def push_to_supabase(rows):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)

    headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Prefer": "resolution=merge-duplicates",
    }

    now = datetime.now(timezone.utc).isoformat()
    batch_size = 500
    total_ok = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        for r in batch:
            r["updated_at"] = now
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/nse_symbol_master",
            headers=headers,
            json=batch,
            timeout=30,
        )
        if resp.ok:
            total_ok += len(batch)
            print(f"[ok] batch {i}-{i+len(batch)}: {len(batch)} rows")
        else:
            print(f"[error] batch {i}-{i+len(batch)}: {resp.status_code} {resp.text[:300]}")

    print(f"\nDone. {total_ok}/{len(rows)} rows synced.")


if __name__ == "__main__":
    print("Fetching NSE equity list...")
    csv_text = fetch_equity_list()
    rows = parse_equity_list(csv_text)
    print(f"Parsed {len(rows)} equity-series companies.")
    push_to_supabase(rows)
