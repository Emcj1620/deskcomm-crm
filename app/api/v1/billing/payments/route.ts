import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { getPaymentIntent, reconcilePayment, updatePaymentIntent, type PaymentIntent } from "@/lib/billing/native-payments";
import { paymentRequest, PaymentProviderError, providerPaymentSchema } from "@/lib/billing/asaas-payments";
import { checkoutSelection } from "@/lib/billing/payment-quote";

const digits = (min: number, max: number) => z.string().transform((s) => s.replace(/[ .\-/()+]/g, "")).pipe(z.string().regex(/^\d+$/).min(min).max(max));
const payerSchema = z.object({ name: z.string().trim().min(3).max(120), email: z.email().max(180), cpf_cnpj: digits(11, 14).refine((s) => s.length === 11 || s.length === 14), phone: digits(10, 11), postal_code: digits(8, 8), address_number: z.string().trim().min(1).max(20) });
const input = z.object({
  intent_id: z.uuid(), payer: payerSchema,
  card: z.object({ holder_name: z.string().trim().min(3).max(120), number: digits(13, 19), expiry_month: z.string().regex(/^(0[1-9]|1[0-2])$/), expiry_year: z.string().regex(/^20\d{2}$/), ccv: digits(3, 4) }).optional(),
});

export async function GET(request: Request) {
  const requestId = randomUUID();
  try {
    const auth = await requireRole("admin", { requestId });
    if (!auth.ok) return auth.response;
    const id = new URL(request.url).searchParams.get("id");
    let intent: PaymentIntent | null;
    if (id) {
      if (!z.uuid().safeParse(id).success) return fail("validation_error", "Pagamento inválido.", 422, { requestId });
      intent = await getPaymentIntent(id, auth.org.orgId);
      if (!intent) return fail("not_found", "Pagamento não encontrado.", 404, { requestId });
    } else {
      const { data, error } = await createAdminClient().from("billing_payment_intents").select("*").eq("organization_id", auth.org.orgId)
        .in("status", ["processing", "pending", "uncertain"]).maybeSingle();
      if (error) throw new Error("payment_store_unavailable");
      intent = data;
    }
    return ok({ payment: intent ? await reconcilePayment(intent) : null, card_enabled: env.ASAAS_NATIVE_CARD_ENABLED }, { requestId, headers: { "Cache-Control": "no-store" } });
  } catch { return fail("payment_status_unavailable", "Ainda não foi possível consultar o pagamento. Não pague novamente; use Verificar pagamento.", 503, { requestId }); }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  let acquired: PaymentIntent | null = null;
  let paymentSent = false;
  let paymentAccepted = false;
  try {
    const auth = await requireRole("admin", { requestId });
    if (!auth.ok) return auth.response;
    // Only a same-origin JSON form may initiate a charge. No caller-provided prices/orgs.
    const origin = request.headers.get("origin");
    const allowed = new Set([new URL(env.NEXT_PUBLIC_APP_URL).origin]);
    if (!origin || !allowed.has(origin) || !request.headers.get("content-type")?.includes("application/json")) return fail("forbidden", "Origem de pagamento inválida.", 403, { requestId });
    if (await authRateLimited("billing-payment", auth.user.id, { ip: 10, id: 5, windowSec: 300 })) return fail("rate_limited", "Aguarde alguns minutos antes de tentar novamente.", 429, { requestId });
    const raw = await request.text();
    if (raw.length > 8192) return fail("validation_error", "Dados de pagamento inválidos.", 422, { requestId });
    const parsed = input.safeParse(JSON.parse(raw));
    if (!parsed.success) return fail("validation_error", "Confira os dados do titular, endereço e cartão.", 422, { requestId });
    const { payer, card } = parsed.data;
    const intent = await getPaymentIntent(parsed.data.intent_id, auth.org.orgId);
    if (!intent || intent.created_by !== auth.user.id) return fail("not_found", "Cotação não encontrada.", 404, { requestId });
    if (intent.status !== "quoted") return ok(await reconcilePayment(intent), { requestId });
    if (!checkoutSelection.safeParse(intent).success) return fail("validation_error", "O plano mensal permite apenas 1x. Recalcule o pagamento.", 422, { requestId });
    if (new Date(intent.expires_at).getTime() <= Date.now()) return fail("quote_expired", "A cotação expirou. Recalcule antes de pagar.", 409, { requestId });
    if (intent.payment_method === "CREDIT_CARD" && (!env.ASAAS_NATIVE_CARD_ENABLED || !card)) return fail("card_unavailable", "Pagamento por cartão ainda está em validação. Escolha Pix.", 409, { requestId });
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "";
    if (intent.payment_method === "CREDIT_CARD" && !isIP(ip)) return fail("client_ip_unavailable", "Não foi possível validar sua conexão para pagamento por cartão.", 422, { requestId });
    const db = await createClient();
    const { data: plan } = await db.from("saas_plans").select("code,is_public").eq("code", intent.plan_code).eq("is_active", true).maybeSingle();
    if (!plan) return fail("plan_not_found", "Plano indisponível. Recalcule o pagamento.", 409, { requestId });
    const { data: current, error: currentError } = await db.from("tenant_subscriptions").select("plan_code,status").eq("organization_id", auth.org.orgId).in("status", ["trialing", "active", "past_due", "suspended"]).maybeSingle();
    if (currentError) throw new Error("subscription_unavailable");
    if (!plan.is_public && current?.plan_code !== intent.plan_code) return fail("plan_not_found", "Plano indisponível para esta empresa.", 404, { requestId });
    if (current?.status === "active" && current.plan_code !== intent.plan_code) return fail("plan_change_requires_review", "Seu plano foi alterado. Reabra Minha assinatura antes de pagar.", 409, { requestId });
    const admin = createAdminClient();
    const { data: locked, error: lockError } = await admin.from("billing_payment_intents").update({ status: "processing" })
      .eq("id", intent.id).eq("organization_id", auth.org.orgId).eq("status", "quoted").gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (lockError || !locked) return fail("payment_in_progress", "Já existe um pagamento em andamento. Feche e reabra o popup para consultar.", 409, { requestId });
    acquired = intent;
    await audit({ action: "billing.payment_submitted", actorUserId: auth.user.id, organizationId: auth.org.orgId, resourceType: "billing_payment_intents", resourceId: intent.id, requestId, metadata: { total_cents: intent.total_cents, payment_method: intent.payment_method } });
    // Per-intent customer prevents overwriting a payer used by unrelated Asaas services.
    const customer = await paymentRequest("/customers", z.object({ id: z.string().regex(/^cus_[a-zA-Z0-9]+$/) }), {
      name: payer.name, email: payer.email, cpfCnpj: payer.cpf_cnpj, mobilePhone: payer.phone,
      postalCode: payer.postal_code, addressNumber: payer.address_number, externalReference: intent.id, notificationDisabled: true,
    });
    await updatePaymentIntent(intent, { provider_customer_id: customer.id });
    intent.provider_customer_id = customer.id;
    const charge: Record<string, unknown> = {
      customer: customer.id, billingType: intent.payment_method, externalReference: intent.id,
      dueDate: new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
      description: `${intent.plan_name} — ${intent.billing_cycle === "annual" ? "anual" : "mensal"}`,
      ...(intent.installments === 1 ? { value: intent.total_cents / 100 } : { installmentCount: intent.installments, totalValue: intent.total_cents / 100 }),
    };
    if (intent.payment_method === "CREDIT_CARD" && card) {
      charge.creditCard = { holderName: card.holder_name, number: card.number, expiryMonth: card.expiry_month, expiryYear: card.expiry_year, ccv: card.ccv };
      charge.creditCardHolderInfo = { name: payer.name, email: payer.email, cpfCnpj: payer.cpf_cnpj, postalCode: payer.postal_code, addressNumber: payer.address_number, mobilePhone: payer.phone };
      charge.remoteIp = ip;
    }
    paymentSent = true;
    const payment = await paymentRequest("/payments", providerPaymentSchema, charge);
    paymentAccepted = true;
    await updatePaymentIntent(intent, { provider_payment_id: payment.id, provider_installment_id: payment.installment ?? null, status: "pending" });
    return ok(await reconcilePayment({ ...intent, provider_payment_id: payment.id, status: "pending" }), { requestId, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // 400 is a definitive refusal; network/5xx/parse errors may hide a successful charge.
    const definitive = !paymentSent || (!paymentAccepted && error instanceof PaymentProviderError && error.status === 400);
    if (acquired) {
      try { await updatePaymentIntent(acquired, { status: definitive ? "failed" : "uncertain" }); } catch { /* processing stays locked; reconcile by reference */ }
    }
    return fail(definitive ? "payment_rejected" : "payment_uncertain", definitive
      ? "Pagamento não concluído. Confira os dados informados antes de tentar novamente."
      : "A confirmação está pendente. Não pague novamente; use Verificar pagamento.", definitive ? 422 : 409, { requestId });
  }
}
