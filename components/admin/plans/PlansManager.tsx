"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { parsePriceCents, planFieldsSchema, type CatalogPlan } from "@/lib/billing/plan-catalog";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
type Editor = { plan?: CatalogPlan; duplicate?: CatalogPlan };

export function PlansManager({ plans }: { plans: CatalogPlan[] }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState("");
  const router = useRouter();
  return <div className="min-w-0 space-y-6">
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Planos</h1>
        <p className="text-sm text-muted-foreground">Gerencie o catálogo e crie condições sob medida para suas empresas clientes.</p>
      </div>
      <Button onClick={() => { setNotice(""); setEditor({}); }}>Novo plano</Button>
    </header>
    {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    <div className="grid min-w-0 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {plans.map(plan => <Card key={plan.code} className="flex min-w-0 flex-col p-5 sm:p-6" data-testid="plan-card">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="text-xs text-muted-foreground">{plan.code}</p>
          </div>
          <span className="shrink-0 rounded-full border px-2 py-1 text-xs">{plan.is_active ? "Ativo" : "Inativo"}</span>
        </div>
        <p className="mt-4 text-xl font-semibold [overflow-wrap:anywhere]">{money.format(plan.monthly_price_cents / 100)}<span className="text-sm font-normal">/mês</span></p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{money.format(plan.annual_price_cents / 100)}/ano</p>
        <dl className="my-5 grid min-w-0 grid-cols-2 gap-3 text-sm [&>div]:min-w-0 [&_dd]:[overflow-wrap:anywhere]">
          <div><dt className="text-muted-foreground">Usuários</dt><dd>{plan.max_users}</dd></div>
          <div><dt className="text-muted-foreground">WhatsApps</dt><dd>{plan.max_whatsapp_numbers}</dd></div>
          <div><dt className="text-muted-foreground">Assinaturas</dt><dd>{plan.subscriptions}</dd></div>
          <div><dt className="text-muted-foreground">Visibilidade</dt><dd>{plan.is_public ? "Catálogo público" : "Sob medida · privado"}</dd></div>
        </dl>
        <div className="mt-auto flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => { setNotice(""); setEditor({ plan }); }}>Editar <span className="sr-only">{plan.name}</span></Button>
          <Button variant="ghost" onClick={() => { setNotice(""); setEditor({ duplicate: plan }); }}>Duplicar <span className="sr-only">{plan.name}</span></Button>
        </div>
      </Card>)}
    </div>
    <Card className="min-w-0 space-y-2 p-5 text-sm text-muted-foreground">
      <p>Preços editados aqui atualizam o catálogo. Esta ação não cria cobranças nem reajusta assinaturas no Asaas.</p>
      <p>Os limites são compartilhados pelas empresas vinculadas ao plano. Para uma condição exclusiva, duplique o plano e mantenha-o privado. Criar um plano não altera automaticamente o plano de nenhuma empresa.</p>
    </Card>
    {editor && <PlanEditor editor={editor} onClose={() => setEditor(null)} onSaved={() => {
      setEditor(null); setNotice("Plano salvo. O histórico da alteração foi registrado."); router.refresh();
    }} />}
  </div>;
}

function PlanEditor({ editor, onClose, onSaved }: { editor: Editor; onClose: () => void; onSaved: () => void }) {
  const source = editor.plan ?? editor.duplicate;
  const [name, setName] = useState(editor.duplicate ? `${source!.name} personalizado`.slice(0, 100) : source?.name ?? "");
  const [code, setCode] = useState(editor.duplicate ? `${source!.code.slice(0, 55)}_custom` : source?.code ?? "");
  const [monthly, setMonthly] = useState(((source?.monthly_price_cents ?? 0) / 100).toFixed(2).replace(".", ","));
  const [annual, setAnnual] = useState(((source?.annual_price_cents ?? 0) / 100).toFixed(2).replace(".", ","));
  const [users, setUsers] = useState(String(source?.max_users ?? 2));
  const [whatsapp, setWhatsapp] = useState(String(source?.max_whatsapp_numbers ?? 1));
  const [order, setOrder] = useState(String(source?.sort_order ?? 40));
  const [active, setActive] = useState(editor.plan?.is_active ?? true);
  const [publicPlan, setPublicPlan] = useState(editor.plan?.is_public ?? false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const affected = editor.plan?.subscriptions ?? 0;
  const limitsChanged = !!editor.plan && (Number(users) !== editor.plan.max_users || Number(whatsapp) !== editor.plan.max_whatsapp_numbers);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const monthlyCents = parsePriceCents(monthly), annualCents = parsePriceCents(annual);
    if (monthlyCents === null || annualCents === null) { setError("Informe preços válidos em reais, sem separador de milhar e com até duas casas decimais."); return; }
    const parsed = planFieldsSchema.safeParse({ code, name, monthly_price_cents: monthlyCents, annual_price_cents: annualCents,
      max_users: Number(users), max_whatsapp_numbers: Number(whatsapp), sort_order: Number(order), is_active: active, is_public: publicPlan });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Confira os campos."); return; }
    if (affected && limitsChanged && !confirmed) { setError("Confirme a alteração dos limites das empresas vinculadas."); return; }
    setPending(true);
    try {
      if (editor.plan) await apiClient.patch("/admin/plans", { ...parsed.data, expected_revision: editor.plan.revision, confirm_existing_limits: confirmed });
      else await apiClient.post("/admin/plans", { ...parsed.data, ...(editor.duplicate ? { copy_from: editor.duplicate.code } : {}) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar. Confira o catálogo antes de tentar novamente."); }
    finally { setPending(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto p-4 sm:p-6">
      <DialogHeader className="min-w-0 pr-6 text-left">
        <DialogTitle>{editor.plan ? "Editar plano" : "Novo plano personalizado"}</DialogTitle>
        <DialogDescription>Defina preços e capacidade. O código identifica o plano e não muda depois da criação.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="min-w-0 space-y-4">
        <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2 [&>label]:min-w-0 [&>label]:space-y-1 [&>label]:text-sm">
          <label htmlFor="plan-name">Nome<Input id="plan-name" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={100} required /></label>
          <label htmlFor="plan-code">Código<Input id="plan-code" value={code} onChange={e => setCode(e.target.value)} disabled={!!editor.plan} placeholder="empresa_personalizado" maxLength={64} required /></label>
          <label htmlFor="plan-monthly">Mensalidade (R$)<Input id="plan-monthly" inputMode="decimal" value={monthly} onChange={e => setMonthly(e.target.value)} required /></label>
          <label htmlFor="plan-annual">Anuidade (R$)<Input id="plan-annual" inputMode="decimal" value={annual} onChange={e => setAnnual(e.target.value)} required /></label>
          <label htmlFor="plan-users">Limite de usuários<Input id="plan-users" type="number" min={1} max={100000} value={users} onChange={e => { setUsers(e.target.value); setConfirmed(false); }} required /></label>
          <label htmlFor="plan-whatsapp">Limite de WhatsApps<Input id="plan-whatsapp" type="number" min={1} max={100000} value={whatsapp} onChange={e => { setWhatsapp(e.target.value); setConfirmed(false); }} required /></label>
          <label htmlFor="plan-order">Ordem no catálogo<Input id="plan-order" type="number" min={0} max={100000} value={order} onChange={e => setOrder(e.target.value)} required /></label>
        </fieldset>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" checked={active} disabled={pending || editor.plan?.code === "essential"} onChange={e => setActive(e.target.checked)} className="mt-1 shrink-0" />Plano ativo</label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={publicPlan} disabled={pending} onChange={e => setPublicPlan(e.target.checked)} className="mt-1 shrink-0" />Exibir no catálogo público. Desmarcado: plano privado, sob medida.</label>
        </div>
        {!!affected && limitsChanged && <label className="flex items-start gap-2 rounded-lg border border-amber-500/50 p-3 text-sm">
          <input type="checkbox" checked={confirmed} disabled={pending} onChange={e => setConfirmed(e.target.checked)} className="mt-1 shrink-0" />
          <span>Confirmo aplicar os novos limites às {affected} assinatura(s) vinculada(s). Nenhum usuário ou WhatsApp será apagado; novos cadastros obedecerão aos limites alterados.</span>
        </label>}
        <p className="text-xs text-muted-foreground">Salvar não altera cobranças existentes no Asaas.</p>
        {error && <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar plano"}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
