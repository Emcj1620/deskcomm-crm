import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), rpc: vi.fn(), update: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/billing/asaas-payments", async (importOriginal) => ({ ...(await importOriginal<object>()), paymentRequest: mocks.request }));
import { reconcilePayment, type PaymentIntent } from "@/lib/billing/native-payments";
import { sentryScrubHooks } from "@/lib/sentry/scrub";
import { providerPaymentSchema } from "@/lib/billing/asaas-payments";

const intent: PaymentIntent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", created_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", plan_code: "essential", plan_name: "Essencial", billing_cycle: "monthly", payment_method: "PIX", installments: 1, base_cents: 7990, total_cents: 7990, expires_at: "2099-01-01T00:00:00Z", status: "pending", provider_customer_id: "cus_test", provider_payment_id: "pay_test", provider_installment_id: null };
const payment = { id: "pay_test", customer: "cus_test", status: "RECEIVED", value: 79.9, billingType: "PIX", externalReference: intent.id };
beforeEach(() => {
  vi.clearAllMocks();
  const chain = { eq: vi.fn(), neq: vi.fn().mockResolvedValue({ error: null }) };
  chain.eq.mockReturnValue(chain);
  mocks.update.mockReturnValue(chain);
  mocks.from.mockReturnValue({ update: mocks.update });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

it("aceita parcela nula retornada pelo Asaas em cobrança à vista", () => {
  expect(providerPaymentSchema.safeParse({ ...payment, installmentNumber: null }).success).toBe(true);
});
it.each([
  { billingType: "PIX", status: "RECEIVED_IN_CASH" },
  { billingType: "RECEIVED_IN_CASH", status: "RECEIVED" },
])("reconhece baixa manual confirmada pelo Asaas: %j", async (manual) => {
  mocks.request.mockResolvedValue({ ...payment, ...manual });
  expect((await reconcilePayment(intent)).status).toBe("paid");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenCalledTimes(1); // no QR request after manual receipt
});
it.each([{ value: 1 }, { customer: "cus_other" }, { externalReference: "other" }, { id: "pay_other" }])("baixa manual não dispensa vínculo e valor: %j", async (change) => {
  mocks.request.mockResolvedValue({ ...payment, status: "RECEIVED_IN_CASH", ...change });
  await expect(reconcilePayment(intent)).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("não aceita tipo dinheiro sem confirmação de recebimento", async () => {
  mocks.request.mockResolvedValue({ ...payment, billingType: "RECEIVED_IN_CASH", status: "PENDING" });
  await expect(reconcilePayment(intent)).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("não liquida parcelamento inteiro pela baixa manual de uma parcela", async () => {
  mocks.request.mockResolvedValue({ ...payment, billingType: "CREDIT_CARD", status: "RECEIVED_IN_CASH" });
  await expect(reconcilePayment({ ...intent, payment_method: "CREDIT_CARD", installments: 12 })).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("só concede assinatura após consultar pagamento confirmado no provedor", async () => {
  mocks.request.mockResolvedValue(payment);
  expect((await reconcilePayment(intent)).status).toBe("paid");
  expect(mocks.rpc).toHaveBeenCalledWith("fn_settle_billing_payment", { p_intent: intent.id, p_org: intent.organization_id, p_payment: "pay_test" });
});
it.each([
  { value: 1 }, { customer: "cus_other_tenant" }, { externalReference: "other" }, { billingType: "BOLETO" },
])("não ativa quando o provedor retorna cobrança incompatível: %j", async (change) => {
  mocks.request.mockResolvedValue({ ...payment, ...change });
  await expect(reconcilePayment(intent)).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("não ativa assinatura porque o QR Code foi gerado", async () => {
  mocks.request.mockResolvedValueOnce({ ...payment, status: "PENDING" }).mockResolvedValueOnce({ encodedImage: "YWJj", payload: "TEST", expirationDate: "2099-01-01" });
  const result = await reconcilePayment(intent);
  expect(result.status).toBe("pending");
  expect(result.pix?.payload).toBe("TEST");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("timeout sem resultado permanece incerto e não cria novo pagamento", async () => {
  mocks.request.mockResolvedValue({ data: [], hasMore: false });
  expect((await reconcilePayment({ ...intent, provider_payment_id: null, status: "uncertain" })).status).toBe("uncertain");
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("não informa sucesso se a transação no banco falhar", async () => {
  mocks.request.mockResolvedValue(payment);
  mocks.rpc.mockResolvedValue({ error: { message: "unavailable" } });
  await expect(reconcilePayment(intent)).rejects.toThrow("payment_settlement_pending");
});
it("não revoga assinatura vigente ao cancelar uma nova compra", async () => {
  mocks.request.mockResolvedValue({ ...payment, deleted: true });
  expect((await reconcilePayment(intent)).status).toBe("canceled");
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from.mock.calls.every(([table]) => table === "billing_payment_intents")).toBe(true);
});
it("remove corpo financeiro antes de enviar evento à telemetria", () => {
  const event = { request: { url: "https://example.test/api/v1/billing/payments", data: { card: { number: "TEST_CARD", ccv: "TEST_CVV" } } } };
  expect(sentryScrubHooks.beforeSend(event).request).not.toHaveProperty("data");
});
