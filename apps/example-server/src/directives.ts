import { copyDirective, implementsDirective } from "@nxara/olio-schema";

/** Shared by codegen and the runtime so both see the same schema. */
export const directives = [implementsDirective(), copyDirective()];
