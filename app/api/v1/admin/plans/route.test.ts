import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), user: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: mocks.guard }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: mocks.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { POST, PATCH } from "./route";
const fields = { code: "custom", name: "Personalizado", monthly_price_cents: 7990, annual_price_cents: 79900,
  max_users: 2, max_whatsapp_numbers: 1, is_active: true, is_public: false, sort_order: 40 };
const request = (body: unknown) => new Request("https://admin.exemplo.com/api/v1/admin/plans", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: "verified-admin" } });
  mocks.user.mockResolvedValue({ id: "verified-admin", support: null });
  mocks.rpc.mockResolvedValue({ data: { ...fields, revision: 1 }, error: null });
});
describe("API de edição de planos", () => {
  it("recusa quem não passou por identidade, papel e MFA", async () => {
    mocks.guard.mockRejectedValue(new Error("denied"));
    expect((await POST(request(fields))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("não permite alteração global durante suporte a empresa", async () => {
    mocks.user.mockResolvedValue({ support: { status: "active", access_mode: "full" } });
    expect((await POST(request(fields))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("usa somente o ator verificado e grava via RPC atômica", async () => {
    expect((await POST(request(fields))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_admin_save_saas_plan", { p_plan: fields, p_actor: "verified-admin", p_expected_revision: null, p_confirm_limits: false });
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("recusa payload com tentativa de passar ator", async () => {
    expect((await POST(request({ ...fields, p_actor: "other" }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("encaminha revisão e confirmação na edição", async () => {
    expect((await PATCH(request({ ...fields, expected_revision: 3, confirm_existing_limits: true }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_admin_save_saas_plan", expect.objectContaining({ p_expected_revision: 3, p_confirm_limits: true, p_plan: fields }));
  });
  it("não sobrescreve conflito nem registra auditoria de sucesso", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "plan_stale" } });
    expect((await PATCH(request({ ...fields, expected_revision: 1 }))).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("recusa corpo inválido sem acessar banco", async () => {
    expect((await POST(new Request("https://example.com", { method: "POST", body: "{" }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
