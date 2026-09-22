import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CheckoutButton } from "@/components/billing/CheckoutButton";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["monthly", "annual"] as const)("envia o clique %s para a API versionada com o cliente HTTP real", async (cycle) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "mfa_required", message: "Confirme sua sessão." } }), { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  render(<CheckoutButton planCode="ESSENTIAL" cycle={cycle} label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("Confirme sua sessão."));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/billing/checkout", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ plan_code: "ESSENTIAL", billing_cycle: cycle }) }));
  expect(screen.getByRole("button", { name: "Assinar" }).hasAttribute("disabled")).toBe(false);
});

it("não expõe uma página HTML como mensagem e permite tentar novamente", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!DOCTYPE html><html>erro</html>", { status: 404 })));
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  render(<CheckoutButton planCode="ESSENTIAL" cycle="monthly" label="Assinar" />);
  fireEvent.click(screen.getByRole("button", { name: "Assinar" }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("Não foi possível abrir o checkout agora. Tente novamente em instantes."));
  expect(screen.getByRole("button", { name: "Assinar" }).hasAttribute("disabled")).toBe(false);
});
