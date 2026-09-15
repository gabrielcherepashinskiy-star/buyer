// Money helpers. We store everything as integer cents.

export function toCents(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  const n = typeof input === "number" ? input : parseFloat(String(input).replace(/[^0-9.\-]/g, ""));
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return (cents || 0) / 100;
}

export function formatUSD(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(fromCents(cents));
}

/** Margin as a percentage of the selling price. */
export function marginPct(costCents: number, priceCents: number): number {
  if (!priceCents) return 0;
  return ((priceCents - costCents) / priceCents) * 100;
}

/** Markup as a percentage of cost. */
export function markupPct(costCents: number, priceCents: number): number {
  if (!costCents) return 0;
  return ((priceCents - costCents) / costCents) * 100;
}
