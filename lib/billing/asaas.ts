import { env } from "@/lib/env";

export type AsaasCheckout = { id: string; link: string; status?: string };

/** Server-only Asaas client. The API key never crosses into the browser. */
export async function createAsaasCheckout(body: Record<string, unknown>): Promise<AsaasCheckout> {
  if (!env.ASAAS_API_KEY) throw new Error("asaas_not_configured");
  const response = await fetch(`${env.ASAAS_API_URL}/checkouts`, {
    method: "POST",
    headers: { access_token: env.ASAAS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("asaas_checkout_failed");
  const data = (await response.json()) as { id?: string; link?: string; status?: string };
  if (!data.id || !data.link) throw new Error("asaas_checkout_invalid_response");
  return { id: data.id, link: data.link, status: data.status };
}
