import { codegen, codegenClient } from "@nxlab/codegen";

import { directives } from "./src/directives.js";

await codegen({
  root: import.meta.dirname,
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts",
  schema: "src/schema.gql",
  directives,
  clear: true
});

// test/api.test.ts calls the server through @nxlab/client, like a client app.
await codegenClient({
  root: import.meta.dirname,
  schema: "src/schema.gql",
  documents: "test/**/*.graphql",
  output: "test/generated.ts"
});
