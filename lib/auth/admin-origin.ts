export type AdminOriginDecision =
  { kind: "not_admin_surface" } | { kind: "allow" } | { kind: "reject"; status: 404 };

function hostname(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isAdminHost(input: { host: string; appUrl: string; adminUrl: string }): boolean {
  const requestHost = hostname(input.host);
  const appHost = hostname(input.appUrl);
  const adminHost = hostname(input.adminUrl);

  return Boolean(
    requestHost && appHost && adminHost && appHost !== adminHost && requestHost === adminHost,
  );
}

export function isExclusiveSuperadminEmail(
  email: string | null | undefined,
  allowed: string,
): boolean {
  const expected = allowed.trim().toLowerCase();
  return expected === "" || email?.trim().toLowerCase() === expected;
}

function isLocalHost(value: string): boolean {
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

export function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/v1/admin" ||
    pathname.startsWith("/api/v1/admin/")
  );
}

/**
 * Separa a superfície administrativa por HOST quando a instalação configura
 * URLs diferentes para app e administração. Enquanto os dois apontam para o
 * mesmo host (compatibilidade de instalações existentes), mantém o roteamento
 * por path. A autorização continua sendo feita por JWT + platform_admins + MFA;
 * esta fronteira é uma camada adicional, nunca o mecanismo principal.
 */
export function decideAdminOrigin(input: {
  host: string;
  pathname: string;
  appUrl: string;
  adminUrl: string;
}): AdminOriginDecision {
  if (!isAdminPath(input.pathname)) return { kind: "not_admin_surface" };

  const requestHost = hostname(input.host);
  const appHost = hostname(input.appUrl);
  const adminHost = hostname(input.adminUrl);

  // Configuração inválida ou ainda compartilhada: não derruba uma instalação
  // existente. O guard forte de autenticação/role/MFA permanece obrigatório.
  if (
    !requestHost ||
    !appHost ||
    !adminHost ||
    appHost === adminHost ||
    (isLocalHost(adminHost) && !isLocalHost(appHost))
  ) {
    return { kind: "allow" };
  }

  return requestHost === adminHost ? { kind: "allow" } : { kind: "reject", status: 404 };
}
