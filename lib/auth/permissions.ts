import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole, type RoleCheck } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";

export const TENANT_PERMISSIONS = [
  "users.read",
  "users.create",
  "users.update",
  "users.delete",
  "contacts.read",
  "contacts.create",
  "contacts.update",
  "contacts.delete",
  "leads.read",
  "leads.create",
  "leads.update",
  "leads.delete",
  "conversations.read",
  "conversations.send",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "tasks.delete",
  "pipelines.manage",
  "automations.manage",
  "whatsapp.manage",
  "integrations.manage",
  "billing.read",
  "billing.manage",
  "reports.read",
  "settings.manage",
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

const VIEWER: ReadonlySet<TenantPermission> = new Set([
  "contacts.read",
  "leads.read",
  "conversations.read",
  "tasks.read",
  "reports.read",
]);

const AGENT: ReadonlySet<TenantPermission> = new Set([
  ...VIEWER,
  "contacts.create",
  "contacts.update",
  "leads.create",
  "leads.update",
  "conversations.send",
  "tasks.create",
  "tasks.update",
]);

const MANAGER: ReadonlySet<TenantPermission> = new Set([
  ...AGENT,
  "users.read",
  "contacts.delete",
  "leads.delete",
  "tasks.delete",
  "pipelines.manage",
  "automations.manage",
  "integrations.manage",
]);

const ADMIN: ReadonlySet<TenantPermission> = new Set(TENANT_PERMISSIONS);

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<TenantPermission>>> = {
  viewer: VIEWER,
  agent: AGENT,
  ai_operator: AGENT,
  manager: MANAGER,
  admin: ADMIN,
};

export function roleHasPermission(role: Role, permission: TenantPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

interface RequirePermissionOptions {
  requestId?: string;
  resource?: string;
  allowPlatformAdmin?: boolean;
  organizationId?: string;
}

/**
 * Gate de API orientado a capacidade. A identidade, organização ativa, role
 * efetiva do banco e MFA continuam sendo resolvidas pelo guard canônico; a
 * decisão final deixa de depender de comparação de rank espalhada nas rotas.
 */
export async function requirePermission(
  permission: TenantPermission,
  opts: RequirePermissionOptions = {},
): Promise<RoleCheck> {
  const authz = await requireRole("viewer", opts);
  if (!authz.ok) return authz;
  if (roleHasPermission(authz.org.role, permission)) return authz;

  void audit({
    action: "authz.denied",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: opts.resource ?? permission.split(".")[0] ?? null,
    requestId: opts.requestId,
    metadata: { required_permission: permission, effective_role: authz.org.role },
  });
  return {
    ok: false,
    response: fail(
      "forbidden_role",
      `Permissão insuficiente. Requer ${permission}.`,
      403,
      { requestId: opts.requestId },
    ),
  };
}
