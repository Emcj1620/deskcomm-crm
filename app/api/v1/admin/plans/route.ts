import { randomUUID } from "node:crypto";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { createPlanSchema, editPlanSchema, planWriteError } from "@/lib/billing/plan-catalog";
import { audit } from "@/lib/audit";

async function savePlan(req: Request, editing: boolean) {
  const requestId = randomUUID();
  let ctx;
  try { ctx = await requirePlatformAdmin(); }
  catch { return fail("forbidden", "Acesso exclusivo do Super Admin com autenticação em duas etapas.", 403, { requestId }); }
  const user = await loadAuthUser();
  if (!user || user.support) return fail("forbidden", "Saia do acompanhamento de empresa antes de alterar o catálogo da plataforma.", 403, { requestId });
  const parsed = (editing ? editPlanSchema : createPlanSchema).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", "Confira os campos do plano.", 422, { requestId, details: parsed.error.flatten() });
  const { expected_revision, confirm_existing_limits, ...plan } = {
    expected_revision: null as number | null, confirm_existing_limits: false, ...parsed.data,
  };
  const { data, error } = await createAdminClient().rpc("fn_admin_save_saas_plan", {
    p_plan: plan, p_actor: ctx.user.id,
    p_expected_revision: expected_revision, p_confirm_limits: confirm_existing_limits,
  });
  if (error) {
    const result = planWriteError(error.code, error.message);
    return fail("plan_save_failed", result.message, result.status, { requestId });
  }
  // Histórico atômico salvo pela RPC; nenhuma chamada de cobrança é feita.
  await audit({ action: editing ? "platform.plan_updated" : "platform.plan_created",
    actorUserId: ctx.user.id, actingAsPlatformAdmin: true, bypassedRls: true,
    resourceType: "saas_plan", requestId,
    metadata: { code: plan.code, revision: data.revision, existing_limits_confirmed: confirm_existing_limits },
  });
  return ok(data, { requestId });
}
export const POST = (req: Request) => savePlan(req, false);
export const PATCH = (req: Request) => savePlan(req, true);
