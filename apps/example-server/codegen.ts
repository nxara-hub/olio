import { codegen, codegenClient } from "@nxara/olio-codegen";

import { directives } from "./src/directives.js";

await codegen({
  root: import.meta.dirname,
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts",
  schemaOutput: "src/schema.gql",
  // Each module's SDL as TypeScript, so a tsc build needs no .gql files.
  typeDefsOutput: "typedefs.generated.ts",
  directives,
  clear: true
});

// test/api.test.ts calls the server through @nxara/olio-client, like a client app.
await codegenClient({
  root: import.meta.dirname,
  schema: "src/schema.gql",
  documents: "test/**/*.graphql",
  output: "test/generated.ts"
});
