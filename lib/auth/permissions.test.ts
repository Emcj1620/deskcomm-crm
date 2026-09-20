import { describe, expect, it } from "vitest";

import { roleHasPermission, TENANT_PERMISSIONS } from "@/lib/auth/permissions";

describe("catálogo RBAC por permissão", () => {
  it("admin possui todas as permissões declaradas", () => {
    for (const permission of TENANT_PERMISSIONS) {
      expect(roleHasPermission("admin", permission), permission).toBe(true);
    }
  });

  it("manager lê usuários, mas não convida, remove nem administra cobrança", () => {
    expect(roleHasPermission("manager", "users.read")).toBe(true);
    expect(roleHasPermission("manager", "users.create")).toBe(false);
    expect(roleHasPermission("manager", "users.delete")).toBe(false);
    expect(roleHasPermission("manager", "billing.manage")).toBe(false);
  });

  it("member operacional não recebe poderes administrativos por hierarquia acidental", () => {
    expect(roleHasPermission("agent", "conversations.send")).toBe(true);
    expect(roleHasPermission("agent", "settings.manage")).toBe(false);
    expect(roleHasPermission("agent", "whatsapp.manage")).toBe(false);
  });

  it("viewer permanece somente leitura", () => {
    expect(roleHasPermission("viewer", "contacts.read")).toBe(true);
    expect(roleHasPermission("viewer", "contacts.update")).toBe(false);
  });
});
