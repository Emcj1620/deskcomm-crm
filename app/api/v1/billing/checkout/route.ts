import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAsaasCheckout } from "@/lib/billing/asaas";
import { ok, fail } from "@/lib/api/wrappers";

const input = z.object({ plan_code: z.string().min(2).max(64), billing_cycle: z.enum(["monthly", "annual"]) });

async function handlePost(req: Request) {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId });
  if (!auth.ok) return auth.response;
  const org = await resolveActiveOrg(auth.user);
  if (!org) return fail("no_active_org", "Nenhuma empresa ativa.", 403, { requestId });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", "Plano ou ciclo inválido.", 422, { requestId });
  const supabase = await createClient();
  const { data: plan } = await supabase.from("saas_plans").select("code,name,monthly_price_cents,annual_price_cents").eq("code", parsed.data.plan_code).eq("is_active", true).maybeSingle();
  if (!plan) return fail("plan_not_found", "Plano não encontrado.", 404, { requestId });
  const cents = parsed.data.billing_cycle === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const annual = parsed.data.billing_cycle === "annual";
  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin.from("asaas_checkout_sessions").insert({ organization_id: org.orgId, plan_code: plan.code, billing_cycle: parsed.data.billing_cycle, created_by: auth.user.id }).select("id").single();
  if (sessionError || !session) return fail("checkout_unavailable", "Não foi possível preparar o checkout.", 503, { requestId });
  const body = {
    // O Asaas não parcela Pix: anual usa cartão em até 12x; mensal aceita Pix
    // ou cartão como cobrança avulsa.
    billingTypes: annual ? ["CREDIT_CARD"] : ["PIX", "CREDIT_CARD"],
    // O Asaas não permite PIX em uma cobrança RECURRENT. O mensal usa uma
    // cobrança avulsa com os dois meios; a renovação será iniciada pelo botão
    // da assinatura, enquanto o anual usa parcelamento no cartão.
    chargeTypes: annual ? ["DETACHED", "INSTALLMENT"] : ["DETACHED"],
    items: [{ name: plan.name.slice(0, 30), quantity: 1, value: cents / 100 }],
    externalReference: session.id,
    callback: { successUrl: `${appUrl}/app/settings/billing?checkout=success`, cancelUrl: `${appUrl}/app/settings/billing?checkout=canceled`, expiredUrl: `${appUrl}/app/settings/billing?checkout=expired` },
    ...(annual ? { installment: { maxInstallmentCount: 12 } } : {}),
  };
  try { const checkout = await createAsaasCheckout(body); await admin.from("asaas_checkout_sessions").update({ provider_checkout_id: checkout.id }).eq("id", session.id); return ok(checkout, { requestId }); }
  catch { return fail("checkout_unavailable", "Não foi possível abrir o checkout agora.", 503, { requestId }); }
}

export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch {
    return fail("checkout_internal_error", "Não foi possível preparar o checkout. Tente novamente em instantes.", 500);
  }
}
