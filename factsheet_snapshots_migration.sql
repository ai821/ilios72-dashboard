-- ============================================
-- ILIOS72 — Factsheet holdings snapshots
-- Safe to run anytime: only ADDS a new table,
-- never touches existing data.
--
-- Purpose: every time a factsheet is analysed, we
-- store its parsed stock-level holdings here. The
-- NEXT time a factsheet for the same PMS is
-- analysed, the dashboard compares against the
-- most recent snapshot to detect what the fund
-- manager actually changed (new positions, exits,
-- increased/reduced weights) — this is what powers
-- the new "Portfolio Moves" section.
-- ============================================

create table if not exists public.factsheet_snapshots (
  id text primary key,
  pms_id text references public.pms_list(id) on delete cascade,
  period text,
  holdings jsonb,
  manager_name text,
  captured_at timestamptz default now()
);

alter table public.factsheet_snapshots enable row level security;

create policy "Company users see all factsheet snapshots"
  on public.factsheet_snapshots for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'company'
    )
  );

create policy "Company users can manage factsheet snapshots"
  on public.factsheet_snapshots for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'company'
    )
  );

create index if not exists idx_factsheet_snapshots_pms_captured
  on public.factsheet_snapshots (pms_id, captured_at desc);
