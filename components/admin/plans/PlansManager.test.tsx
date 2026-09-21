import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CatalogPlan } from "@/lib/billing/plan-catalog";
const mocks = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: mocks.post, patch: mocks.patch } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { PlansManager } from "./PlansManager";

const plan: CatalogPlan = { code: "business", name: "Business", monthly_price_cents: 24990, annual_price_cents: 249900,
  max_users: 10, max_whatsapp_numbers: 5, is_active: true, is_public: true, sort_order: 30, revision: 7, subscriptions: 1 };
beforeEach(() => { vi.resetAllMocks(); mocks.post.mockResolvedValue({}); mocks.patch.mockResolvedValue({}); });
afterEach(cleanup);
describe("editor de planos", () => {
  it("cria plano privado com preços em centavos", async () => {
    render(<PlansManager plans={[plan]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Novo plano" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Personalizado" } });
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Mensalidade (R$)"), { target: { value: "123,45" } });
    await user.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/admin/plans", expect.objectContaining({ code: "custom", monthly_price_cents: 12345, is_public: false })));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("editar carrega os valores e mantém o código imutável", async () => {
    render(<PlansManager plans={[plan]} />);
    await userEvent.click(screen.getByRole("button", { name: "Editar Business" }));
    expect(screen.getByLabelText("Código")).toBeDisabled();
    expect(screen.getByLabelText("Mensalidade (R$)")).toHaveValue("249,90");
    await userEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith("/admin/plans", expect.objectContaining({ expected_revision: 7, monthly_price_cents: 24990 })));
  });
  it("pede confirmação dos limites das assinaturas existentes", async () => {
    render(<PlansManager plans={[plan]} />);
    await userEvent.click(screen.getByRole("button", { name: "Editar Business" }));
    fireEvent.change(screen.getByLabelText("Limite de usuários"), { target: { value: "12" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Confirme");
    await userEvent.click(screen.getByRole("checkbox", { name: /Confirmo aplicar/ }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith("/admin/plans", expect.objectContaining({ max_users: 12, confirm_existing_limits: true })));
  });
  it("duplicar cria uma cópia privada sem editar o plano de origem", async () => {
    render(<PlansManager plans={[plan]} />);
    await userEvent.click(screen.getByRole("button", { name: "Duplicar Business" }));
    expect(screen.getByLabelText("Código")).toHaveValue("business_custom");
    expect(screen.getByLabelText("Código")).not.toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/admin/plans", expect.objectContaining({ code: "business_custom", is_public: false, max_users: 10, copy_from: "business" })));
    expect(mocks.patch).not.toHaveBeenCalled();
  });
  it("preserva o formulário se o servidor recusar edição desatualizada", async () => {
    mocks.patch.mockRejectedValue(new Error("Este plano foi alterado em outra sessão."));
    render(<PlansManager plans={[plan]} />);
    await userEvent.click(screen.getByRole("button", { name: "Editar Business" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("outra sessão"));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
