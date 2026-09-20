import { describe, expect, it } from "vitest";

import { decideAdminOrigin, isAdminPath } from "@/lib/auth/admin-origin";

describe("fronteira de host do super-admin", () => {
  const urls = {
    appUrl: "https://app.exemplo.com",
    adminUrl: "https://controle.exemplo.com",
  };

  it("reconhece UI e API administrativas sem engolir paths parecidos", () => {
    expect(isAdminPath("/admin/tenants")).toBe(true);
    expect(isAdminPath("/api/v1/admin/tenants")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/api/v1/administer")).toBe(false);
  });

  it("aceita a superfície administrativa somente no host administrativo", () => {
    expect(
      decideAdminOrigin({ ...urls, host: "controle.exemplo.com", pathname: "/admin" }),
    ).toEqual({ kind: "allow" });
    expect(
      decideAdminOrigin({
        ...urls,
        host: "controle.exemplo.com:443",
        pathname: "/api/v1/admin/tenants",
      }),
    ).toEqual({ kind: "allow" });
  });

  it("não expõe UI nem API administrativa no host dos clientes", () => {
    expect(decideAdminOrigin({ ...urls, host: "app.exemplo.com", pathname: "/admin" })).toEqual({
      kind: "reject",
      status: 404,
    });
    expect(
      decideAdminOrigin({ ...urls, host: "app.exemplo.com", pathname: "/api/v1/admin/users" }),
    ).toEqual({ kind: "reject", status: 404 });
  });

  it("preserva instalações atuais que ainda usam um único host", () => {
    expect(
      decideAdminOrigin({
        host: "crm.exemplo.com",
        pathname: "/admin",
        appUrl: "https://crm.exemplo.com",
        adminUrl: "https://crm.exemplo.com",
      }),
    ).toEqual({ kind: "allow" });
  });

  it("não tranca instalações antigas quando a URL administrativa ficou no default local", () => {
    expect(
      decideAdminOrigin({
        host: "crm.exemplo.com",
        pathname: "/admin",
        appUrl: "https://crm.exemplo.com",
        adminUrl: "http://localhost:3000",
      }),
    ).toEqual({ kind: "allow" });
  });
});
