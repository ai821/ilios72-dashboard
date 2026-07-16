"""
PMS description sync — fund manager bio + detailed strategy write-up
----------------------------------------------------------------------
Reads the most recent factsheet on file (in Supabase's `factsheets`
table) for each PMS, asks an AI model to draft a fund manager bio and
a detailed strategy description from it, and writes the result
straight into `pms_list` (auto-published, no manual approval step).

A summary of what changed is logged as a row in the `notifications`
table so it can be reviewed afterward — this does NOT block
publishing, it's purely a look-back record.

IMPORTANT — this has an upstream dependency: it only works once
factsheet PDFs/text are actually landing in the `factsheets` table
(via the fact-sheet ingestion pipeline). That pipeline hasn't been
built yet as of writing this script — if `factsheets` is empty, this
script will run cleanly but find nothing to draft from.

Required environment variables (GitHub Actions secrets):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY   (bypasses RLS — keep secret, never in frontend code)
    MISTRAL_API_KEY             (or swap in Claude/OpenAI — see call_ai() below)

Suggested schedule: twice a month (see pms-description-sync.yml)
"""

import os
import sys
import json
from datetime import datetime, timezone

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY")

MISTRAL_MODEL = "mistral-large-latest"

EXTRACTION_PROMPT = """You are extracting structured information from a PMS (Portfolio Management Service) factsheet for {pms_name}.

Based on the factsheet text below, produce a JSON object with exactly these three fields:
- "manager_name": the fund/portfolio manager's name (or names, comma-separated if more than one). Use null if not found in the text.
- "manager_bio": a 2-4 sentence factual summary of the manager's background, ONLY using information present in the text. Use null if no manager background is mentioned.
- "strategy_detail": a detailed, well-written paragraph (5-8 sentences) describing the investment strategy, philosophy, and approach, based ONLY on what's in the text. Use null if not enough detail is present.

Rules:
- Do NOT invent, guess, or add any fact not explicitly present in the text below.
- If information for a field genuinely isn't in the text, use null for that field rather than guessing.
- Respond with ONLY the JSON object, no other text, no markdown code fences.

FACTSHEET TEXT:
{factsheet_text}
"""


def sb_headers():
    return {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }


def get_latest_factsheets():
    """One row per pms_id: the most recently received factsheet that has extracted_text."""
    url = (
        f"{SUPABASE_URL}/rest/v1/factsheets"
        "?select=id,pms_id,pms_name,extracted_text,received_at"
        "&extracted_text=not.is.null"
        "&order=pms_id,received_at.desc"
    )
    r = requests.get(url, headers=sb_headers(), timeout=15)
    r.raise_for_status()
    rows = r.json()

    latest = {}
    for row in rows:
        pid = row["pms_id"]
        if pid not in latest:  # already sorted desc by received_at, first hit = latest
            latest[pid] = row
    return list(latest.values())


def call_ai(prompt):
    if not MISTRAL_API_KEY:
        raise RuntimeError("MISTRAL_API_KEY is not set")

    r = requests.post(
        "https://api.mistral.ai/v1/chat/completions",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MISTRAL_API_KEY}",
        },
        json={
            "model": MISTRAL_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
        },
        timeout=60,
    )
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"].strip()

    # Strip accidental markdown fences if the model adds them anyway
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()

    return json.loads(text)


def update_pms_list(pms_id, fields):
    payload = {**fields, "description_updated_at": datetime.now(timezone.utc).isoformat()}
    headers = {**sb_headers(), "Prefer": "return=representation"}
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/pms_list?id=eq.{pms_id}",
        headers=headers,
        json=payload,
        timeout=15,
    )
    return r.ok, (r.text if not r.ok else None)


def log_digest_notification(summary_lines):
    if not summary_lines:
        message = "PMS description sync ran — no factsheets with extractable text were found."
    else:
        message = "PMS description sync updated:\n" + "\n".join(summary_lines)

    payload = {
        "title": "PMS descriptions updated",
        "message": message,
        "type": "info",
    }
    requests.post(
        f"{SUPABASE_URL}/rest/v1/notifications",
        headers={**sb_headers(), "Prefer": "return=representation"},
        json=payload,
        timeout=15,
    )


def main():
    if not all([SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY]):
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        sys.exit(1)

    factsheets = get_latest_factsheets()
    print(f"Found {len(factsheets)} PMS with factsheet text available.")

    if not factsheets:
        print("Nothing to do — no factsheets with extracted_text yet. "
              "(This is expected until the factsheet ingestion pipeline is built.)")
        log_digest_notification([])
        return

    summary_lines = []

    for fs in factsheets:
        pms_id = fs["pms_id"]
        pms_name = fs.get("pms_name") or pms_id
        print(f"\n[{pms_id}] drafting from factsheet id={fs['id']} (received {fs['received_at']})")

        try:
            prompt = EXTRACTION_PROMPT.format(
                pms_name=pms_name,
                factsheet_text=fs["extracted_text"][:12000],  # keep prompt a sane size
            )
            extracted = call_ai(prompt)
        except Exception as e:
            print(f"[{pms_id}] AI extraction failed: {e}")
            summary_lines.append(f"- {pms_name}: FAILED ({e})")
            continue

        fields = {
            k: v for k, v in extracted.items()
            if k in ("manager_name", "manager_bio", "strategy_detail") and v
        }

        if not fields:
            print(f"[{pms_id}] AI returned nothing usable, skipping.")
            summary_lines.append(f"- {pms_name}: no usable content extracted, left unchanged")
            continue

        ok, err = update_pms_list(pms_id, fields)
        if ok:
            print(f"[{pms_id}] published: {list(fields.keys())}")
            summary_lines.append(f"- {pms_name}: updated {', '.join(fields.keys())}")
        else:
            print(f"[{pms_id}] Supabase update failed: {err}")
            summary_lines.append(f"- {pms_name}: Supabase write FAILED ({err})")

    log_digest_notification(summary_lines)
    print("\nDone. Digest logged to notifications table for review.")


if __name__ == "__main__":
    main()
