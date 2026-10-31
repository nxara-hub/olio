import type { IncomingMessage, ServerResponse } from "node:http";

import type { Context } from "@nxara/olio-core";
import { createHandler, type OperationContext } from "graphql-http";
import type { HandlerOptions, RequestContext } from "graphql-http/lib/use/http";

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

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

/**
 * GraphQL over HTTP for Node. Koa: pass `ctx.req`/`ctx.res`; Fastify:
 * `request.raw`/`reply.raw`. When a framework has already parsed the body,
 * it's taken from `req.body` (Express, Connect) or the third argument
 * (Fastify's `request.body`, Koa's `ctx.request.body`).
 */
export function nodeHandler(
  app: Servable,
  ...[options = {} as HttpOptions<IncomingMessage, Passed>]: OptionsArgs<
    IncomingMessage,
    Passed
  >
): (
  req: IncomingMessage,
  res: ServerResponse,
  body?: unknown
) => Promise<void> {
  const mask = masking<ErrorInfo<IncomingMessage>>(options);
  const { context } = options;
  const end = operationEnd(mask, options.onOperationEnd);
  // Kept per request, so `onOperationEnd` can run after the response.
  const contexts = new WeakMap<IncomingMessage, Context>();
  const http = createHandler<IncomingMessage, RequestContext, OperationContext>(
    {
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
    }
  );
  return async (req, res, body) => {
    // Express passes `next` third.
    const parsed =
      typeof body === "function"
        ? (req as { body?: unknown }).body
        : (body ?? (req as { body?: unknown }).body);
    if (parsed === undefined && req.readableEnded) {
      mask.report(
        new Error(
          "nodeHandler: the request body was already read, by a body parser? Pass the parsed body as the third argument: graphql(req, res, body)."
        ),
        { ctx: undefined, request: req }
      );
      res.writeHead(500).end();
      return;
    }
    const [payload, init] = await http({
      url: req.url ?? "/",
      method: req.method ?? "GET",
      headers: req.headers,
      body: parsed === undefined ? () => readBody(req) : (parsed as never),
      raw: req,
      context: { res }
    });
    res.writeHead(init.status, init.statusText, init.headers).end(payload);
    await end(contexts.get(req), req);
  };
}
