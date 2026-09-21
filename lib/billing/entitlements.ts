import { createAdminClient } from "@/lib/supabase/admin";
import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";

export type BillableResource = "users" | "whatsapp_numbers";

export interface TenantEntitlements {
  subscriptionId: string;
  planCode: string;
  planName: string;
  status: "trialing" | "active" | "past_due" | "suspended" | "canceled";
  billingCycle: "monthly" | "annual";
  trialEndsAt: string | null;
  limits: { users: number; whatsapp_numbers: number };
  features: Record<string, unknown>;
}

export type CapacityDecision =
  | { allowed: true; current: number; limit: number; remaining: number }
  | {
      allowed: false;
      reason: "subscription_unavailable" | "subscription_inactive" | "plan_limit_reached";
      current: number;
      limit: number;
      remaining: number;
    };

export function decideCapacity(input: {
  status: TenantEntitlements["status"];
  current: number;
  increment?: number;
  limit: number;
}): CapacityDecision {
  const increment = Math.max(0, input.increment ?? 1);
  const remaining = Math.max(0, input.limit - input.current);
  if (!(["trialing", "active", "past_due"] as string[]).includes(input.status)) {
    return {
      allowed: false,
      reason: "subscription_inactive",
      current: input.current,
      limit: input.limit,
      remaining,
    };
  }
  if (input.current + increment > input.limit) {
    return {
      allowed: false,
      reason: "plan_limit_reached",
      current: input.current,
      limit: input.limit,
      remaining,
    };
  }
  return {
    allowed: true,
    current: input.current,
    limit: input.limit,
    remaining: remaining - increment,
  };
}

export async function loadTenantEntitlements(
  organizationId: string,
): Promise<TenantEntitlements | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_subscriptions")
    .select(
      "id, plan_code, status, billing_cycle, trial_ends_at, saas_plans(name, max_users, max_whatsapp_numbers, features)",
    )
    .eq("organization_id", organizationId)
    .in("status", ["trialing", "active", "past_due", "suspended"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const joined = Array.isArray(data.saas_plans) ? data.saas_plans[0] : data.saas_plans;
  if (!joined) return null;
  return {
    subscriptionId: data.id,
    planCode: data.plan_code,
    planName: joined.name,
    status: data.status as TenantEntitlements["status"],
    billingCycle: data.billing_cycle as TenantEntitlements["billingCycle"],
    trialEndsAt: data.trial_ends_at,
    limits: { users: joined.max_users, whatsapp_numbers: joined.max_whatsapp_numbers },
    features: (joined.features ?? {}) as Record<string, unknown>,
  };
}

export async function checkTenantCapacity(input: {
  organizationId: string;
  resource: BillableResource;
  increment?: number;
}): Promise<CapacityDecision> {
  const entitlements = await loadTenantEntitlements(input.organizationId);
  if (!entitlements) {
    return {
      allowed: false,
      reason: "subscription_unavailable",
      current: 0,
      limit: 0,
      remaining: 0,
    };
  }

  const admin = createAdminClient();
  const countQuery =
    input.resource === "users"
      ? admin
          .from("user_organizations")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", input.organizationId)
          .is("revoked_at", null)
      : admin
          .from("channel_sessions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", input.organizationId)
          .in("provider", [...PROVIDERS_DE_MENSAGEM])
          .is("archived_at", null);
  const { count, error } = await countQuery;
  if (error) {
    return {
      allowed: false,
      reason: "subscription_unavailable",
      current: 0,
      limit: 0,
      remaining: 0,
    };
  }

  return decideCapacity({
    status: entitlements.status,
    current: count ?? 0,
    increment: input.increment,
    limit: entitlements.limits[input.resource],
  });
}
