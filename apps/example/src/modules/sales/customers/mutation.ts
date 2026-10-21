import { mutation } from "@nxlab/olio";

import { customers } from "../store.js";

export const Mutation = mutation.sales.customers({
  createCustomer: (_root, { input }) => {
    const now = new Date();
    const row = {
      id: `c${customers.size + 1}`,
      name: input.name,
      email: input.email,
      creditLimitCents: input.creditLimit,
      createdAt: now,
      updatedAt: now
    };
    customers.set(row.id, row);
    return row;
  }
});
