import { describe, expect, it } from "vitest";
import { cardTotal, checkoutSelection, installmentAmounts } from "@/lib/billing/payment-quote";

const fees = { operationValue: 0.49, oneInstallmentPercentage: 2.99, upToSixInstallmentsPercentage: 3.49, upToTwelveInstallmentsPercentage: 3.99, hasValidDiscount: false };
describe("cotação de pagamento", () => {
  it.each([1, 2, 6, 7, 12])("repassa a taxa única e percentual em %s parcelas", (count) => {
    const result = cardTotal(79900, count, fees);
    const net = result.total_cents * (1 - result.fee_percentage / 100) - 49;
    expect(net).toBeGreaterThanOrEqual(79900);
    expect(net).toBeLessThan(79901);
    expect(result.surcharge_cents).toBe(result.total_cents - 79900);
  });
  it("não cobra a taxa fixa doze vezes", () => expect(cardTotal(79900, 12, fees).total_cents).toBe(83272));
  it("preserva todos os centavos na última parcela", () => {
    const result = installmentAmounts(83272, 12);
    expect(result.installment_cents * 11 + result.last_installment_cents).toBe(83272);
  });
  it("recusa tabela promocional incompleta", () => expect(() => cardTotal(7990, 1, { ...fees, hasValidDiscount: true })).toThrow());
  it.each([0, 13, 1.5])("recusa %s parcelas", (count) => expect(() => cardTotal(7990, count, fees)).toThrow());
  it("recusa Pix parcelado", () => expect(checkoutSelection.safeParse({ plan_code: "essential", billing_cycle: "annual", payment_method: "PIX", installments: 2 }).success).toBe(false));
});
