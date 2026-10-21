import type { Application, Role } from "./generated.js";
import type { EmployeeRow } from "./modules/auth/store.js";
import type { ProductRow } from "./modules/inventory/store.js";
import type { CustomerRow, OrderRow } from "./modules/sales/store.js";
import type { PubSub } from "./pubsub.js";

/** Who is calling, resolved from the session token. */
interface Viewer {
  id: string;
  role: Role;
  token: string;
}

interface GQLCtx {
  requestId: string;
  viewer?: Viewer;
  pubsub: PubSub;
}

/** Subscriptions live on a connection, so they also know which one. */
type SubGQLCtx = GQLCtx & { connectionId: string };

declare module "@nxlab/olio" {
  interface Olio {
    application: Application;
    ctx: GQLCtx;
    sub_ctx: SubGQLCtx;
    /** Resolvers work with stored rows; field resolvers derive the rest. */
    mappers: {
      Employee: EmployeeRow;
      Product: ProductRow;
      Customer: CustomerRow;
      SalesOrder: OrderRow;
    };
  }
}

declare module "@nxlab/codegen" {
  interface CustomScalars {
    DateTime: Date;
  }
  /** Stored lowercase; the API still says CONFIRMED / CANCELLED. */
  interface CustomEnums {
    OrderStatus: "confirmed" | "cancelled";
  }
}
