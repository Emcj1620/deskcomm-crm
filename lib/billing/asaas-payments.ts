import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";

/** Never attach request bodies, provider payloads or card data to errors/logs. */
export class PaymentProviderError extends Error {
  constructor(public readonly status: number) { super("payment_provider_unavailable"); }
}

export async function paymentRequest<T>(path: string, schema: z.ZodType<T>, body?: Record<string, unknown>): Promise<T> {
  if (!env.ASAAS_API_KEY) throw new PaymentProviderError(503);
  const response = await fetch(`${env.ASAAS_API_URL.replace(/\/$/, "")}${path}`, {
    method: body ? "POST" : "GET",
    headers: { access_token: env.ASAAS_API_KEY, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", signal: AbortSignal.timeout(body ? 90_000 : 20_000),
  });
  if (!response.ok) throw new PaymentProviderError(response.status);
  const parsed = schema.safeParse(await response.json());
  // A ZodError could include card/token data in its input. Do not throw it.
  if (!parsed.success) throw new PaymentProviderError(502);
  return parsed.data;
}

export const providerPaymentSchema = z.object({
  id: z.string().regex(/^pay_[a-zA-Z0-9]+$/), customer: z.string(),
  status: z.string(), value: z.number(), billingType: z.string(),
  externalReference: z.string().nullable().optional(), installment: z.string().nullable().optional(),
  installmentNumber: z.number().optional(), deleted: z.boolean().optional(),
});

export const paymentListSchema = z.object({ data: z.array(providerPaymentSchema), hasMore: z.boolean() });
