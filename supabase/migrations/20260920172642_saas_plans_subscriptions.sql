-- Catálogo comercial e assinatura por tenant.
-- A cobrança Asaas entra depois; esta migration cria o contrato estável que o
-- webhook preencherá sem misturar dados financeiros com organizations.

create table if not exists public.saas_plans (
  code text primary key,
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  annual_price_cents integer not null check (annual_price_cents >= 0),
  max_users integer not null check (max_users > 0),
  max_whatsapp_numbers integer not null check (max_whatsapp_numbers > 0),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saas_plans_code_check check (code in ('essential', 'professional', 'business'))
);

insert into public.saas_plans
  (code, name, monthly_price_cents, annual_price_cents, max_users, max_whatsapp_numbers, features, sort_order)
values
  ('essential', 'Essencial', 7990, 79900, 2, 1,
    '{"ai_agents":true,"followups":true,"suggested_replies":true}'::jsonb, 10),
  ('professional', 'Profissional', 14990, 149900, 5, 3,
    '{"ai_agents":true,"followups":true,"suggested_replies":true,"automations":true,"reports":true}'::jsonb, 20),
  ('business', 'Business', 24990, 249900, 10, 5,
    '{"ai_agents":true,"followups":true,"suggested_replies":true,"automations":true,"reports":true,"priority_support":true}'::jsonb, 30)
on conflict (code) do update set
  name = excluded.name,
  monthly_price_cents = excluded.monthly_price_cents,
  annual_price_cents = excluded.annual_price_cents,
  max_users = excluded.max_users,
  max_whatsapp_numbers = excluded.max_whatsapp_numbers,
  features = excluded.features,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  plan_code text not null references public.saas_plans(code) on update cascade on delete restrict,
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'annual')),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider text check (provider is null or provider in ('asaas', 'manual', 'grandfathered')),
  provider_customer_id text,
  provider_subscription_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_subscriptions_period_check check (
    current_period_end is null or current_period_start is null or current_period_end > current_period_start
  )
);

create unique index if not exists tenant_subscriptions_one_current_per_org
  on public.tenant_subscriptions (organization_id)
  where status in ('trialing', 'active', 'past_due', 'suspended');
create unique index if not exists tenant_subscriptions_provider_unique
  on public.tenant_subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;
create index if not exists tenant_subscriptions_org_history
  on public.tenant_subscriptions (organization_id, created_at desc);

drop trigger if exists trg_saas_plans_updated_at on public.saas_plans;
create trigger trg_saas_plans_updated_at before update on public.saas_plans
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_tenant_subscriptions_updated_at on public.tenant_subscriptions;
create trigger trg_tenant_subscriptions_updated_at before update on public.tenant_subscriptions
  for each row execute function public.fn_set_updated_at();

-- Organizações já existentes não podem perder capacidade ao receber a camada
-- comercial: entram como Business legado até o Super Admin escolher um plano.
insert into public.tenant_subscriptions
  (organization_id, plan_code, billing_cycle, status, provider, current_period_start, metadata)
select o.id, 'business', 'monthly', 'active', 'grandfathered', now(),
       '{"reason":"pre_saas_tenant"}'::jsonb
from public.organizations o
where not exists (
  select 1 from public.tenant_subscriptions s
  where s.organization_id = o.id
    and s.status in ('trialing', 'active', 'past_due', 'suspended')
);

create or replace function public.fn_attach_default_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.tenant_subscriptions
    (organization_id, plan_code, billing_cycle, status, trial_ends_at, current_period_start, current_period_end, provider)
  values
    (new.id, 'essential', 'monthly', 'trialing', now() + interval '14 days', now(), now() + interval '14 days', 'manual')
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.fn_attach_default_subscription() from public, anon, authenticated;

drop trigger if exists trg_organizations_default_subscription on public.organizations;
create trigger trg_organizations_default_subscription
  after insert on public.organizations
  for each row execute function public.fn_attach_default_subscription();

alter table public.saas_plans enable row level security;
alter table public.tenant_subscriptions enable row level security;
revoke all on table public.saas_plans, public.tenant_subscriptions from anon, authenticated;
grant select on table public.saas_plans, public.tenant_subscriptions to authenticated;

drop policy if exists saas_plans_select on public.saas_plans;
create policy saas_plans_select on public.saas_plans for select to authenticated
  using (is_active or public.fn_is_platform_admin());

drop policy if exists tenant_subscriptions_select on public.tenant_subscriptions;
create policy tenant_subscriptions_select on public.tenant_subscriptions for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

comment on table public.saas_plans is 'Catálogo comercial da plataforma; preços em centavos e limites server-side.';
comment on table public.tenant_subscriptions is 'Histórico de assinatura pertencente ao tenant; escrita somente por backend privilegiado.';
