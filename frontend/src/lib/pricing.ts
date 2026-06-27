// Pricing model for Errora. Prices in Toman.

export type PlanId = "free" | "team" | "business" | "enterprise";

export type Plan = {
  id: PlanId;
  monthly: number | null; // null => contact sales
  events: number | null; // monthly event quota (null => custom)
  popular?: boolean;
};

export const PLANS: Plan[] = [
  { id: "free", monthly: 0, events: 5_000 },
  { id: "team", monthly: 299_000, events: 100_000, popular: true },
  { id: "business", monthly: 990_000, events: 1_000_000 },
  { id: "enterprise", monthly: null, events: null },
];

// Annual billing: pay for 10 months, get 2 free.
export const ANNUAL_MONTHS_BILLED = 10;

export function annualPrice(monthly: number): number {
  return monthly * ANNUAL_MONTHS_BILLED;
}

// Pay-as-you-go configuration.
export const PAYG = {
  freeEvents: 5_000,
  // Toman per 1,000 events beyond the free allowance.
  pricePerThousand: 1_200,
  minEvents: 10_000,
  maxEvents: 5_000_000,
  step: 10_000,
  defaultEvents: 250_000,
};

/**
 * Estimate the monthly PAYG cost in Toman for a given event volume.
 * Pure + deterministic so it can be unit-tested.
 */
export function paygCost(events: number): number {
  const billable = Math.max(0, events - PAYG.freeEvents);
  return Math.ceil(billable / 1_000) * PAYG.pricePerThousand;
}
