/**
 * Server guard for /admin/* (Super-Admin Platform sub-product).
 *
 * Flow:
 *  1. Validate JWT via getUser() (NEVER getSession on backend per CLAUDE.md).
 *  2. Confirm row in platform_admins (active = no revoked_at).
 *  3. Enforce MFA AAL2 for the exclusive SaaS administrator, or when
 *     `mfa_required` is enabled in shared/self-hosted installations.
 *
 * Redirects:
 *  - no user        → /login?next=/admin
 *  - no row         → /admin/forbidden
 *  - aal1 + required → /login/mfa?next=/admin
 *
 * The middleware already does an early `fn_is_platform_admin` RPC check;
 * this helper performs the authoritative server-side validation inside the
 * /admin layout (where redirects are cheap, DB calls are allowed in Node
 * runtime, and we have access to AAL state).
 */
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { isExclusiveSuperadminEmail } from "@/lib/auth/admin-origin";

export interface PlatformAdminInfo {
  user_id: string;
  scope: string;
  mfa_required: boolean;
}

export interface PlatformAdminContext {
  user: User;
  platformAdmin: PlatformAdminInfo;
}

export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/admin");
  }

  if (!isExclusiveSuperadminEmail(user.email, env.SUPERADMIN_EMAIL)) {
    redirect("/admin/forbidden");
  }

  // platform_admins RLS: only platform admins read; non-admins get null → forbid.
  const { data: paRow } = await supabase
    .from("platform_admins")
    .select("user_id, scope, mfa_required, revoked_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (!paRow) {
    redirect("/admin/forbidden");
  }

  // Instalação SaaS com proprietário exclusivo nunca permite desligar MFA
  // por um valor legado na tabela. O cadastro continua acessível em /login/mfa.
  const mfaRequired = paRow.mfa_required || env.SUPERADMIN_EMAIL.trim() !== "";
  if (mfaRequired) {
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.currentLevel !== "aal2") {
      redirect("/login/mfa?next=/admin");
    }
  }

  return {
    user,
    platformAdmin: {
      user_id: paRow.user_id,
      scope: paRow.scope,
      mfa_required: mfaRequired,
    },
  };
}
