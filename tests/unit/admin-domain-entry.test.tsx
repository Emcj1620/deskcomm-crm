import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  host: "controle.exemplo.com",
  support: null as null | { status: string },
  platformGuard: vi.fn(),
  resolveOrg: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: {
  NEXT_PUBLIC_APP_URL: "https://crm.exemplo.com",
  NEXT_PUBLIC_ADMIN_URL: "https://controle.exemplo.com",
} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({ id: "admin-1", support: state.support }),
  resolveActiveOrg: state.resolveOrg,
  isMfaEnrolled: vi.fn(),
  requiresMfa: vi.fn(),
}));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: state.platformGuard,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.host = "controle.exemplo.com";
  state.support = null;
  // Para no início da resolução do tenant, depois da fronteira de plataforma.
  state.resolveOrg.mockRejectedValue(new Error("TENANT_RESOLUTION"));
  state.platformGuard.mockResolvedValue({});
});

describe("entrada isolada da plataforma", () => {
  it("abre administração na raiz do domínio exclusivo", async () => {
    const { default: HomePage } = await import("@/app/page");
    await expect(HomePage()).rejects.toThrow("REDIRECT:/admin");
  });

  it("mantém a raiz do domínio dos clientes no CRM", async () => {
    state.host = "crm.exemplo.com";
    const { default: HomePage } = await import("@/app/page");
    await expect(HomePage()).rejects.toThrow("REDIRECT:/app");
  });

  it("não resolve tenant no domínio administrativo sem suporte explícito", async () => {
    const { default: AppLayout } = await import("@/app/app/layout");
    await expect(AppLayout({ children: null })).rejects.toThrow("REDIRECT:/admin");
    expect(state.resolveOrg).not.toHaveBeenCalled();
  });

  it("não exige papel de plataforma de clientes no domínio do CRM", async () => {
    state.host = "crm.exemplo.com";
    const { default: AppLayout } = await import("@/app/app/layout");
    await expect(AppLayout({ children: null })).rejects.toThrow("TENANT_RESOLUTION");
    expect(state.platformGuard).not.toHaveBeenCalled();
  });

  it("valida identidade e MFA da plataforma antes de abrir suporte", async () => {
    state.support = { status: "active" };
    state.platformGuard.mockRejectedValue(new Error("REDIRECT:/login/mfa?next=/admin"));
    const { default: AppLayout } = await import("@/app/app/layout");
    await expect(AppLayout({ children: null })).rejects.toThrow("REDIRECT:/login/mfa");
    expect(state.resolveOrg).not.toHaveBeenCalled();
  });

  it.each(["active", "expired", "revoked"])("preserva o fluxo de suporte %s após o guard", async (status) => {
    state.support = { status };
    const { default: AppLayout } = await import("@/app/app/layout");
    await expect(AppLayout({ children: null })).rejects.toThrow("TENANT_RESOLUTION");
    expect(state.platformGuard).toHaveBeenCalledOnce();
  });
});
