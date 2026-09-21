import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ loggedIn: true, verified: false, aal: "aal1", factorError: false }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: state.loggedIn ? { user_metadata: {} } : null } }),
  mfa: {
    listFactors: async () => ({ data: { totp: state.verified ? [{ status: "verified" }] : [] }, error: state.factorError ? {} : null }),
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.aal }, error: null }),
  },
} }) }));
vi.mock("@/components/auth/MfaEnrollGate", () => ({ MfaEnrollGate: () => null }));
vi.mock("@/components/auth/MfaForm", () => ({ MfaForm: () => null }));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: async () => "pt-BR" }));

import MfaChallengePage from "@/app/(public)/login/mfa/page";
import { MfaEnrollGate } from "@/components/auth/MfaEnrollGate";

beforeEach(() => { Object.assign(state, { loggedIn: true, verified: false, aal: "aal1", factorError: false }); });
const page = (next = "/admin") => MfaChallengePage({ searchParams: Promise.resolve({ next }) });

describe("MFA sem depender de acesso ao CRM", () => {
  it("cadastra fator sem redirecionar para um tenant", async () => {
    const tree = await page() as ReactElement<{ enrolled: boolean }>;
    expect(tree.type).toBe(MfaEnrollGate);
    expect(tree.props.enrolled).toBe(false);
  });
  it("não trata falha de consulta como ausência de fator", async () => {
    state.factorError = true;
    await expect(page()).rejects.toThrow("Não foi possível confirmar");
  });
  it("não cadastra fator sem usuário autenticado", async () => {
    state.loggedIn = false;
    await expect(page()).rejects.toThrow("REDIRECT:/login");
  });
  it("depois do cadastro confirmado volta ao painel solicitado", async () => {
    state.verified = true;
    state.aal = "aal2";
    await expect(page()).rejects.toThrow("REDIRECT:/admin");
  });
  it("não redireciona para domínio externo pelo parâmetro next", async () => {
    state.verified = true;
    state.aal = "aal2";
    await expect(page("https://externo.exemplo.com")).rejects.toThrow("REDIRECT:/app");
  });
  it("mantém desafio para quem tem fator mas está em aal1", async () => {
    state.verified = true;
    await expect(page()).resolves.toBeTruthy();
  });
});
