import { createContainer } from "@nxara/olio-di";

import { ProductLoader } from "./modules/inventory/providers.js";

// The keys are what resolvers reach as `ctx.di.<name>`. What those depend on
// (ProductStore) needn't be listed.
export const container = createContainer({ productLoader: ProductLoader });
