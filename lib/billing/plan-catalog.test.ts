import { describe, expect, it } from "vitest";
import { createPlanSchema, editPlanSchema, parsePriceCents, planWriteError } from "./plan-catalog";

const plan = { code: "clinica_custom", name: "Clínica sob medida", monthly_price_cents: 12345,
  annual_price_cents: 123450, max_users: 12, max_whatsapp_numbers: 7, is_active: true, is_public: false, sort_order: 40 };
describe("catálogo comercial", () => {
  it.each([["79,90",7990],["149.90",14990],["799",79900],["0",0],["12,3",1230]])("converte %s em centavos exatos", (input, expected) => {
    expect(parsePriceCents(String(input))).toBe(expected);
  });
  it.each(["-1", "1.234,56", "1,234", "NaN", "", "1e3", "9999999999999999999999"])("recusa preço ambíguo ou inválido %s", input => {
    expect(parsePriceCents(input)).toBeNull();
  });
  it("aceita plano personalizado privado", () => expect(createPlanSchema.parse(plan)).toEqual(plan));
  it("não aceita identidade ou features arbitrárias no payload", () => {
    expect(createPlanSchema.safeParse({ ...plan, p_actor: "forjado" }).success).toBe(false);
    expect(createPlanSchema.safeParse({ ...plan, features: {} }).success).toBe(false);
  });
  it.each([{code:"../admin"},{max_users:0},{max_whatsapp_numbers:1.2},{monthly_price_cents:-1},{name:" "}])("valida campos no servidor: %j", change => {
    expect(createPlanSchema.safeParse({ ...plan, ...change }).success).toBe(false);
  });
  it("exige revisão para editar e confirmação começa desligada", () => {
    expect(editPlanSchema.safeParse(plan).success).toBe(false);
    expect(editPlanSchema.parse({ ...plan, expected_revision: 1 }).confirm_existing_limits).toBe(false);
  });
  it("traduz conflitos sem expor erros do banco", () => {
    expect(planWriteError("P0001", "plan_stale").status).toBe(409);
    expect(planWriteError("XX000", "detalhe interno").message).not.toContain("detalhe interno");
  });
});
