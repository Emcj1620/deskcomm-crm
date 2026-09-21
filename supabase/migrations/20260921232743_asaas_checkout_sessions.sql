create table if not exists public.asaas_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  plan_code text not null references public.saas_plans(code) on delete restrict,
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  provider_checkout_id text unique,
  status text not null default 'created' check (status in ('created','paid','canceled','expired','failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.asaas_checkout_events (
  event_id text primary key,
  checkout_id uuid references public.asaas_checkout_sessions(id) on delete restrict,
  event_name text not null,
  received_at timestamptz not null default now()
);
alter table public.asaas_checkout_sessions enable row level security;
alter table public.asaas_checkout_events enable row level security;
revoke all on public.asaas_checkout_sessions, public.asaas_checkout_events from public, anon, authenticated;
grant select, insert, update on public.asaas_checkout_sessions to service_role;
grant select, insert on public.asaas_checkout_events to service_role;
create index if not exists asaas_checkout_sessions_org_idx on public.asaas_checkout_sessions(organization_id, created_at desc);
