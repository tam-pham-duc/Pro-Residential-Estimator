import { JobItem } from "./types";

export function calculateJobTotal(items: JobItem[]): number {
  return items.reduce((total, item) => total + (item.qty * item.unitPrice), 0);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}
