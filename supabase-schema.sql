-- ============================================================
-- DecentCare AI Training Studio — Supabase Schema
-- Run this entire file in: Supabase → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── Scenarios ───────────────────────────────────────────────────────────────
create table if not exists scenarios (
  id            text primary key,
  agent_id      text not null,
  type          text not null check (type in ('ideal','edge','guardrail','escalation')),
  input         text not null,
  expected_output text not null,
  tags          text[] default '{}',
  notes         text default '',
  active        boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists scenarios_agent_id_idx on scenarios(agent_id);
create index if not exists scenarios_type_idx on scenarios(type);

-- ─── Knowledge Base ───────────────────────────────────────────────────────────
create table if not exists knowledge_base (
  id            text primary key,
  category      text not null check (category in ('clinical','insurance','faqs','policy')),
  priority      text not null check (priority in ('P1','P2','P3')),
  title         text not null,
  content       text not null,
  agents        text[] default '{}',
  tags          text[] default '{}',
  active        boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists kb_category_idx on knowledge_base(category);
create index if not exists kb_priority_idx on knowledge_base(priority);

-- ─── KB Uploaded Files ────────────────────────────────────────────────────────
create table if not exists kb_files (
  id            text primary key,
  name          text not null,
  size          bigint default 0,
  ext           text,
  content       text,          -- extracted text, capped at 50k chars
  category      text default 'clinical',
  agents        text[] default '{}',
  tags          text[] default '{}',
  uploaded_at   timestamptz default now()
);

-- ─── Call Intelligence ────────────────────────────────────────────────────────
create table if not exists call_intelligence (
  id                    text primary key,
  call_id               text unique,
  direction             text,
  status                text,
  date                  text,
  time                  text,
  duration              integer default 0,
  answered_seconds      integer default 0,
  agent_name            text,
  client_number         text,
  did_number            text,
  recording_url         text,
  transcript            text,
  summary               text,
  topics                text[] default '{}',
  sentiment             text check (sentiment in ('positive','neutral','negative') or sentiment is null),
  key_insights          text[] default '{}',
  training_opportunity  text,
  imported_at           timestamptz default now(),
  processed_at          timestamptz
);

create index if not exists ci_direction_idx on call_intelligence(direction);
create index if not exists ci_status_idx on call_intelligence(status);
create index if not exists ci_sentiment_idx on call_intelligence(sentiment);
create index if not exists ci_date_idx on call_intelligence(date);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists scenarios_updated_at on scenarios;
create trigger scenarios_updated_at
  before update on scenarios
  for each row execute function update_updated_at();

drop trigger if exists kb_updated_at on knowledge_base;
create trigger kb_updated_at
  before update on knowledge_base
  for each row execute function update_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS on all tables (anon key has full access for now)
-- In production, add auth and restrict by org/user
alter table scenarios          enable row level security;
alter table knowledge_base     enable row level security;
alter table kb_files           enable row level security;
alter table call_intelligence  enable row level security;

-- Allow anon key full access (replace with auth-based policies in production)
create policy "anon_all_scenarios"         on scenarios         for all using (true) with check (true);
create policy "anon_all_kb"                on knowledge_base     for all using (true) with check (true);
create policy "anon_all_files"             on kb_files           for all using (true) with check (true);
create policy "anon_all_calls"             on call_intelligence  for all using (true) with check (true);

-- ─── Done ─────────────────────────────────────────────────────────────────────
-- Verify:
-- select table_name from information_schema.tables where table_schema = 'public';
