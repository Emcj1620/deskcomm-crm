import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "@/components/auth/MfaForm";
import { MfaEnrollGate } from "@/components/auth/MfaEnrollGate";
import { safeNext } from "@/lib/auth/safe-next";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { traduzir } from "@/lib/i18n/dicionario";

export const metadata = { title: "Verificação em duas etapas" };

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) throw new Error("Não foi possível confirmar os fatores de autenticação.");
  const hasVerified = !!factorsData?.totp?.some((f) => f.status === "verified");
  // Redirecionar para /app aqui criava um ciclo no host administrativo:
  // /app -> /admin -> /login/mfa. O cadastro não depende de entrar no CRM.
  if (!hasVerified) return <MfaEnrollGate enrolled={false}>{null}</MfaEnrollGate>;

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assuranceError && assurance?.currentLevel === "aal2") {
    redirect(safeNext(next, "/app"));
  }

  const idioma = await idiomaDoVisitante(
    (user.user_metadata?.locale as string | undefined) ?? null,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Verificação em duas etapas")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Digite o código de 6 dígitos do seu autenticador.")}
        </p>
      </div>
      <MfaForm next={next} />
    </div>
  );
}
