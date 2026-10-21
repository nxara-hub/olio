import { codegen } from "@nxlab/codegen";

// Regenerated on every check-types, so the contract test always runs against
// what codegen emits today.
await codegen({
  modules: new URL("modules", import.meta.url).pathname,
  typeDefs: "*.gql",
  output: new URL("generated.ts", import.meta.url).pathname,
  logs: false
});
