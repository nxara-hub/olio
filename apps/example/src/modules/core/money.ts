import type { Currency, Money } from "../../generated.js";

/** Money from minor units (cents). */
export const money = (amount: number, currency: Currency = "EUR"): Money => ({
  amount,
  currency
});
