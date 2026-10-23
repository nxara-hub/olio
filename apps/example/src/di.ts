import { createContainer } from "@nxlab/di";

import { ProductLoader } from "./modules/inventory/providers.js";

/**
 * The app's container. Its keys are what resolvers reach as `ctx.di.<name>`;
 * the providers those depend on (ProductStore) needn't be listed. Singletons
 * live here, and each operation gets its own scope (`ctx.di`, see
 * context.ts), disposed when the operation ends. Providers are declared next
 * to the code that uses them, such as modules/inventory/providers.ts.
 */
export const container = createContainer({ productLoader: ProductLoader });
