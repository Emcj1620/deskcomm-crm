"use client";

import { useState } from "react";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

export function CheckoutButton({ planCode, cycle, label }: { planCode: string; cycle: "monthly" | "annual"; label: string }) {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const result = await apiClient.post<{ data: { url?: string; link?: string } }>("/billing/checkout", { plan_code: planCode, billing_cycle: cycle });
      const url = result.data.url ?? result.data.link;
      if (!url) throw new Error("checkout sem link");
      window.location.assign(url);
    } catch {
      window.alert("Não foi possível abrir o checkout agora. Tente novamente em instantes.");
      setBusy(false);
    }
  }
  return <Button type="button" className="w-full" onClick={start} disabled={busy}>{busy ? "Abrindo…" : label}</Button>;
}
