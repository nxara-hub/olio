import type { GraphQLSchema } from "graphql";
import { createHandler as createSseHandler } from "graphql-sse/lib/use/fetch";
import {
  CloseCode,
  GRAPHQL_TRANSPORT_WS_PROTOCOL,
  makeServer
} from "graphql-ws";

import { createClient } from "./index.js";
import type { MaybePromise } from "./transport.js";
import type { Client, ClientOptions, Operations } from "./types.js";

export interface TestServer {
  /** Queries and mutations: the app's fetch handler, e.g. `fetchHandler(app, { context })`. */
  http: (request: Request) => MaybePromise<Response>;
  /** For subscriptions, which run in memory over both transports: `app.schema`. */
  schema?: GraphQLSchema;
  /**
   * Context for subscriptions, from the client's headers (over WebSocket, the
   * `connectionParams.headers` the client sends).
   */
  context?: (headers: Headers) => MaybePromise<unknown>;
  /** Called once a subscription ends, as on the server: `(ctx) => ctx.di.dispose()`. */
  onOperationEnd?: (ctx: unknown) => MaybePromise<void>;
}

type Listener = ((event: never) => void) | null;

// Ends each subscription's context once: when it completes, or when its
// socket closes first.
function tracker(onOperationEnd: TestServer["onOperationEnd"]) {
  const live = new WeakMap<object, Map<string, unknown>>();
  const end = async (connection: object, id: string): Promise<void> => {
    const contexts = live.get(connection);
    const ctx = contexts?.get(id);
    if (!contexts?.delete(id)) return;
    await onOperationEnd?.(ctx);
  };
  return {
    start(connection: object, id: string, ctx: unknown): void {
      const contexts = live.get(connection) ?? new Map<string, unknown>();
      contexts.set(id, ctx);
      live.set(connection, contexts);
    },
    end,
    endAll: async (connection: object): Promise<void> => {
      const ids = [...(live.get(connection)?.keys() ?? [])];
      await Promise.all(ids.map((id) => end(connection, id)));
    }
  };
}

const paramsHeaders = (params: Readonly<Record<string, unknown>> | undefined) =>
  new Headers((params?.headers ?? {}) as Record<string, string>);

/**
 * A WebSocket connected straight to a graphql-ws server for `schema`, with
 * no network: what `testClient` hands the client's WebSocket transport.
 */
function memoryWebSocket(server: TestServer & { schema: GraphQLSchema }) {
  const operations = tracker(server.onOperationEnd);
  const graphqlWs = makeServer<Record<string, unknown> | undefined, unknown>({
    schema: server.schema,
    context: server.context
      ? async (ctx, id) => {
          const value = await server.context?.(
            paramsHeaders(ctx.connectionParams)
          );
          operations.start(ctx, id, value);
          return value as never;
        }
      : undefined,
    onComplete: (ctx, id) => operations.end(ctx, id),
    onClose: (ctx) => operations.endAll(ctx)
  });

  // Messages are delivered on a later microtask, as a network would, so
  // neither side runs inside the other's call.
  return class Socket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState: number = Socket.CONNECTING;
    readonly protocol = GRAPHQL_TRANSPORT_WS_PROTOCOL;
    onopen: Listener = null;
    onmessage: Listener = null;
    onclose: Listener = null;
    onerror: Listener = null;
    #receive: ((data: string) => Promise<void>) | undefined;
    #closed: ((code?: number, reason?: string) => Promise<void>) | undefined;

    constructor() {
      queueMicrotask(() => {
        this.#closed = graphqlWs.opened(
          {
            protocol: this.protocol,
            send: (data) => {
              if (this.readyState !== Socket.OPEN) return;
              queueMicrotask(() => this.onmessage?.({ data } as never));
            },
            close: (code, reason) => this.#finish(code, reason),
            onMessage: (receive) => {
              this.#receive = receive;
            }
          },
          {}
        );
        this.readyState = Socket.OPEN;
        this.onopen?.({} as never);
      });
    }

    send(data: string): void {
      queueMicrotask(() => {
        // What graphql-ws's own adapters do when handling a message throws.
        this.#receive?.(data).catch((error: unknown) =>
          this.#finish(
            CloseCode.InternalServerError,
            error instanceof Error ? error.message : String(error)
          )
        );
      });
    }

    close(code = 1000, reason = ""): void {
      this.#finish(code, reason);
    }

    #finish(code = 1000, reason = ""): void {
      if (this.readyState === Socket.CLOSED) return;
      this.readyState = Socket.CLOSED;
      void this.#closed?.(code, reason);
      queueMicrotask(() =>
        this.onclose?.({ code, reason, wasClean: true } as never)
      );
    }
  };
}

/**
 * The client, answered in-process, like Hono's `testClient`: queries and
 * mutations through the app's fetch handler (its context, error masking and
 * `onOperationEnd` run), subscriptions over WebSocket and server-sent events
 * against an in-memory graphql-ws / graphql-sse server for `schema`. No
 * server is started. In production, you run your own subscription server.
 */
export function testClient<O extends Operations>(
  operations: O,
  server: TestServer | TestServer["http"],
  options?: Omit<ClientOptions<O>, "url" | "fetch"> & { url?: string | URL }
): Client<O> {
  const handlers = typeof server === "function" ? { http: server } : server;
  const { schema } = handlers;
  if (operations.transports && !schema) {
    throw new Error(
      "These operations have subscriptions: pass testClient(operations, { http, schema: app.schema, context })"
    );
  }
  const subscriptions = schema ? { ...handlers, schema } : undefined;
  const sse = subscriptions
    ? createSseHandler({
        schema: subscriptions.schema,
        context: subscriptions.context
          ? async (req) =>
              (await subscriptions.context?.(req.raw.headers)) as never
          : undefined,
        onComplete: (ctx) => subscriptions.onOperationEnd?.(ctx)
      })
    : undefined;
  const given = (options ?? {}) as { url?: string | URL; ws?: object };
  return createClient(operations, {
    ...given,
    url: given.url ?? "http://localhost/graphql",
    fetch: async (url: string, init: RequestInit) => {
      const request = new Request(url, init);
      const streams = request.headers
        .get("accept")
        ?.includes("text/event-stream");
      return sse && streams ? sse(request) : handlers.http(request);
    },
    ...(subscriptions
      ? { ws: { ...given.ws, webSocket: memoryWebSocket(subscriptions) } }
      : {})
  } as unknown as ClientOptions<O>);
}
