import { describe, expect, it } from "vitest";
import { decideCapacity } from "./entitlements";

describe("limites comerciais do tenant", () => {
  it("permite consumo dentro do plano e informa o saldo", () => {
    expect(decideCapacity({ status: "active", current: 1, increment: 1, limit: 2 })).toEqual({
      allowed: true,
      current: 1,
      limit: 2,
      remaining: 0,
    });
  });

  it("recusa ultrapassar o limite, inclusive em operações em lote", () => {
    expect(
      decideCapacity({ status: "trialing", current: 1, increment: 2, limit: 2 }),
    ).toMatchObject({
      allowed: false,
      reason: "plan_limit_reached",
      remaining: 1,
    });
  });

  it("uma assinatura suspensa não ganha acesso só por ainda ter saldo", () => {
    expect(
      decideCapacity({ status: "suspended", current: 0, increment: 1, limit: 10 }),
    ).toMatchObject({
      allowed: false,
      reason: "subscription_inactive",
    });
  });
});
