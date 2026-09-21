-- Expansão compatível: catálogo editável sem alterar assinaturas/cobranças.
alter table public.saas_plans drop constraint if exists saas_plans_code_check;
alter table public.saas_plans add constraint saas_plans_code_check
  check (code ~ '^[a-z][a-z0-9_-]{1,63}$');
alter table public.saas_plans add column if not exists is_public boolean not null default true;
alter table public.saas_plans add column if not exists revision integer not null default 1 check (revision > 0);

create table if not exists public.saas_plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null references public.saas_plans(code) on delete restrict,
  revision integer not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (plan_code, revision)
);
alter table public.saas_plan_revisions enable row level security;
revoke all on public.saas_plan_revisions from public, anon, authenticated;
grant select, insert on public.saas_plan_revisions to service_role;

-- Planos sob medida não aparecem para empresas sem vínculo com eles.
drop policy if exists saas_plans_select on public.saas_plans;
create policy saas_plans_select on public.saas_plans for select to authenticated
using (
  (is_active and is_public) or public.fn_is_platform_admin()
  or exists (
    select 1 from public.tenant_subscriptions s
    where s.plan_code = saas_plans.code
      and s.organization_id in (select public.fn_user_org_ids())
  )
);

create or replace function public.fn_admin_save_saas_plan(
  p_plan jsonb, p_actor uuid, p_expected_revision integer default null,
  p_confirm_limits boolean default false
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
set lock_timeout = '4s'
as $$
declare
  v_before public.saas_plans;
  v_after public.saas_plans;
  v_exists boolean;
  v_features jsonb := '{"ai_agents":true,"followups":true}'::jsonb;
begin
  -- Chamável somente pelo backend, após guard exclusivo e MFA. Reconfirma
  -- que a identidade auditada é um administrador ativo, não vem do body HTTP.
  if p_actor is null or not exists (
    select 1 from public.platform_admins where user_id=p_actor and revoked_at is null
  ) then raise exception 'plan_forbidden' using errcode='42501'; end if;

  if jsonb_typeof(p_plan) is distinct from 'object'
    or length(trim(coalesce(p_plan->>'name',''))) not between 2 and 100
    or (p_plan->>'code') is null
    or not (p_plan ?& array['monthly_price_cents','annual_price_cents','max_users','max_whatsapp_numbers','is_active','is_public','sort_order'])
  then raise exception 'plan_invalid' using errcode='22023'; end if;

  select * into v_before from public.saas_plans where code=p_plan->>'code' for update;
  v_exists := found;
  if v_exists and p_expected_revision is null then
    raise exception 'plan_exists' using errcode='23505';
  elsif not v_exists and p_expected_revision is not null then
    raise exception 'plan_not_found' using errcode='P0001';
  elsif v_exists and v_before.revision <> p_expected_revision then
    raise exception 'plan_stale' using errcode='P0001';
  end if;

  if v_exists and (
    v_before.max_users <> (p_plan->>'max_users')::integer
    or v_before.max_whatsapp_numbers <> (p_plan->>'max_whatsapp_numbers')::integer
  ) and exists (
    select 1 from public.tenant_subscriptions where plan_code=v_before.code and status <> 'canceled'
  ) and not coalesce(p_confirm_limits,false) then
    raise exception 'plan_limits_confirmation_required' using errcode='P0001';
  end if;

  -- O trial automático usa essential: não deixe o catálogo oferecer um
  -- estado que o provisionamento ainda não sabe substituir.
  if p_plan->>'code'='essential' and not (p_plan->>'is_active')::boolean then
    raise exception 'plan_default_required' using errcode='P0001';
  end if;

  if v_exists then
    update public.saas_plans set
      name=trim(p_plan->>'name'),
      monthly_price_cents=(p_plan->>'monthly_price_cents')::integer,
      annual_price_cents=(p_plan->>'annual_price_cents')::integer,
      max_users=(p_plan->>'max_users')::integer,
      max_whatsapp_numbers=(p_plan->>'max_whatsapp_numbers')::integer,
      is_active=(p_plan->>'is_active')::boolean,
      is_public=(p_plan->>'is_public')::boolean,
      sort_order=(p_plan->>'sort_order')::integer,
      revision=revision+1
    where code=v_before.code returning * into v_after;
  else
    if p_plan->>'copy_from' is not null then
      select features into v_features from public.saas_plans where code=p_plan->>'copy_from';
      if not found then raise exception 'plan_not_found' using errcode='P0001'; end if;
    end if;
    insert into public.saas_plans (
      code,name,monthly_price_cents,annual_price_cents,max_users,max_whatsapp_numbers,
      is_active,is_public,sort_order,features
    ) values (
      p_plan->>'code',trim(p_plan->>'name'),(p_plan->>'monthly_price_cents')::integer,
      (p_plan->>'annual_price_cents')::integer,(p_plan->>'max_users')::integer,
      (p_plan->>'max_whatsapp_numbers')::integer,(p_plan->>'is_active')::boolean,
      (p_plan->>'is_public')::boolean,(p_plan->>'sort_order')::integer,
      v_features
    ) returning * into v_after;
  end if;

  insert into public.saas_plan_revisions (plan_code,revision,actor_user_id,before_snapshot,after_snapshot)
  values (v_after.code,v_after.revision,p_actor,case when v_exists then to_jsonb(v_before) else null end,to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;
revoke all on function public.fn_admin_save_saas_plan(jsonb,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.fn_admin_save_saas_plan(jsonb,uuid,integer,boolean) to service_role;
comment on function public.fn_admin_save_saas_plan(jsonb,uuid,integer,boolean)
is 'Catálogo: gravação atômica com histórico e revisão otimista. Não chama Asaas nem altera assinaturas.';
