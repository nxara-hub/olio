import { codegenClient } from "@nxlab/codegen";

// Regenerated on every check-types, so the tests always run against what
// codegen emits today.
await codegenClient({
  schema: new URL("schema.gql", import.meta.url).pathname,
  documents: new URL("*.graphql", import.meta.url).pathname,
  output: new URL("generated.ts", import.meta.url).pathname,
  logs: false
});
