import { codegen } from "@nxlab/codegen";
import { copyDirective } from "@nxlab/schema";

// Regenerated on every check-types, so the contract test always runs against
// what codegen emits today.
await codegen({
  modules: new URL("modules", import.meta.url).pathname,
  typeDefs: "*.gql",
  output: new URL("generated.ts", import.meta.url).pathname,
  directives: [copyDirective()],
  logs: false
});
