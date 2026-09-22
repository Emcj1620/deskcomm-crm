import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleHasPermission } from "@/lib/auth/permissions";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Card } from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { CheckoutButton } from "@/components/billing/CheckoutButton";

export const dynamic = "force-dynamic";

/**
 * A tela de dinheiro entregava o nosso contato ao cliente do revendedor, e ela
 * tem porta de 1ª classe no menu. Mesmo tratamento da tela de conta suspensa:
 * o endereço é o de quem opera a instalação (`SUPPORT_EMAIL`) e, sem ele
 * configurado, nenhum endereço aparece.
 */
export default async function BillingPage() {
  // spec 13 §4: billing é admin-only (viewer/agent/manager = none).
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || !roleHasPermission(activeOrg.role, "billing.read")) {
    redirect("/403");
  }
  const suporte = emailDeSuporte();
  const idioma = user.idioma;
  const supabase = await createClient();
  const [{ data: plans }, { data: subscription }] = await Promise.all([
    supabase.from("saas_plans").select("*").eq("is_active", true).order("sort_order"),
    supabase
      .from("tenant_subscriptions")
      .select("plan_code, status, billing_cycle, trial_ends_at, current_period_end")
      .eq("organization_id", activeOrg.orgId)
      .in("status", ["trialing", "active", "past_due", "suspended"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const dinheiro = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Minha assinatura</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Planos, faturas e cobrança.", idioma)}
        </p>
      </header>
      {subscription && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">{traduzir("Plano atual", idioma)}</p>
              <h2 className="text-xl font-semibold">
                {plans?.find((plan) => plan.code === subscription.plan_code)?.name ??
                  subscription.plan_code}
              </h2>
            </div>
            <span className="rounded-full border px-3 py-1 text-sm font-medium">
              {subscription.status === "trialing"
                ? traduzir("Período de teste", idioma)
                : subscription.status}
            </span>
          </div>
          {subscription.trial_ends_at && (
            <p className="mt-3 text-sm text-muted-foreground">
              {traduzir("Teste disponível até", idioma)}{" "}
              {new Date(subscription.trial_ends_at).toLocaleDateString("pt-BR")}.
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {(plans ?? []).map((plan) => {
          const atual = subscription?.plan_code === plan.code;
          const economia = plan.monthly_price_cents * 12 - plan.annual_price_cents;
          return (
            <Card key={plan.code} className={`min-w-0 ${atual ? "border-primary p-6" : "p-6"}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                {atual && (
                  <span className="text-xs font-medium text-primary">
                    {traduzir("Atual", idioma)}
                  </span>
                )}
              </div>
              <p className="mt-4 text-2xl font-semibold">
                {dinheiro.format(plan.monthly_price_cents / 100)}
                <span className="text-sm font-normal text-muted-foreground">/mês</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {dinheiro.format(plan.annual_price_cents / 100)}/ano ·{" "}
                {traduzir("economize", idioma)} {dinheiro.format(economia / 100)}
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                <li>
                  {traduzir("Até", idioma)} {plan.max_users} {traduzir("usuários", idioma)}
                </li>
                <li>
                  {plan.max_whatsapp_numbers} WhatsApp{plan.max_whatsapp_numbers > 1 ? "s" : ""}
                </li>
                <li>{traduzir("Agentes de IA, respostas sugeridas e follow-ups", idioma)}</li>
              </ul>
              <div className="mt-6 grid min-w-0 gap-2 sm:grid-cols-2">
                <CheckoutButton planCode={plan.code} cycle="monthly" label="Assinar mensal" />
                <CheckoutButton planCode={plan.code} cycle="annual" label="Assinar anual · até 12x" />
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="max-w-2xl p-6">
        <h2 className="text-sm font-semibold">{traduzir("Cobrança", idioma)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {traduzir(
            "Escolha um plano para abrir o checkout seguro do Asaas. O mensal aceita Pix ou cartão e pode ser renovado por aqui; o anual aceita cartão em até 12x com os juros exibidos pelo Asaas.",
            idioma,
          )}{" "}
          {suporte ? (
            <>
              {traduzir("Para questões de pagamento, contate", idioma)}{" "}
              <a className="underline" href={`mailto:${suporte}`}>
                {suporte}
              </a>
              .
            </>
          ) : (
            <>
              {traduzir(
                "Para questões de pagamento, fale com quem administra este sistema.",
                idioma,
              )}
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
