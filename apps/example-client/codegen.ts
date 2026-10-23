import { codegenClient } from "@nxlab/codegen";

// A client app knows the server by the schema it publishes: the SDL file, or
// the running server itself (SCHEMA_URL=http://localhost:4000/graphql).
await codegenClient({
  schema: process.env.SCHEMA_URL ?? "../example-server/src/schema.gql",
  documents: "src/operations/*.graphql",
  output: "src/generated.ts"
});
