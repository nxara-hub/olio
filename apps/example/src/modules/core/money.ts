import type { Currency, Money } from "../../generated.js";

export const money = (cents: number, currency: Currency = "EUR"): Money => ({
  amount: cents,
  currency
});
