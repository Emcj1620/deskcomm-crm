-- Cotação imutável e aquisição atômica impedem dois débitos por clique/retry.
-- Nunca armazenar CPF, endereço, PAN, CVV, token ou resposta bruta do provedor.
create table if not exists public.billing_payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  plan_code text not null references public.saas_plans(code) on delete restrict,
  plan_name text not null,
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  payment_method text not null check (payment_method in ('PIX','CREDIT_CARD')),
  installments integer not null check (installments between 1 and 12),
  base_cents integer not null check (base_cents > 0),
  total_cents integer not null check (total_cents >= base_cents),
  status text not null default 'quoted' check (status in ('quoted','processing','pending','uncertain','paid','failed','canceled')),
  provider_payment_id text unique,
  provider_customer_id text,
  provider_installment_id text,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (payment_method <> 'PIX' or installments = 1)
);
create index if not exists billing_payment_intents_org_created on public.billing_payment_intents(organization_id, created_at desc);
create index if not exists billing_payment_intents_creator on public.billing_payment_intents(created_by);
create index if not exists billing_payment_intents_plan on public.billing_payment_intents(plan_code);
-- An uncertain provider response MUST be reconciled, never charged again.
create unique index if not exists billing_payment_intents_one_pending on public.billing_payment_intents(organization_id)
  where status in ('processing','pending','uncertain');
alter table public.billing_payment_intents enable row level security;
revoke all on public.billing_payment_intents from public, anon, authenticated;
grant select, insert, update on public.billing_payment_intents to service_role;

-- Only backend verification of the provider payment may call this transaction.
-- Organization lock serializes renewals; intent lock makes poll + webhook idempotent.
create or replace function public.fn_settle_billing_payment(p_intent uuid, p_org uuid, p_payment text)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  i public.billing_payment_intents%rowtype;
  s public.tenant_subscriptions%rowtype;
  period_start timestamptz;
  period_end timestamptz;
begin
  perform 1 from public.organizations where id = p_org for update;
  select * into i from public.billing_payment_intents where id = p_intent and organization_id = p_org for update;
  if not found or i.provider_payment_id is distinct from p_payment then raise exception 'payment_mismatch'; end if;
  if i.settled_at is not null then return false; end if;
  if i.status not in ('processing','pending','uncertain') then raise exception 'invalid_payment_state'; end if;
  select * into s from public.tenant_subscriptions where organization_id = p_org
    and status in ('trialing','active','past_due','suspended') for update;
  -- No implicit downgrade/proration: a different paid plan is handled by admin.
  if found and s.status = 'active' and s.plan_code <> i.plan_code then raise exception 'plan_change_requires_review'; end if;
  period_start := now();
  period_end := now();
  if s.status = 'active' and s.plan_code = i.plan_code and s.current_period_end > now() then
    period_start := coalesce(s.current_period_start, now());
    period_end := s.current_period_end;
  end if;
  period_end := period_end + case when i.billing_cycle = 'annual' then interval '1 year' else interval '1 month' end;
  if s.id is null then
    insert into public.tenant_subscriptions(organization_id,plan_code,billing_cycle,status,provider,provider_customer_id,current_period_start,current_period_end)
      values(p_org,i.plan_code,i.billing_cycle,'active','asaas',i.provider_customer_id,period_start,period_end);
  else
    update public.tenant_subscriptions set plan_code=i.plan_code,billing_cycle=i.billing_cycle,status='active',
      provider='asaas',provider_customer_id=i.provider_customer_id,provider_subscription_id=null,
      trial_ends_at=null,cancel_at_period_end=false,current_period_start=period_start,current_period_end=period_end
      where id=s.id and organization_id=p_org;
  end if;
  update public.billing_payment_intents set status='paid',settled_at=now() where id=p_intent and organization_id=p_org;
  insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
    values(p_org,i.created_by,'billing.payment_confirmed','billing_payment_intents',i.id,
      jsonb_build_object('total_cents',i.total_cents,'plan_code',i.plan_code,'billing_cycle',i.billing_cycle));
  return true;
end;
$$;
revoke all on function public.fn_settle_billing_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_settle_billing_payment(uuid,uuid,text) to service_role;
