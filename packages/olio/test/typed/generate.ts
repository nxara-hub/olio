import { codegen } from "@nxara/olio-codegen";
import { copyDirective } from "@nxara/olio-schema";

// Regenerated on every check-types, so the contract test always runs against
// what codegen emits today.
await codegen({
  root: import.meta.dirname,
  modules: "modules",
  typeDefs: "*.gql",
  output: "generated.ts",
  directives: [copyDirective()],
  logs: false
});
