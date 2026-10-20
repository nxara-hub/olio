import { copyDirective, implementsDirective } from "@nxlab/schema";

/** Shared by codegen and the runtime so both see the same schema. */
export const directives = [implementsDirective(), copyDirective()];
