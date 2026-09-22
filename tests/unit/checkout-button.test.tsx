import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CheckoutButton } from "@/components/billing/CheckoutButton";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const quote = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", plan_code: "essential", plan_name: "Essencial", billing_cycle: "monthly", payment_method: "PIX", installments: 1, base_cents: 7990, total_cents: 7990, surcharge_cents: 0, installment_cents: 7990, last_installment_cents: 7990, currency: "BRL", expires_at: "2099-01-01T00:00:00Z" };

it("abre popup acessível sem criar cobrança nem sair da página", async () => {
  const fetchMock = vi.fn().mockResolvedValue(response({ data: { payment: null, card_enabled: false } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await screen.findByRole("button", { name: "Ver valores e continuar" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/billing/payments", expect.objectContaining({ method: "GET" }));
  expect(screen.getByRole("button", { name: "Cartão" }).hasAttribute("disabled")).toBe(true);
});

it("exibe a cotação antes de pedir confirmação e não envia pagamento ao calcular", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: { payment: null, card_enabled: true } })).mockResolvedValueOnce(response({ data: quote }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Ver valores e continuar" }));
  await screen.findByRole("button", { name: /Gerar Pix/ });
  expect(screen.getByRole("region", { name: "Resumo do pagamento" })).toBeTruthy();
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

it("retoma Pix pendente em vez de gerar outra cobrança", async () => {
  const payment = { id: quote.id, status: "pending", total_cents: 7990, payment_method: "PIX", pix: { encoded_image: "YWJj", payload: "PIX-TEST-ONLY", expiration_date: "2099-01-01" } };
  const fetchMock = vi.fn().mockResolvedValue(response({ data: { payment, card_enabled: false } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  await screen.findByRole("button", { name: "Copiar código Pix" });
  expect(screen.queryByRole("button", { name: "Ver valores e continuar" })).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("mantém timeout pendente e nunca repete o POST financeiro", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ data: { payment: null, card_enabled: true } })).mockResolvedValueOnce(response({ data: quote })).mockRejectedValueOnce(new TypeError("Network error"));
  vi.stubGlobal("fetch", fetchMock);
  render(<CheckoutButton planCode="essential" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Ver valores e continuar" }));
  const submit = await screen.findByRole("button", { name: /Gerar Pix/ });
  fireEvent.submit(submit.closest("form")!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await screen.findByRole("button", { name: "Verificar pagamento" });
  expect(screen.queryByRole("button", { name: /Gerar Pix/ })).toBeNull();
  expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/billing/payments");
});
