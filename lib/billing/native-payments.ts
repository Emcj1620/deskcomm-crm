import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentListSchema, paymentRequest, providerPaymentSchema } from "./asaas-payments";
import type { PaymentStatus } from "./payment-quote";

export type PaymentIntent = {
  id: string; organization_id: string; created_by: string; plan_code: string; plan_name: string;
  billing_cycle: "monthly" | "annual"; payment_method: "PIX" | "CREDIT_CARD";
  installments: number; base_cents: number; total_cents: number; expires_at: string; status: string;
  provider_customer_id: string | null; provider_payment_id: string | null; provider_installment_id: string | null;
};

export async function getPaymentIntent(id: string, orgId: string): Promise<PaymentIntent | null> {
  const { data, error } = await createAdminClient().from("billing_payment_intents").select("*")
    .eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error("payment_store_unavailable");
  return data;
}

export async function updatePaymentIntent(intent: PaymentIntent, fields: Record<string, unknown>) {
  const { error } = await createAdminClient().from("billing_payment_intents").update(fields)
    .eq("id", intent.id).eq("organization_id", intent.organization_id).neq("status", "paid");
  if (error) throw new Error("payment_store_unavailable");
}

/** Reconcile only server-fetched payments. A webhook body or browser flag never grants access. */
export async function reconcilePayment(intent: PaymentIntent): Promise<PaymentStatus> {
  const result: PaymentStatus = { id: intent.id, status: intent.status, total_cents: intent.total_cents, payment_method: intent.payment_method };
  if (["paid", "quoted", "failed", "canceled"].includes(intent.status)) return result;
  let payment;
  if (intent.provider_payment_id) {
    payment = await paymentRequest(`/payments/${encodeURIComponent(intent.provider_payment_id)}`, providerPaymentSchema);
  } else {
    const list = await paymentRequest(`/payments?externalReference=${encodeURIComponent(intent.id)}&limit=100`, paymentListSchema);
    // Multiple unrelated payments are ambiguous. Do not pick one by accident.
    if (!list.data.length) return result;
    if (list.hasMore || (intent.installments === 1 && list.data.length !== 1)) throw new Error("ambiguous_payment");
    payment = list.data.find((p) => intent.installments === 1 || p.installmentNumber === 1);
    if (!payment) throw new Error("payment_mismatch");
  }
  // Manual receipt may preserve PIX and change status, or use the cash billing type.
  // Accept only a settled single charge; never settle a whole installment plan
  // because only one of its installments was manually marked as received.
  const settled = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(payment.status);
  const manualReceipt = intent.installments === 1 && settled &&
    (payment.status === "RECEIVED_IN_CASH" || payment.billingType === "RECEIVED_IN_CASH");
  const methodMatches = payment.billingType === intent.payment_method ||
    (manualReceipt && payment.billingType === "RECEIVED_IN_CASH");
  if ((intent.provider_payment_id && payment.id !== intent.provider_payment_id) ||
      payment.externalReference !== intent.id || !methodMatches || payment.customer !== intent.provider_customer_id ||
      (payment.status === "RECEIVED_IN_CASH" && !manualReceipt)) {
    throw new Error("payment_mismatch");
  }
  let total = Math.round(payment.value * 100);
  if (intent.installments > 1) {
    if (!payment.installment || payment.installmentNumber !== 1) throw new Error("payment_mismatch");
    const list = await paymentRequest(`/installments/${encodeURIComponent(payment.installment)}/payments?limit=100`, paymentListSchema);
    if (list.hasMore || list.data.length !== intent.installments || list.data.some((p) => p.installment !== payment.installment || p.customer !== payment.customer || p.billingType !== "CREDIT_CARD" || p.externalReference !== intent.id)) {
      throw new Error("payment_mismatch");
    }
    total = list.data.reduce((sum, p) => sum + Math.round(p.value * 100), 0);
  }
  if (total !== intent.total_cents) throw new Error("payment_amount_mismatch");
  await updatePaymentIntent(intent, { provider_payment_id: payment.id, provider_installment_id: payment.installment ?? null });
  if (settled && !payment.deleted) {
    const { error } = await createAdminClient().rpc("fn_settle_billing_payment", { p_intent: intent.id, p_org: intent.organization_id, p_payment: payment.id });
    if (error) throw new Error("payment_settlement_pending");
    result.status = "paid";
    return result;
  }
  if (payment.deleted || ["REFUNDED", "REFUND_REQUESTED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE"].includes(payment.status)) {
    // Preserve the existing subscription; a failed new purchase must not cancel it.
    await updatePaymentIntent(intent, { status: "canceled" });
    result.status = "canceled";
    return result;
  }
  await updatePaymentIntent(intent, { status: "pending" });
  result.status = "pending";
  if (intent.payment_method === "PIX") {
    const pix = await paymentRequest(`/payments/${encodeURIComponent(payment.id)}/pixQrCode`, z.object({ encodedImage: z.string().regex(/^[A-Za-z0-9+/=]+$/), payload: z.string(), expirationDate: z.string() }));
    result.pix = { encoded_image: pix.encodedImage, payload: pix.payload, expiration_date: pix.expirationDate };
  }
  return result;
}
