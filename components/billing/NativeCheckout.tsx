"use client";

import { useEffect, useRef, useState, type FormEvent, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { PaymentQuote, PaymentStatus } from "@/lib/billing/payment-quote";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
class CheckoutError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}
/** Never retry a financial POST automatically. */
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(110_000) });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.data) {
    const message = json?.error?.message;
    throw new CheckoutError(typeof message === "string" && message.length < 300 && !/[<>]/.test(message)
      ? message : "Não foi possível consultar o pagamento. Tente verificar novamente.", json?.error?.code);
  }
  return json.data as T;
}

export function NativeCheckout({ planCode, cycle, label }: { planCode: string; cycle: "monthly" | "annual"; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cardEnabled, setCardEnabled] = useState(false);
  const [method, setMethod] = useState<"PIX" | "CREDIT_CARD">("PIX");
  const [installments, setInstallments] = useState(1);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [payment, setPayment] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const submitting = useRef(false);
  const view = useRef(0);
  async function loadPending() {
    const version = ++view.current;
    setReady(false); setBusy(true); setError(""); setQuote(null);
    try {
      const result = await request<{ payment: PaymentStatus | null; card_enabled: boolean }>("/api/v1/billing/payments");
      if (version !== view.current) return;
      setPayment(result.payment); setCardEnabled(result.card_enabled); setReady(true);
    } catch (e) { if (version === view.current) setError(e instanceof Error ? e.message : "Não foi possível consultar."); }
    finally { if (version === view.current) setBusy(false); }
  }
  async function checkPayment(id: string) {
    try {
      const result = await request<{ payment: PaymentStatus }>(`/api/v1/billing/payments?id=${encodeURIComponent(id)}`);
      setPayment(result.payment); setError("");
      if (result.payment.status === "paid") router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Confirmação pendente. Verifique novamente."); }
  }
  const paymentId = payment?.id;
  const pending = !!payment && !["paid", "failed", "canceled", "quoted"].includes(payment.status);
  useEffect(() => {
    if (!open || !pending || !paymentId || busy) return;
    let running = false;
    const timer = setInterval(() => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      void checkPayment(paymentId).finally(() => { running = false; });
    }, 7000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending, paymentId, busy]);
  async function calculate() {
    if (busy || submitting.current) return;
    setBusy(true); setError(""); setQuote(null);
    const version = view.current;
    try {
      const result = await request<PaymentQuote>("/api/v1/billing/quote", { plan_code: planCode, billing_cycle: cycle, payment_method: method, installments });
      if (version === view.current) setQuote(result);
    } catch (e) { if (version === view.current) setError(e instanceof Error ? e.message : "Não foi possível calcular."); }
    finally { if (version === view.current) setBusy(false); }
  }
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quote || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const read = (name: string) => String(data.get(name) ?? "");
    const body = { intent_id: quote.id,
      payer: { name: read("name"), email: read("email"), cpf_cnpj: read("cpf_cnpj"), phone: read("phone"), postal_code: read("postal_code"), address_number: read("address_number") },
      ...(method === "CREDIT_CARD" ? { card: { holder_name: read("holder_name"), number: read("number"), expiry_month: read("expiry_month"), expiry_year: read("expiry_year"), ccv: read("ccv") } } : {}),
    };
    // Sensitive fields are never persisted in state, storage or logs.
    form.reset();
    setPayment({ id: quote.id, status: "processing", total_cents: quote.total_cents, payment_method: quote.payment_method });
    try {
      const result = await request<PaymentStatus>("/api/v1/billing/payments", body);
      setPayment(result); setQuote(null);
      if (result.status === "paid") router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmação pendente. Não pague novamente.");
      const retryable = e instanceof CheckoutError && ["payment_rejected", "validation_error", "quote_expired", "card_unavailable", "client_ip_unavailable", "plan_not_found", "plan_change_requires_review", "forbidden", "rate_limited", "not_found"].includes(e.code ?? "");
      if (retryable) { setPayment(null); setQuote(null); }
    } finally { submitting.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(value) => {
    if (submitting.current) return;
    setOpen(value);
    if (value) { setMethod("PIX"); setInstallments(1); setCopied(false); void loadPending(); }
    else { view.current++; setQuote(null); }
  }}>
    <DialogTrigger asChild><Button type="button" className="h-auto min-h-10 w-full min-w-0 whitespace-normal px-3 py-2 text-center text-xs leading-tight sm:text-sm">{label}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl p-5 sm:p-6 motion-reduce:animate-none" onInteractOutside={(e) => { if (submitting.current) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (submitting.current) e.preventDefault(); }}>
      <DialogHeader className="pr-6 text-left"><DialogTitle>Renovar assinatura</DialogTitle><DialogDescription>Pagamento dentro do sistema. Confira os valores antes de confirmar.</DialogDescription></DialogHeader>
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive break-words">{error}</div>}
      {!ready && <div className="text-sm" role="status">{busy ? "Consultando pagamentos…" : <Button onClick={() => void loadPending()} variant="outline">Tentar novamente</Button>}</div>}
      {ready && payment?.status === "paid" && <div className="space-y-3 py-4 text-center" role="status"><h3 className="font-semibold">Pagamento confirmado</h3><p className="text-sm text-muted-foreground">Sua assinatura foi atualizada.</p><Button onClick={() => setOpen(false)}>Concluir</Button></div>}
      {ready && pending && <div className="min-w-0 space-y-4">
        <div role="status"><h3 className="font-semibold">{busy ? "Processando pagamento…" : "Aguardando confirmação"}</h3><p className="mt-1 text-sm text-muted-foreground">Total: {money(payment.total_cents)}. Não é necessário pagar novamente.</p></div>
        {payment.pix && <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${payment.pix.encoded_image}`} alt="QR Code Pix deste pagamento" width={224} height={224} className="mx-auto max-w-full rounded-lg bg-white p-3" />
          <label className="block text-sm">Pix Copia e Cola<textarea readOnly value={payment.pix.payload} className="mt-1 h-20 w-full resize-none rounded-md border bg-background p-2 text-xs break-all" /></label>
          <Button className="w-full" onClick={async () => { try { await navigator.clipboard.writeText(payment.pix!.payload); setCopied(true); } catch { setError("Selecione e copie o código Pix manualmente."); } }}>{copied ? "Código copiado" : "Copiar código Pix"}</Button>
          <p className="text-xs text-muted-foreground">Validade informada pelo Asaas: {payment.pix.expiration_date}. Confira o valor no aplicativo do seu banco.</p>
        </>}
        <Button variant="outline" disabled={busy} className="w-full" onClick={() => void checkPayment(payment.id)}>Verificar pagamento</Button>
        <p className="text-xs text-muted-foreground">Você pode fechar esta janela e voltar por Minha assinatura para consultar.</p>
      </div>}
      {ready && !pending && payment?.status !== "paid" && <div className="min-w-0 space-y-5">
        {payment && <p className="text-sm">Este pagamento não foi concluído. Você pode preparar uma nova tentativa.</p>}
        {!quote ? <>
          <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-sm font-medium">Como deseja pagar?</legend><div className="grid grid-cols-2 gap-3">
            <button type="button" aria-pressed={method === "PIX"} className={`rounded-lg border p-3 text-sm ${method === "PIX" ? "border-primary bg-primary/10" : ""}`} onClick={() => { setMethod("PIX"); setInstallments(1); }}>Pix</button>
            <button type="button" disabled={!cardEnabled} aria-pressed={method === "CREDIT_CARD"} className={`rounded-lg border p-3 text-sm disabled:opacity-50 ${method === "CREDIT_CARD" ? "border-primary bg-primary/10" : ""}`} onClick={() => setMethod("CREDIT_CARD")}>Cartão</button>
          </div>{!cardEnabled && <p className="text-xs text-muted-foreground">Cartão em validação. Pix disponível neste fluxo.</p>}
          {method === "CREDIT_CARD" && <label className="block text-sm">Parcelas<select value={installments} onChange={(e) => setInstallments(Number(e.target.value))} className="mt-1 h-10 w-full rounded-md border bg-background px-3">{Array.from({ length: 12 }, (_, n) => <option key={n} value={n + 1}>{n + 1}x</option>)}</select></label>}</fieldset>
          <Button onClick={() => void calculate()} disabled={busy} className="min-h-11 w-full whitespace-normal">{busy ? "Calculando…" : "Ver valores e continuar"}</Button>
        </> : <>
          <section className="rounded-lg border bg-muted/30 p-4 text-sm" aria-label="Resumo do pagamento"><h3 className="break-words font-semibold">{quote.plan_name} · {cycle === "annual" ? "Anual" : "Mensal"}</h3>
            <dl className="mt-3 space-y-2"><div className="flex flex-wrap justify-between gap-2"><dt>Plano</dt><dd>{money(quote.base_cents)}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>Acréscimo do cartão</dt><dd>{money(quote.surcharge_cents)}</dd></div><div className="flex flex-wrap justify-between gap-2 border-t pt-2 font-semibold"><dt>Total a pagar</dt><dd>{money(quote.total_cents)}</dd></div></dl>
            {quote.installments > 1 && <p className="mt-2 text-xs">{quote.installments - 1} parcela(s) de {money(quote.installment_cents)} e a última de {money(quote.last_installment_cents)}.</p>}
            <p className="mt-3 text-xs text-muted-foreground">{method === "PIX" ? "Pix à vista." : "Taxas de recebimento repassadas, sem antecipação."} Renovação manual, sem débito automático.</p>
          </section>
          <form onSubmit={pay} className="sentry-block space-y-4" data-sentry-block>
            <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><legend className="mb-3 text-sm font-medium">Dados do pagador{method === "CREDIT_CARD" ? " (titular do cartão)" : ""}</legend>
              <Field name="name" label="Nome completo / razão social" autoComplete="name" /><Field name="email" label="E-mail" type="email" autoComplete="email" />
              <Field name="cpf_cnpj" label="CPF ou CNPJ" inputMode="numeric" maxLength={18} /><Field name="phone" label="Celular com DDD" inputMode="tel" maxLength={16} />
              <Field name="postal_code" label="CEP" inputMode="numeric" maxLength={9} /><Field name="address_number" label="Número do endereço" maxLength={20} />
            </fieldset>
            {method === "CREDIT_CARD" && <fieldset disabled={busy} className="grid min-w-0 grid-cols-2 gap-3"><legend className="mb-3 text-sm font-medium">Cartão de crédito</legend>
              <Field name="holder_name" label="Nome impresso no cartão" maxLength={120} /><Field name="number" label="Número do cartão" inputMode="numeric" maxLength={23} />
              <Field name="expiry_month" label="Mês (MM)" inputMode="numeric" pattern="0[1-9]|1[0-2]" maxLength={2} /><Field name="expiry_year" label="Ano (AAAA)" inputMode="numeric" pattern="20[0-9]{2}" maxLength={4} />
              <Field name="ccv" label="Código de segurança" inputMode="numeric" type="password" maxLength={4} />
            </fieldset>}
            <p className="text-xs text-muted-foreground">Processado pelo Asaas. O CRM não salva o número nem o código de segurança do cartão.</p>
            <Button type="submit" disabled={busy} className="h-auto min-h-11 w-full whitespace-normal px-3 py-2">{method === "PIX" ? `Gerar Pix de ${money(quote.total_cents)}` : `Confirmar pagamento de ${money(quote.total_cents)}`}</Button>
            <Button type="button" variant="ghost" disabled={busy} className="w-full" onClick={() => setQuote(null)}>Alterar forma de pagamento</Button>
          </form>
        </>}
      </div>}
    </DialogContent>
  </Dialog>;
}
function Field({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  return <label className="block min-w-0 text-sm">{label}<Input required autoComplete="off" {...props} className="mt-1 min-h-10 min-w-0 text-base sm:text-sm" /></label>;
}
