import type { Context } from "@nxlab/core";
import { createHandler } from "graphql-http/lib/use/fetch";

import {
  contextFailure,
  masking,
  operationEnd,
  handlerRules,
  type ErrorInfo,
  type HttpOptions,
  type OptionsArgs,
  type Servable
} from "./core.js";

/** GraphQL over HTTP for anything that speaks the Fetch API. */
export function fetchHandler(
  app: Servable,
  ...[options = {} as HttpOptions<Request>]: OptionsArgs<Request>
): (request: Request) => Promise<Response> {
  const mask = masking<ErrorInfo<Request>>(options);
  const { context } = options;
  const end = operationEnd(mask, options.onOperationEnd);
  // Kept per request, so `onOperationEnd` can run after the response.
  const contexts = new WeakMap<Request, Context>();
  const http = createHandler({
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
  return async (request) => {
    const response = await http(request);
    await end(contexts.get(request), request);
    return response;
  };
}
