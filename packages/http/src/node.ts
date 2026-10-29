import type { IncomingMessage, ServerResponse } from "node:http";

import type { Context } from "@nxara/olio-core";
import type { OperationContext } from "graphql-http";
import { createHandler, type HandlerOptions } from "graphql-http/lib/use/http";

import {
  contextFailure,
  masking,
  operationEnd,
  handlerRules,
  type ErrorInfo,
  type GraphQLHttpOptions,
  type HttpOptions,
  type OptionsArgs,
  type Servable
} from "./core.js";

type Passed = GraphQLHttpOptions<HandlerOptions<OperationContext>>;

/** GraphQL over HTTP for Node. Koa: pass `ctx.req`/`ctx.res`; Fastify: `request.raw`/`reply.raw`. */
export function nodeHandler(
  app: Servable,
  ...[options = {} as HttpOptions<IncomingMessage, Passed>]: OptionsArgs<
    IncomingMessage,
    Passed
  >
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const mask = masking<ErrorInfo<IncomingMessage>>(options);
  const { context } = options;
  const end = operationEnd(mask, options.onOperationEnd);
  // Kept per request, so `onOperationEnd` can run after the response.
  const contexts = new WeakMap<IncomingMessage, Context>();
  const http = createHandler({
    ...options,
    schema: app.schema,
    context: context
      ? async (req) => {
          try {
            const ctx = await context(req.raw);
            contexts.set(req.raw, ctx);
            return ctx as never;
          } catch (error) {
            return contextFailure(mask, error, req.raw);
          }
        }
      : undefined,
    validationRules: handlerRules(options.validationRules),
    onOperation: (req, _args, result) =>
      mask.result(result, { ctx: contexts.get(req.raw), request: req.raw })
  });
  return async (req, res) => {
    await http(req, res);
    await end(contexts.get(req), req);
  };
}
