import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "emersonpyres@gmail.com" as string | null,
  admin: true,
  required: false,
  aal: "aal1" as string | null,
  assurance: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: { SUPERADMIN_EMAIL: "emersonpyres@gmail.com" } }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: {
    getUser: async () => ({ data: { user: state.email ? { id: "owner", email: state.email } : null } }),
    mfa: { getAuthenticatorAssuranceLevel: state.assurance },
  },
  from: () => ({ select: () => ({ eq: () => ({ is: () => ({
    maybeSingle: async () => ({ data: state.admin ? {
      user_id: "owner", scope: "full", mfa_required: state.required,
    } : null }),
  }) }) }) }),
}) }));

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";

beforeEach(() => {
  vi.clearAllMocks();
  state.email = "emersonpyres@gmail.com";
  state.admin = true;
  state.required = false;
  state.aal = "aal1";
  state.assurance.mockImplementation(async () => ({ data: { currentLevel: state.aal } }));
});

describe("superadmin exclusivo com MFA obrigatório", () => {
  it("exige autenticação", async () => {
    state.email = null;
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/login?next=/admin");
  });
  it("nega outra conta mesmo com registro de administrador e aal2", async () => {
    state.email = "outra@exemplo.com";
    state.aal = "aal2";
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/admin/forbidden");
  });
  it("não concede administração apenas por conhecer o e-mail", async () => {
    state.admin = false;
    state.aal = "aal2";
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/admin/forbidden");
  });
  it("exige aal2 mesmo se a configuração antiga permitir desativar MFA", async () => {
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/login/mfa?next=/admin");
  });
  it("nega quando não consegue confirmar o nível de autenticação", async () => {
    state.aal = null;
    await expect(requirePlatformAdmin()).rejects.toThrow("REDIRECT:/login/mfa?next=/admin");
  });
  it("permite a conta exclusiva com papel confirmado e aal2", async () => {
    state.aal = "aal2";
    const context = await requirePlatformAdmin();
    expect(context.user.email).toBe("emersonpyres@gmail.com");
    expect(context.platformAdmin.mfa_required).toBe(true);
  });
});
