import { codegen } from "@nxlab/codegen";

import { directives } from "./src/directives.js";

await codegen({
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts",
  schema: "src/schema.gql",
  directives,
  clear: true
});
