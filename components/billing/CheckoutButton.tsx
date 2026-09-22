"use client";

import { useState } from "react";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

export function CheckoutButton({ planCode, cycle, label }: { planCode: string; cycle: "monthly" | "annual"; label: string }) {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const result = await apiClient.post<{ data: { url?: string; link?: string } }>("/api/v1/billing/checkout", { plan_code: planCode, billing_cycle: cycle });
      const url = result.data.url ?? result.data.link;
      if (!url) throw new Error("checkout sem link");
      window.location.assign(url);
    } catch (error) {
      const message = error instanceof Error && error.message && !/[<>]/.test(error.message) && error.message.length <= 300
        ? error.message
        : "Não foi possível abrir o checkout agora. Tente novamente em instantes.";
      setBusy(false);
      window.alert(message);
    }
  }
  return <Button type="button" className="h-auto min-h-10 w-full min-w-0 whitespace-normal px-3 py-2 text-center text-xs leading-tight sm:text-sm" onClick={start} disabled={busy}>{busy ? "Abrindo…" : label}</Button>;
}
