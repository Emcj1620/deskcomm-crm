"use client";

import { NativeCheckout } from "./NativeCheckout";

export function CheckoutButton({ planCode, cycle, label }: { planCode: string; cycle: "monthly" | "annual"; label: string }) {
  return <NativeCheckout planCode={planCode} cycle={cycle} label={label} />;
}
