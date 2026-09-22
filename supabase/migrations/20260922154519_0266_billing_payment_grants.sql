-- Supabase default ACL also grants DELETE/TRUNCATE to service_role.
revoke all on public.billing_payment_intents from public, anon, authenticated, service_role;
grant select, insert, update on public.billing_payment_intents to service_role;
