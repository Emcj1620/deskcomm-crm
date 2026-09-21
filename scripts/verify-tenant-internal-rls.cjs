// All checks run in a rolled-back transaction; --apply commits only the migration.
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const sql = readFileSync(join(__dirname, '../supabase/migrations/20260921143926_tenant_internal_tables_rls.sql'), 'utf8');
const tables = ['agent_cases','agent_case_events','conversation_notes','followup_flow_versions','followup_flow_pointers','followup_enrollments','followup_enrollment_events'];
async function main() {
  const db = new Client({ connectionString: process.env.TASK_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let checks = 0;
  try {
    await db.query("begin; set local lock_timeout='4s'; set local statement_timeout='15s'");
    await db.query(sql);
    await db.query(sql);
    const actor = (await db.query('select user_id from public.platform_admins where revoked_at is null limit 1')).rows[0].user_id;
    for (const table of tables) {
      const flags = (await db.query("select c.relrowsecurity rls, has_table_privilege('anon',c.oid,'SELECT') anon from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1", [table])).rows[0];
      assert.deepEqual(flags, {rls:true,anon:false}); checks++;
      await db.query('savepoint identity');
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:'00000000-0000-4000-8000-000000000099',role:'authenticated',aal:'aal2'})]);
      await db.query('set local role authenticated');
      assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0); checks++;
      await db.query('rollback to savepoint identity');
      const expected = (await db.query(`select count(*)::int n from public.${table} where organization_id in (select organization_id from public.user_organizations where user_id=$1 and revoked_at is null)`, [actor])).rows[0].n;
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'})]);
      await db.query('set local role authenticated');
      assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,expected); checks++;
      await db.query('rollback to savepoint identity');
    }
    await db.query('rollback');
    console.log(JSON.stringify({rls_tests:'passed',checks,test_data:'rolled_back'}));
    if(process.argv.includes('--apply')) {
      await db.query("begin; set local lock_timeout='4s'; set local statement_timeout='15s'");
      await db.query(sql); await db.query('commit');
      console.log(JSON.stringify({rls_migration:'applied',tables:tables.length}));
    }
  } finally { await db.query('rollback').catch(()=>{}); await db.end(); }
}
main().catch(e=>{console.error('RLS verification failed:', e.code ?? 'assertion',e.message);process.exitCode=1;});
