import type { ScopeOf } from "@nxlab/di";

import type { container } from "./di.js";
import type { Application, Role } from "./generated.js";
import type { EmployeeRow } from "./modules/auth/store.js";
import type { ProductRow } from "./modules/inventory/store.js";
import type {
  CustomerRow,
  OrderLineRow,
  OrderRow
} from "./modules/sales/store.js";
import type { PubSub } from "./pubsub.js";

interface Viewer {
  id: string;
  role: Role;
  token: string;
}

/** What a request carries; providers (see src/di.ts) see this. */
interface RequestInfo {
  requestId: string;
  viewer?: Viewer;
  pubsub: PubSub;
}

interface GQLCtx extends RequestInfo {
  /** Named in src/di.ts. */
  di: ScopeOf<typeof container>;
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
      OrderLine: OrderLineRow;
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

declare module "@nxlab/di" {
  interface Register {
    ctx: RequestInfo;
  }
}
