"use client";
import Link from "next/link";
import { Buildings } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";

/**
 * Sticky top banner that signals the user is operating in cross-tenant
 * Platform mode. Persistent visual cue to prevent accidental destructive
 * actions when the operator forgets which surface they're in.
 */
export function PlatformModeBanner({ appUrl = "/app" }: { appUrl?: string }) {
  const t = useT();
  return (
    <div
      role="region"
      aria-label={t("Modo Plataforma")}
      className="sticky top-0 z-40 flex min-h-10 w-full min-w-0 flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-900"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <Buildings size={18} weight="fill" className="shrink-0" aria-hidden />
        <span className="font-semibold tracking-tight">{t("MODO PLATAFORMA")}</span>
        <span className="hidden text-amber-800/80 sm:inline">{t("— operação cross-tenant")}</span>
      </div>
      <Link
        href={appUrl}
        className="rounded-md px-2 py-1 text-xs font-medium underline-offset-2 hover:underline"
      >
        {t("Sair pra app pessoal")}
      </Link>
    </div>
  );
}
