import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

function validToken(value: string | null) {
  if (!env.ASAAS_WEBHOOK_TOKEN || !value) return false;
  const a = Buffer.from(env.ASAAS_WEBHOOK_TOKEN); const b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!validToken(request.headers.get("asaas-access-token"))) return new Response("unauthorized", { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; event?: string; payment?: { externalReference?: string }; subscription?: { externalReference?: string; id?: string } } | null;
  if (!body?.id || !body.event) return new Response("invalid_payload", { status: 400 });
  const checkoutId = body.subscription?.externalReference ?? body.payment?.externalReference;
  if (!checkoutId) return Response.json({ received: true });
  const admin = createAdminClient();
  const { data: checkout } = await admin.from("asaas_checkout_sessions").select("id,organization_id,plan_code,billing_cycle,status").eq("id", checkoutId).maybeSingle();
  if (!checkout) return new Response("unknown_checkout", { status: 404 });
  const { error: eventError } = await admin.from("asaas_checkout_events").insert({ event_id: body.id, checkout_id: checkout.id, event_name: body.event });
  if (eventError?.code === "23505") return Response.json({ received: true, duplicate: true });
  if (eventError) return new Response("event_store_error", { status: 500 });
  const paid = ["CHECKOUT_PAID", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"].includes(body.event);
  const canceled = body.event.includes("CANCELED") || body.event.includes("EXPIRED");
  const status = paid ? "active" : canceled ? "canceled" : body.event.includes("OVERDUE") ? "past_due" : null;
  if (!status) return Response.json({ received: true });
  await admin.from("asaas_checkout_sessions").update({ status: paid ? "paid" : status }).eq("id", checkout.id);
  if (paid || canceled) await admin.from("tenant_subscriptions").update({ status, plan_code: checkout.plan_code, billing_cycle: checkout.billing_cycle, provider: "asaas", provider_subscription_id: body.subscription?.id ?? null }).eq("organization_id", checkout.organization_id).in("status", ["trialing", "active", "past_due", "suspended"]);
  return Response.json({ received: true });
}
