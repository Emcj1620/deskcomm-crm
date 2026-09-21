import { Card } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { PlansManager } from "@/components/admin/plans/PlansManager";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const [{ data: plans, error: plansError }, { data: subscriptions, error: subscriptionsError }] = await Promise.all([
    admin.from("saas_plans").select("code,name,monthly_price_cents,annual_price_cents,max_users,max_whatsapp_numbers,is_active,is_public,sort_order,revision").order("sort_order").order("code"),
    admin.from("tenant_subscriptions").select("plan_code,status"),
  ]);
  if (plansError || subscriptionsError) return <Card className="p-6 text-sm text-destructive">Não foi possível carregar planos e assinaturas. Tente novamente ou verifique a migração do catálogo.</Card>;
  return <PlansManager plans={(plans ?? []).map(plan => ({ ...plan,
    subscriptions: (subscriptions ?? []).filter(subscription => subscription.plan_code === plan.code && subscription.status !== "canceled").length,
  }))} />;
}
