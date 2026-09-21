import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { isAdminHost } from "@/lib/auth/admin-origin";

// A raiz não tem conteúdo próprio: manda pro painel. O middleware redireciona
// visitante não autenticado para /login?next=/app automaticamente.
export default async function HomePage() {
  const requestHeaders = await headers();
  const adminHost = isAdminHost({
    host: requestHeaders.get("host") ?? "",
    appUrl: env.NEXT_PUBLIC_APP_URL,
    adminUrl: env.NEXT_PUBLIC_ADMIN_URL,
  });
  redirect(adminHost ? "/admin" : "/app");
}
