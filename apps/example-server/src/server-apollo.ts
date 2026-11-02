import { createServer } from "node:http";

import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import type { Context } from "@nxara/olio";
import { errorMasker, validateOperation } from "@nxara/olio-http";
import { createServerAdapter } from "@whatwg-node/server";
import express from "express";
import { WebSocketServer } from "ws";

import { createContext } from "./context.js";
import { bearer } from "./http.js";
import { app } from "./index.js";
import { validationRules } from "./limits.js";
import { serveWebSockets, sseHandler } from "./subscriptions.js";

const mask = errorMasker();

const apollo = new ApolloServer<Context>({
  schema: app.schema,
  // Apollo sends every thrown error to the client unless told otherwise.
  includeStacktraceInErrorResponses: false,
  formatError: (formatted, error) => {
    const masked = mask.error(error);
    return masked.message === formatted.message ? formatted : masked.toJSON();
  },
  plugins: [
    {
      requestDidStart: async () => ({
        // Not `validationRules`: Apollo's are one list per server, and an
        // operation's cost depends on its variables.
        async didResolveOperation({ request }) {
          const { query, variables, operationName } = request;
          if (!query) return;
          const [error] = validateOperation(
            app.schema,
            { query, variables, operationName },
            validationRules
          );
          if (error) throw error;
        },
        willSendResponse: ({ contextValue }) => contextValue.di.dispose()
      })
    }
  ]
});
await apollo.start();

const sse = createServerAdapter(sseHandler);
const web = express();
web.use(
  "/graphql",
  (req, res, next) => {
    if (req.headers.accept?.includes("text/event-stream")) {
      return sse(req, res);
    }
    return next();
  },
  express.json(),
  expressMiddleware(apollo, {
    context: async ({ req }) => createContext(bearer(req.headers.authorization))
  })
);

export const server = createServer(web);
serveWebSockets(new WebSocketServer({ server, path: "/graphql" }));

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  console.log(`ERP GraphQL on Apollo Server: http://localhost:${port}/graphql`);
});
