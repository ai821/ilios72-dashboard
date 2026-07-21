"""
Quick test ONLY — not the real thing yet.
-------------------------------------------------
Tries a single company-name lookup against Yahoo Finance's (unofficial)
search endpoint, from inside GitHub Actions, and prints exactly what comes
back. Nothing here touches Supabase or the dashboard — this purely answers
one question: does this endpoint respond normally from a GitHub Actions
runner, the way it does for other tools that use it, or does it get
blocked the same way NSE did?

Run this, then read the printed output — that's the whole point of this
script. If it works, we build the real sync next. If it doesn't, we stop
here having spent a few minutes, not a few hours.
"""

import requests

TEST_QUERIES = ["Diffusion Engineers", "Reliance Industries", "VIP Industries"]

for query in TEST_QUERIES:
    print(f"\n--- Testing: '{query}' ---")
    try:
        resp = requests.get(
            "https://query1.finance.yahoo.com/v1/finance/search",
            params={"q": query, "quotesCount": 5, "newsCount": 0},
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=15,
        )
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            quotes = data.get("quotes", [])
            if not quotes:
                print("No quotes returned (empty result)")
            for q in quotes[:5]:
                print(f"  symbol={q.get('symbol')}  name={q.get('longname') or q.get('shortname')}  exchange={q.get('exchange')}")
        else:
            print(f"Non-200 response body (first 300 chars): {resp.text[:300]}")
    except Exception as e:
        print(f"REQUEST FAILED: {e}")

print("\n--- Test complete ---")
