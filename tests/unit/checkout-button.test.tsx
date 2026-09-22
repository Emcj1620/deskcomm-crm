import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CheckoutButton } from "@/components/billing/CheckoutButton";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const quote = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", plan_code: "essential", plan_name: "Essencial", billing_cycle: "monthly", payment_method: "PIX", installments: 1, base_cents: 7990, total_cents: 7990, surcharge_cents: 0, installment_cents: 7990, last_installment_cents: 7990, currency: "BRL", expires_at: "2099-01-01T00:00:00Z" };
async function advance() {
  const button = screen.getByRole("button", { name: "Avançar para pagamento" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.submit(button.closest("form")!);
}

it("abre popup acessível sem criar cobrança nem sair da página", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({ data: { payment: null, card_enabled: false } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Avançar para pagamento" }).hasAttribute("disabled")).toBe(false));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/billing/payments", expect.objectContaining({ method: "GET" }));
  expect(screen.getByRole("button", { name: "Cartão" }).hasAttribute("disabled")).toBe(true);
});

it("exibe a cotação antes de pedir confirmação e não envia pagamento ao calcular", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: { payment: null, card_enabled: true } })).mockResolvedValueOnce(response({ data: quote }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  fireEvent.change(screen.getByLabelText("Nome completo / razão social"), { target: { value: "Cliente Teste" } });
  await advance();
  await screen.findByRole("button", { name: /Gerar Pix/ });
  expect(screen.getByRole("region", { name: "Resumo do pagamento" })).toBeTruthy();
  expect((screen.getByLabelText("Nome completo / razão social") as HTMLInputElement).value).toBe("Cliente Teste");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/billing/quote");
});

it("não expõe HTML nem usa alert quando a API falha", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("<!DOCTYPE html><html>erro</html>", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  expect((await screen.findByRole("alert")).textContent).not.toContain("<html>");
  expect(alert).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("habilita cartão, limita a 12x e mostra acréscimo antes de confirmar", async () => {
  const cardQuote = { ...quote, payment_method: "CREDIT_CARD", installments: 12, total_cents: 8373, surcharge_cents: 383, installment_cents: 697, last_installment_cents: 706 };
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: { payment: null, card_enabled: true } })).mockResolvedValueOnce(response({ data: cardQuote }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Cartão" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Cartão" }));
  const select = screen.getByRole("combobox", { name: "Parcelas" });
  expect(select.querySelectorAll("option")).toHaveLength(12);
  fireEvent.change(select, { target: { value: "12" } });
  expect(screen.getByLabelText("Número do cartão")).toBeTruthy();
  await advance();
  await screen.findByRole("button", { name: /Confirmar pagamento/ });
  expect(screen.getByText("Acréscimo do cartão")).toBeTruthy();
  expect(screen.getByLabelText("Número do cartão")).toBeTruthy();
  expect(screen.getByLabelText("Código de segurança")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toMatchObject({ payment_method: "CREDIT_CARD", installments: 12 });
});

it("retoma Pix pendente em vez de gerar outra cobrança", async () => {
  const payment = { id: quote.id, status: "pending", total_cents: 7990, payment_method: "PIX", pix: { encoded_image: "YWJj", payload: "PIX-TEST-ONLY", expiration_date: "2099-01-01" } };
  const fetchMock = vi.fn().mockResolvedValue(response({ data: { payment, card_enabled: false } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  await screen.findByRole("button", { name: "Copiar código Pix" });
  expect(screen.queryByRole("button", { name: "Avançar para pagamento" })).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("mantém timeout pendente e nunca repete o POST financeiro", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: { payment: null, card_enabled: true } })).mockResolvedValueOnce(response({ data: quote })).mockRejectedValueOnce(new TypeError("Network error"));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  await advance();
  const submit = await screen.findByRole("button", { name: /Gerar Pix/ });
  fireEvent.submit(submit.closest("form")!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await screen.findByRole("button", { name: "Verificar pagamento" });
  expect(screen.queryByRole("button", { name: /Gerar Pix/ })).toBeNull();
  expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/billing/payments");
});

it("mostra campos imediatamente mesmo com consulta lenta, mas impede nova cobrança", async () => {
  let resolve!: (value: Response) => void;
  const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  const name = screen.getByLabelText("Nome completo / razão social");
  expect(name.hasAttribute("disabled")).toBe(false);
  fireEvent.change(name, { target: { value: "Cliente Teste" } });
  const button = screen.getByRole("button", { name: "Avançar para pagamento" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.submit(button.closest("form")!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  resolve(response({ data: { payment: null, card_enabled: true } }));
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  expect((name as HTMLInputElement).value).toBe("Cliente Teste");
});
