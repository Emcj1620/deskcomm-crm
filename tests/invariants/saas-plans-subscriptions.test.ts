import { beforeAll, describe, expect, it } from "vitest";
import { GOV_MANAGER, GOV_ORG, countAs, seedGov, sql } from "./gov-helpers";

const ORG_B = "5aa50000-0000-4000-8000-000000000002";
const USER_B = "5aa50000-1111-4000-8000-000000000002";

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${USER_B}', 'saas-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'saas-invariant-b', 'SaaS B', 'SaaS B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${ORG_B}', 'manager', now())
      on conflict do nothing;
  `);
});

describe("catálogo e assinaturas SaaS — isolamento e grants", () => {
  it("semeia exatamente os três planos comerciais com os limites contratados", () => {
    expect(
      sql(`select string_agg(code || ':' || max_users || ':' || max_whatsapp_numbers, ',' order by sort_order) from public.saas_plans;`),
    ).toBe("essential:2:1,professional:5:3,business:10:5");
  });

  it("uma nova organização recebe trial Essencial automaticamente", () => {
    expect(
      sql(`select plan_code || ':' || status from public.tenant_subscriptions where organization_id='${ORG_B}';`),
    ).toBe("essential:trialing");
  });

  it("membro lê a própria assinatura e não enxerga a de outro tenant", () => {
    expect(
      countAs(USER_B, `select count(*) from public.tenant_subscriptions where organization_id='${ORG_B}';`),
    ).toBe(1);
    expect(
      countAs(USER_B, `select count(*) from public.tenant_subscriptions where organization_id='${GOV_ORG}';`),
    ).toBe(0);
    expect(
      countAs(GOV_MANAGER, `select count(*) from public.tenant_subscriptions where organization_id='${ORG_B}';`),
    ).toBe(0);
  });

  it("authenticated não possui caminho de escrita nas duas tabelas comerciais", () => {
    expect(
      sql(`select has_table_privilege('authenticated','public.saas_plans','INSERT')::int || ':' || has_table_privilege('authenticated','public.tenant_subscriptions','UPDATE')::int;`),
    ).toBe("0:0");
  });
});
