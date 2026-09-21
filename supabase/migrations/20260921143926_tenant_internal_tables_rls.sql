-- Restore tenant isolation on internal tables whose live policies were missing.
-- Service-role workers retain access; anonymous callers have no privileges.
grant execute on function public.fn_session_mfa_proven() to authenticated;
do $migration$
declare
  target text;
  write_role text;
begin
  foreach target in array array[
    'agent_cases', 'agent_case_events', 'conversation_notes',
    'followup_flow_versions', 'followup_flow_pointers',
    'followup_enrollments', 'followup_enrollment_events'
  ] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('revoke all on public.%I from anon', target);
    -- Restrictive fence also protects installations with older permissive policies.
    execute format('drop policy if exists tenant_internal_fence on public.%I', target);
    execute format('create policy tenant_internal_fence on public.%I as restrictive for all to authenticated using (organization_id in (select public.fn_user_org_ids()) and public.fn_session_mfa_proven()) with check (organization_id in (select public.fn_user_org_ids()) and public.fn_session_mfa_proven())', target);
    execute format('drop policy if exists tenant_internal_read on public.%I', target);
    execute format('create policy tenant_internal_read on public.%I for select to authenticated using (organization_id in (select public.fn_user_org_ids()))', target);
    write_role := case when target like 'followup_%%' then 'manager' else 'agent' end;
    execute format('drop policy if exists tenant_internal_insert_role on public.%I', target);
    execute format('create policy tenant_internal_insert_role on public.%I as restrictive for insert to authenticated with check (public.fn_role_at_least(organization_id, %L))', target, write_role);
    execute format('drop policy if exists tenant_internal_update_role on public.%I', target);
    execute format('create policy tenant_internal_update_role on public.%I as restrictive for update to authenticated using (public.fn_role_at_least(organization_id, %L)) with check (public.fn_role_at_least(organization_id, %L))', target, write_role, write_role);
    execute format('drop policy if exists tenant_internal_delete_role on public.%I', target);
    execute format('create policy tenant_internal_delete_role on public.%I as restrictive for delete to authenticated using (public.fn_role_at_least(organization_id, %L))', target, write_role);
    execute format('drop policy if exists tenant_internal_write on public.%I', target);
    execute format('create policy tenant_internal_write on public.%I for all to authenticated using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, %L)) with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, %L))', target, write_role, write_role);
  end loop;
end
$migration$;
