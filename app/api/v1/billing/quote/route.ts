import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { cardTotal, checkoutSelection, installmentAmounts } from "@/lib/billing/payment-quote";
import { paymentRequest } from "@/lib/billing/asaas-payments";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const auth = await requireRole("admin", { requestId });
    if (!auth.ok) return auth.response;
    const parsed = checkoutSelection.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("validation_error", "Confira o plano, o pagamento e as parcelas.", 422, { requestId });
    const selection = parsed.data;
    const db = await createClient();
    const { data: plan, error } = await db.from("saas_plans").select("code,name,is_public,monthly_price_cents,annual_price_cents")
      .eq("code", selection.plan_code).eq("is_active", true).maybeSingle();
    if (error || !plan) return fail("plan_not_found", "Plano indisponível.", 404, { requestId });
    const { data: current, error: subscriptionError } = await db.from("tenant_subscriptions").select("plan_code,status")
      .eq("organization_id", auth.org.orgId).in("status", ["trialing", "active", "past_due", "suspended"]).maybeSingle();
    if (subscriptionError) throw new Error("subscription_unavailable");
    if (!plan.is_public && current?.plan_code !== plan.code) return fail("plan_not_found", "Plano indisponível para esta empresa.", 404, { requestId });
    if (current?.status === "active" && current.plan_code !== plan.code) return fail("plan_change_requires_review", "Para trocar seu plano ativo, fale com a administração. Você pode renovar seu plano atual por aqui.", 409, { requestId });
    const base = selection.billing_cycle === "annual" ? plan.annual_price_cents : plan.monthly_price_cents;
    if (!Number.isSafeInteger(base) || base <= 0) return fail("invalid_price", "Este plano exige atendimento para contratação.", 422, { requestId });
    let total = base;
    if (selection.payment_method === "CREDIT_CARD") {
      const fees = await paymentRequest("/myAccount/fees/", z.object({ payment: z.object({ creditCard: z.unknown() }) }));
      total = cardTotal(base, selection.installments, fees.payment.creditCard).total_cents;
      const simulation = await paymentRequest("/payments/simulate", z.object({ creditCard: z.object({ netValue: z.number() }) }), {
        value: total / 100, installmentCount: selection.installments, billingTypes: ["CREDIT_CARD"],
      });
      if (Math.abs(Math.round(simulation.creditCard.netValue * 100) - base) > selection.installments) throw new Error("fee_simulation_mismatch");
    }
    const { data: intent, error: insertError } = await createAdminClient().from("billing_payment_intents").insert({
      organization_id: auth.org.orgId, created_by: auth.user.id, ...selection,
      plan_name: plan.name, base_cents: base, total_cents: total,
    }).select("id,expires_at").single();
    if (insertError || !intent) throw new Error("payment_store_unavailable");
    await audit({ action: "billing.quote_created", actorUserId: auth.user.id, organizationId: auth.org.orgId, resourceType: "billing_payment_intents", resourceId: intent.id, requestId });
    return ok({ ...intent, ...selection, plan_name: plan.name, base_cents: base, total_cents: total, surcharge_cents: total - base, ...installmentAmounts(total, selection.installments), currency: "BRL" }, { requestId, headers: { "Cache-Control": "no-store" } });
  } catch { return fail("quote_unavailable", "Não foi possível calcular o pagamento. Nenhuma cobrança foi criada.", 503, { requestId }); }
}
