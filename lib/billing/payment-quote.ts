import { z } from "zod";

export const checkoutSelection = z.object({
  plan_code: z.string().min(2).max(64),
  billing_cycle: z.enum(["monthly", "annual"]),
  payment_method: z.enum(["PIX", "CREDIT_CARD"]),
  installments: z.number().int().min(1).max(12),
}).refine((v) => v.payment_method !== "PIX" || v.installments === 1, "Pix é à vista.")
  .refine((v) => v.billing_cycle !== "monthly" || v.installments === 1, "O plano mensal permite apenas 1x.");

export const cardFeesSchema = z.object({
  operationValue: z.number().nonnegative(),
  oneInstallmentPercentage: z.number().min(0).max(99),
  upToSixInstallmentsPercentage: z.number().min(0).max(99),
  upToTwelveInstallmentsPercentage: z.number().min(0).max(99),
  hasValidDiscount: z.boolean(),
  discountOneInstallmentPercentage: z.number().min(0).max(99).optional(),
  discountUpToSixInstallmentsPercentage: z.number().min(0).max(99).optional(),
  discountUpToTwelveInstallmentsPercentage: z.number().min(0).max(99).optional(),
});

/** Taxa fixa única por venda, não por parcela. Sem taxa de antecipação. */
export function cardTotal(baseCents: number, installments: number, rawFees: unknown) {
  if (!Number.isSafeInteger(baseCents) || baseCents <= 0 || !Number.isInteger(installments) || installments < 1 || installments > 12) {
    throw new Error("invalid_quote");
  }
  const fees = cardFeesSchema.parse(rawFees);
  const rate = installments === 1
    ? (fees.hasValidDiscount ? fees.discountOneInstallmentPercentage : fees.oneInstallmentPercentage)
    : installments <= 6
      ? (fees.hasValidDiscount ? fees.discountUpToSixInstallmentsPercentage : fees.upToSixInstallmentsPercentage)
      : (fees.hasValidDiscount ? fees.discountUpToTwelveInstallmentsPercentage : fees.upToTwelveInstallmentsPercentage);
  if (rate === undefined) throw new Error("fees_unavailable");
  const totalCents = Math.ceil((baseCents + Math.round(fees.operationValue * 100)) / (1 - rate / 100));
  if (!Number.isSafeInteger(totalCents)) throw new Error("invalid_quote");
  return { total_cents: totalCents, surcharge_cents: totalCents - baseCents, fee_percentage: rate };
}

export function installmentAmounts(totalCents: number, count: number) {
  const regular = Math.floor(totalCents / count);
  return { installment_cents: regular, last_installment_cents: totalCents - regular * (count - 1) };
}

export type PaymentQuote = {
  id: string; plan_code: string; plan_name: string; billing_cycle: "monthly" | "annual";
  payment_method: "PIX" | "CREDIT_CARD"; installments: number;
  base_cents: number; total_cents: number; surcharge_cents: number;
  installment_cents: number; last_installment_cents: number; expires_at: string;
  currency: "BRL";
};

export type PaymentStatus = {
  id: string; status: string; total_cents: number; payment_method: "PIX" | "CREDIT_CARD";
  pix?: { encoded_image: string; payload: string; expiration_date: string };
};
