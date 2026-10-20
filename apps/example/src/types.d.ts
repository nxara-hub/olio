import type { Application } from "./generated.js";
import type { UserRow } from "./modules/users/store.js";

type GQLCtx = {
  req_id: string;
  userId?: string;
};

type SubGQLCtx = {
  pubsub: unknown;
};

declare module "@nxlab/olio" {
  interface Olio {
    ctx: GQLCtx;
    sub_ctx: SubGQLCtx;
    application: Application;
    mappers: { User: UserRow };
  }
}

declare module "@nxlab/codegen" {
  interface CustomScalars {
    Upload: File;
  }
}
