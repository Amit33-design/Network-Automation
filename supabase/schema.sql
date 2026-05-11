-- NetDesign AI — Supabase cloud schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Enables Row Level Security on all tables so users only see their own data.

-- ── Extensions ───────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ── Organizations ─────────────────────────────────────────────────────────────

create table if not exists organizations (
  id               uuid primary key default uuid_generate_v4(),
  stripe_customer  text unique,
  email            text not null,
  plan             text not null default 'free'  check (plan in ('free','pro','team','dept')),
  seats            int  not null default 0,
  license_key      text,
  upgraded_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table organizations is 'One row per paying customer / team.';

alter table organizations enable row level security;
-- Orgs are managed by service role only (Stripe webhook writes, no user-facing RLS needed)

-- ── License keys ──────────────────────────────────────────────────────────────

create table if not exists license_keys (
  id               uuid primary key default uuid_generate_v4(),
  key              text not null unique,                          -- NDA-XXXX-XXXX-XXXX
  plan             text not null default 'pro',
  seats            int  not null default 1,
  stripe_customer  text references organizations(stripe_customer) on delete set null,
  email            text not null,
  is_active        boolean not null default true,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

comment on table license_keys is 'One row per license issued. Checked by /api/license/validate.';

create index if not exists license_keys_key_idx on license_keys(key);
create index if not exists license_keys_email_idx on license_keys(email);

alter table license_keys enable row level security;

-- ── Designs ───────────────────────────────────────────────────────────────────

create table if not exists designs (
  id               uuid primary key default uuid_generate_v4(),
  owner_id         text not null,                                 -- Clerk user ID
  name             text not null,
  use_case         text not null default 'unknown',
  vendor           text not null default 'multi',
  intent           jsonb not null default '{}',
  topology_params  jsonb not null default '{}',
  config_bundle    text,                                          -- raw config text (optional)
  is_deleted       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table designs is 'Saved network designs. Embedded in Pinecone on insert.';

create index if not exists designs_owner_idx      on designs(owner_id) where not is_deleted;
create index if not exists designs_use_case_idx   on designs(use_case) where not is_deleted;
create index if not exists designs_created_at_idx on designs(created_at desc);

alter table designs enable row level security;

create policy "Users see own designs"
  on designs for select
  using (owner_id = auth.uid()::text);

create policy "Users insert own designs"
  on designs for insert
  with check (owner_id = auth.uid()::text);

create policy "Users update own designs"
  on designs for update
  using (owner_id = auth.uid()::text);

-- ── Deployments ───────────────────────────────────────────────────────────────

create table if not exists deployments (
  id               uuid primary key default uuid_generate_v4(),
  design_id        uuid references designs(id) on delete set null,
  owner_id         text not null,
  status           text not null default 'pending'
                     check (status in ('pending','running','success','failed','partial')),
  summary          jsonb not null default '{}',
  error            text,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now()
);

comment on table deployments is 'One row per deploy run. Status streamed via Supabase Realtime.';

create index if not exists deployments_owner_idx     on deployments(owner_id);
create index if not exists deployments_design_idx    on deployments(design_id);
create index if not exists deployments_created_at_idx on deployments(created_at desc);

alter table deployments enable row level security;

create policy "Users see own deployments"
  on deployments for select
  using (owner_id = auth.uid()::text);

create policy "Users insert own deployments"
  on deployments for insert
  with check (owner_id = auth.uid()::text);

-- ── Realtime — enable broadcast on deployments ────────────────────────────────

-- In Supabase dashboard: Database → Replication → enable "deployments" table

-- ── Updated_at trigger ────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger designs_updated_at
  before update on designs
  for each row execute function set_updated_at();

create trigger orgs_updated_at
  before update on organizations
  for each row execute function set_updated_at();
