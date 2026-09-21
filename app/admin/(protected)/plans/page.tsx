import { Card } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const admin = createAdminClient();
  const [{ data: plans, error: plansError }, { data: subscriptions, error: subscriptionsError }] =
    await Promise.all([
      admin.from("saas_plans").select("*").order("sort_order"),
      admin.from("tenant_subscriptions").select("plan_code, status"),
    ]);

  if (plansError || subscriptionsError) {
    return (
      <Card className="p-6 text-sm text-destructive">
        Não foi possível carregar planos e assinaturas. Verifique se a migração SaaS foi aplicada.
      </Card>
    );
  }

  const dinheiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Planos</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo comercial e distribuição das assinaturas por tenant.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        {(plans ?? []).map((plan) => {
          const assinaturas = (subscriptions ?? []).filter(
            (subscription) =>
              subscription.plan_code === plan.code && subscription.status !== "canceled",
          ).length;
          return (
            <Card key={plan.code} className="p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">
                    {plan.code}
                  </p>
                </div>
                <span className="rounded-full border px-2 py-1 text-xs">
                  {plan.is_active ? "Ativo" : "Inativo"}
                </span>
              </div>
              <p className="mt-4 text-xl font-semibold">
                {dinheiro.format(plan.monthly_price_cents / 100)}/mês
              </p>
              <p className="text-sm text-muted-foreground">
                {dinheiro.format(plan.annual_price_cents / 100)}/ano
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Usuários</dt>
                  <dd className="font-medium">{plan.max_users}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">WhatsApps</dt>
                  <dd className="font-medium">{plan.max_whatsapp_numbers}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Assinaturas</dt>
                  <dd className="font-medium">{assinaturas}</dd>
                </div>
              </dl>
            </Card>
          );
        })}
      </div>
      <Card className="p-5 text-sm text-muted-foreground">
        A alteração de preço e a troca de plano serão habilitadas junto ao fluxo de cobrança do
        Asaas, com auditoria e histórico. Nesta etapa, os limites já são aplicados pelo servidor.
      </Card>
    </div>
  );
}
