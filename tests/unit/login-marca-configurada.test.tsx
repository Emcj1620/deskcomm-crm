import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ nome: "Marca configurada", host: "chat.example.com" }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: vi.fn(async () => ({ nome: state.nome })) }));
vi.mock("@/lib/branding", () => ({ branding: () => ({ name: "Fallback antigo" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: state.host }) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://chat.example.com", NEXT_PUBLIC_ADMIN_URL: "https://admin.example.com" } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: async () => "pt-BR" }));
vi.mock("@/lib/i18n/dicionario", () => ({ traduzir: (s: string) => s }));
vi.mock("@/components/auth/LoginForm", () => ({ LoginForm: () => <div>Formulário de acesso</div> }));
import LoginPage from "@/app/(public)/login/page";
import { marcaDaSaida } from "@/lib/branding/saida";

beforeEach(() => { cleanup(); vi.clearAllMocks(); state.nome = "Marca configurada"; state.host = "chat.example.com"; });

it("usa a marca configurada, não o fallback antigo", async () => {
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Marca configurada")).toBeTruthy();
  expect(screen.queryByText("Fallback antigo")).toBeNull();
  expect(marcaDaSaida).toHaveBeenCalledWith(null);
});

it("acompanha uma alteração da marca na próxima renderização", async () => {
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  cleanup(); state.nome = "Nova marca do operador";
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Nova marca do operador")).toBeTruthy();
  expect(screen.queryByText("Marca configurada")).toBeNull();
});

it("mantém cadastro indisponível no domínio do superadmin", async () => {
  state.host = "admin.example.com";
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Marca configurada")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Criar conta" })).toBeNull();
});
