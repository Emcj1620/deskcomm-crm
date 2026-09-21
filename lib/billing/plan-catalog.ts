import { z } from "zod";

export const planCodeSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/, "Use de 2 a 64 letras minúsculas, números, hífen ou sublinhado; comece com letra.");
const cents = z.number().int().min(0).max(2_147_483_647);
export const planFieldsSchema = z.object({
  code: planCodeSchema,
  name: z.string().trim().min(2).max(100),
  monthly_price_cents: cents,
  annual_price_cents: cents,
  max_users: z.number().int().min(1).max(100_000),
  max_whatsapp_numbers: z.number().int().min(1).max(100_000),
  is_active: z.boolean(),
  is_public: z.boolean(),
  sort_order: z.number().int().min(0).max(100_000),
}).strict();
export const createPlanSchema = planFieldsSchema.extend({ copy_from: planCodeSchema.optional() }).strict();
export const editPlanSchema = planFieldsSchema.extend({
  expected_revision: z.number().int().positive(),
  confirm_existing_limits: z.boolean().default(false),
}).strict();
export type PlanFields = z.infer<typeof planFieldsSchema>;
export type CatalogPlan = PlanFields & { revision: number; subscriptions: number };

/** Inteiro em centavos, sem arredondamento silencioso de casas excedentes. */
export function parsePriceCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [units, fraction = ""] = normalized.split(".");
  const result = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result <= 2_147_483_647 ? result : null;
}

export function planWriteError(code: string, message: string): { status: number; message: string } {
  if (code === "23505") return { status: 409, message: "Já existe um plano com esse código. Escolha outro." };
  if (message.includes("plan_not_found")) return { status: 404, message: "Plano não encontrado." };
  if (message.includes("plan_stale")) return { status: 409, message: "Este plano foi alterado em outra sessão. Recarregue antes de editar novamente." };
  if (message.includes("plan_limits_confirmation_required")) return { status: 409, message: "Confirme a aplicação dos novos limites às empresas vinculadas a este plano." };
  if (message.includes("plan_default_required")) return { status: 409, message: "O plano Essencial é usado no período de teste e não pode ser desativado neste momento." };
  if (code === "42501") return { status: 403, message: "Você não tem permissão para editar planos." };
  if (["23514", "23502", "22023", "22P02", "22003"].includes(code)) return { status: 422, message: "Confira os valores e limites informados para o plano." };
  return { status: 503, message: "Não foi possível salvar o plano. Recarregue o catálogo para conferir o estado antes de tentar novamente." };
}
