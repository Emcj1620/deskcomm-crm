/* Teste transacional: os planos/edições de teste sempre terminam em ROLLBACK.
 * --apply aplica somente a migration, numa transação separada após os testes.
 * Credencial recebida por TASK_DB_URL, nunca impressa ou gravada neste arquivo. */
const { Client } = require("pg");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const sql = readFileSync(join(__dirname, "../supabase/migrations/20260921142216_saas_custom_plans_catalog.sql"), "utf8");

async function main() {
  if (!process.env.TASK_DB_URL) throw new Error("TASK_DB_URL ausente");
  const db = new Client({ connectionString: process.env.TASK_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let assertions = 0;
  const check = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  async function expectFailure(fn, message) {
    await db.query("savepoint expected_failure");
    let caught;
    try { await fn(); } catch (error) { caught = error; }
    await db.query("rollback to savepoint expected_failure");
    assert.ok(caught && caught.message.includes(message), `Esperava recusa: ${message}`);
    assertions++;
  }
  try {
    await db.query("begin; set local lock_timeout='4s'; set local statement_timeout='15s'");
    await db.query(sql);
    await db.query(sql); // idempotência
    const actor = (await db.query("select user_id from public.platform_admins where revoked_at is null limit 1")).rows[0]?.user_id;
    assert.ok(actor, "Administrador existente necessário");
    const privileges = (await db.query("select has_function_privilege('anon','public.fn_admin_save_saas_plan(jsonb,uuid,integer,boolean)','EXECUTE') as anon, has_function_privilege('authenticated','public.fn_admin_save_saas_plan(jsonb,uuid,integer,boolean)','EXECUTE') as member, has_function_privilege('service_role','public.fn_admin_save_saas_plan(jsonb,uuid,integer,boolean)','EXECUTE') as backend")).rows[0];
    check(privileges, { anon: false, member: false, backend: true });
    const plan = { code: `qa_catalog_${Date.now()}`, name: "QA transacional — sem cobrança", monthly_price_cents: 12345, annual_price_cents: 123450,
      max_users: 7, max_whatsapp_numbers: 4, is_active: true, is_public: false, sort_order: 999 };
    async function save(fields, revision = null, confirm = false, user = actor) {
      return (await db.query("select public.fn_admin_save_saas_plan($1::jsonb,$2::uuid,$3::integer,$4::boolean) as plan", [JSON.stringify(fields), user, revision, confirm])).rows[0].plan;
    }
    const created = await save(plan);
    check(created.revision, 1);
    check(created.is_public, false);
    await expectFailure(() => save(plan), "plan_exists");
    await expectFailure(() => save({ ...plan, code: "../invalid" }), "saas_plans_code_check");
    await expectFailure(() => save({ ...plan, max_users: 0 }, 1), "check constraint");
    await expectFailure(() => save({ ...plan, code: "qa_forbidden" }, null, false, "00000000-0000-4000-8000-000000000099"), "plan_forbidden");
    const edited = await save({ ...plan, name: "QA editado", monthly_price_cents: 56789 }, 1);
    check(edited.revision, 2);
    check(edited.monthly_price_cents, 56789);
    await expectFailure(() => save(plan, 1), "plan_stale");
    const history = (await db.query("select revision, before_snapshot, after_snapshot from public.saas_plan_revisions where plan_code=$1 order by revision", [plan.code])).rows;
    check(history.length, 2);
    check(history[0].before_snapshot, null);
    check(history[1].before_snapshot.monthly_price_cents, 12345);
    check(history[1].after_snapshot.monthly_price_cents, 56789);
    // Papel authenticated sem vínculo não descobre o plano privado, nem o histórico.
    await db.query("savepoint rls_test");
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: "00000000-0000-4000-8000-000000000099", role: "authenticated", aal: "aal1" })]);
    await db.query("set local role authenticated");
    check((await db.query("select code from public.saas_plans where code=$1", [plan.code])).rows.length, 0);
    await expectFailure(() => db.query("select * from public.saas_plan_revisions"), "permission denied");
    await expectFailure(() => save(plan, 2), "permission denied");
    await db.query("rollback to savepoint rls_test");
    const linked = (await db.query("select p.* from public.saas_plans p where exists(select 1 from public.tenant_subscriptions s where s.plan_code=p.code and s.status <> 'canceled') limit 1")).rows[0];
    if (linked) {
      const changed = { ...linked, max_users: linked.max_users + 1 };
      await expectFailure(() => save(changed, linked.revision), "plan_limits_confirmation_required");
      check((await save(changed, linked.revision, true)).max_users, linked.max_users + 1);
    }
    const essential = (await db.query("select * from public.saas_plans where code='essential'")).rows[0];
    if (essential) await expectFailure(() => save({ ...essential, is_active: false }, essential.revision), "plan_default_required");
    await db.query("rollback");
    console.log(JSON.stringify({ transaction_tests: "passed", assertions, test_data: "rolled_back" }));
    if (process.argv.includes("--apply")) {
      await db.query("begin; set local lock_timeout='4s'; set local statement_timeout='15s'");
      await db.query(sql);
      await db.query("commit");
      console.log(JSON.stringify({ migration: "applied", catalog_rows: (await db.query("select count(*)::int n from public.saas_plans")).rows[0].n }));
    }
  } finally { await db.query("rollback").catch(() => {}); await db.end(); }
}
main().catch(error => { console.error("Verificação falhou:", error.code ?? "assertion", error.message); process.exitCode = 1; });
