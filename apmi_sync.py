"""
APMI -> Supabase sync (for GitHub Actions)
-------------------------------------------------
This replaces apmi_proxy.py's "wait for a browser click on localhost" model.
Instead of running a local Flask server, this script runs ONCE, scrapes all
PMS from APMI, and writes the results straight into the `pms_list` table in
Supabase. It's meant to be triggered on a schedule by GitHub Actions, so it
works even if your laptop is off and nobody has the dashboard open.

Required environment variables (set as GitHub Actions secrets, never commit
these to the repo):
    SUPABASE_URL                e.g. https://xbetqhmzwolivitmsuyn.supabase.co
    SUPABASE_SERVICE_ROLE_KEY   the SERVICE ROLE key (NOT the anon key) —
                                 found in Supabase Dashboard -> Project
                                 Settings -> API -> "service_role" secret.
                                 This key bypasses Row Level Security, which
                                 is exactly why it must stay a secret and
                                 never appear in frontend code or the repo.

Local test run (optional, before wiring up GitHub Actions):
    pip install playwright requests
    playwright install chromium
    set SUPABASE_URL=https://xbetqhmzwolivitmsuyn.supabase.co        (Windows)
    set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
    python apmi_sync.py
"""

import os
import re
import sys
from datetime import date, datetime, timezone

import requests
from playwright.sync_api import sync_playwright

URL = "https://apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu"

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# ---------------------------------------------------------------------------
# Maps each dashboard PMS `id` (matches pms_list.id in Supabase) to the exact
# provider/IA name APMI expects in its dropdowns.
# ---------------------------------------------------------------------------
PMS_MAP = [
    {"id": "stallion",     "provider": "Stallion Asset Private Limited",              "ia_name": "STALLION ASSET CORE FUND"},
    {"id": "negen",        "provider": "Negen Capital Services Private Lmited",       "ia_name": "Negen Special Situations & Dynamic Allocation Strategy"},
    {"id": "abakkus",      "provider": "Abakkus Asset Manager Private Limited",       "ia_name": "Abakkus Diversified Alpha Approach"},
    {"id": "sameeksha",    "provider": "Sameeksha Capital Private Limited",           "ia_name": "Sameeksha India Equity Fund"},
    {"id": "hem_dream",    "provider": "Hem Securities Limited",                      "ia_name": "Dynamic Research & Emerging Asset Management Strategy (DREAM)"},
    {"id": "icici_pipe",   "provider": "ICICI Prudential Asset Management Company Ltd","ia_name": "ICICI Prudential PMS PIPE Strategy"},
    {"id": "buoyant",      "provider": "Buoyant Capital Private Limited",             "ia_name": "Buoyant Opportunities PMS"},
    {"id": "renaissance",  "provider": "Renaissance Investment Managers Private Limited", "ia_name": "Renaissance India Next Portfolio"},
    {"id": "2point2",      "provider": "2point2 Capital Advisors Llp",                "ia_name": "2Point2 Long Term Value Fund"},
    {"id": "hem_sme",      "provider": "Hem Securities Limited",                      "ia_name": "India Rising SME Stars"},
]

# Only these fields exist as real columns on pms_list — anything else the
# scraper picks up (e.g. r2y) gets dropped before writing to Supabase so we
# never send a column that doesn't exist.
PMS_LIST_COLUMNS = {"aum", "r1m", "r3m", "r6m", "r1y", "r3y", "r4y", "r5y", "rsi"}

HEADER_FIELD_MAP = [
    ("since inception", "rsi"),
    ("1 month", "r1m"), ("3 month", "r3m"), ("6 month", "r6m"),
    ("1 year", "r1y"), ("2 year", "r2y"), ("3 year", "r3y"),
    ("4 year", "r4y"), ("5 year", "r5y"),
    ("aum", "aum"),
]


def to_float(s):
    if s is None:
        return None
    s = s.strip().replace("₹", "").replace(",", "").replace("Cr", "").strip()
    if s.upper() in ("NA", "ND", "—", "-", ""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def select_by_visible_text(select_locator, text, timeout=5000):
    for o in select_locator.locator("option").all():
        if o.inner_text().strip() == text:
            if o.get_attribute("disabled") is not None:
                raise RuntimeError(f"Option '{text}' is disabled (not yet published)")
            val = o.get_attribute("value")
            select_locator.select_option(value=val, timeout=timeout)
            return True
    return False


def get_candidate_periods(max_back=4):
    today = date.today()
    y, m = today.year, today.month
    candidates = []
    for _ in range(max_back):
        candidates.append((f"{m:02d}", str(y)))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return candidates


def parse_results_table(page):
    for table in page.query_selector_all("table"):
        header_cells = table.query_selector_all("thead th")
        headers = [re.sub(r"\s+", " ", h.inner_text().strip()).lower() for h in header_cells]
        if not headers:
            continue

        for row in table.query_selector_all("tbody tr"):
            cells = [c.inner_text().strip() for c in row.query_selector_all("td")]
            if len(cells) == 1 and "no record" in cells[0].lower():
                return {"status": "NO_DATA"}
            if len(cells) != len(headers):
                continue

            result = {"status": "OK"}
            for header_text, cell_text in zip(headers, cells):
                for key, field in HEADER_FIELD_MAP:
                    if key in header_text:
                        result[field] = to_float(cell_text)
                        break
            if "aum" in result:
                return result

    return {"status": "NO_DATA"}


def scrape_one(page, provider, ia_name, month=None, year=None):
    page.goto(URL, wait_until="domcontentloaded", timeout=15000)

    provider_select = page.locator("#pmsProvideName")
    ia_select = page.locator("#pmsInvAprochName")
    month_select = page.locator("#fromMonth")
    year_select = page.locator("#fromYears")
    submit_button = page.locator("button:has-text('Submit')")

    provider_select.wait_for(state="visible", timeout=10000)
    provider_select.select_option(label=provider, timeout=5000)
    page.wait_for_timeout(500)
    ia_select.select_option(label=ia_name, timeout=5000)
    if year:
        select_by_visible_text(year_select, year)
        page.wait_for_timeout(300)
    if month:
        select_by_visible_text(month_select, month)
        page.wait_for_timeout(200)
    submit_button.click(timeout=5000)
    page.wait_for_load_state("domcontentloaded", timeout=10000)
    page.wait_for_timeout(800)

    return parse_results_table(page)


def scrape_with_fallback(page, provider, ia_name):
    last_error = None
    for month, year in get_candidate_periods():
        try:
            result = scrape_one(page, provider, ia_name, month=month, year=year)
        except Exception as e:
            last_error = str(e).splitlines()[0]
            continue
        if result["status"] == "OK":
            result["period"] = f"{month}/{year}"
            return result
    return {"status": "NO_DATA", "note": f"tried last 4 months, last_error={last_error}"}


def run_scrape():
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        for item in PMS_MAP:
            try:
                result = scrape_with_fallback(page, item["provider"], item["ia_name"])
                print(f"[{item['id']}] -> {result.get('status')} {result.get('period', '')}")
            except Exception as e:
                import traceback
                print(f"[{item['id']}] -> EXCEPTION:")
                traceback.print_exc()
                result = {"status": f"ERROR: {e}"}
            result["id"] = item["id"]
            results.append(result)
        browser.close()
    return results


def push_to_supabase(results):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set as environment variables.")
        sys.exit(1)

    headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }

    now = datetime.now(timezone.utc).isoformat()
    updated, skipped = 0, 0

    for r in results:
        if r.get("status") != "OK":
            print(f"[skip] {r['id']}: status={r.get('status')} (no update sent, keeping existing DB values)")
            skipped += 1
            continue

        payload = {"id": r["id"], "updated_at": now}
        for field in PMS_LIST_COLUMNS:
            if field in r:
                payload[field] = r[field]

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/pms_list",
            headers=headers,
            json=[payload],
            timeout=15,
        )
        if resp.ok:
            print(f"[ok] {r['id']}: pushed to Supabase")
            updated += 1
        else:
            print(f"[error] {r['id']}: Supabase rejected update -> {resp.status_code} {resp.text}")

    print(f"\nDone. Updated: {updated}, Skipped: {skipped}, Total: {len(results)}")


if __name__ == "__main__":
    print("Starting APMI scrape...")
    results = run_scrape()
    print("\nPushing results to Supabase...")
    push_to_supabase(results)
