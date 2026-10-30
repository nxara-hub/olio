import type { ServerOptions } from "graphql-ws";

import { createClient } from "./index.js";
import {
  resolveHeaders,
  type HeadersSource,
  type MaybePromise
} from "./transport.js";
import type { Client, ClientOptions, Operations, Transports } from "./types.js";

type Handler = (request: Request) => MaybePromise<Response>;

// Optional peer dependencies: an app needs only the ones it subscribes over.
const graphqlWs = await import("graphql-ws").catch(() => undefined);
const graphqlSse = await import("graphql-sse").catch(() => undefined);

const installed = <M>(module: M | undefined, name: string): M => {
  if (!module) {
    throw new Error(
      `testClient: install ${name} to test subscriptions over it`
    );
  }
  return module;
};

/**
 * The app's own servers, so tests run its production wiring: context,
 * `onConnect`, `onSubscribe`, error masking, cleanup.
 */
export type TestServer<O extends Operations = Operations> = {
  /** Queries and mutations: the app's fetch handler, e.g. `fetchHandler(app, { context })`. */
  http: Handler;
} & {
  readonly [K in Transports<O>]: K extends "ws"
    ? /**
       * The graphql-ws options the app passes to `useServer` / `makeHandler`,
       * run in memory (`ctx.extra` is empty there).
       */
      ServerOptions<never, never>
    : /** The app's graphql-sse handler for the Fetch API (`graphql-sse/lib/use/fetch`). */
      Handler;
};

type Listener = ((event: never) => void) | null;

/**
 * A WebSocket connected straight to a graphql-ws server for `options`, with
 * no network: what `testClient`'s graphql-ws client connects through.
 */
function memoryWebSocket(
  ws: typeof import("graphql-ws"),
  options: ServerOptions<never, never>
) {
  const graphqlWs = ws.makeServer(options);

  // Messages are delivered on a later microtask, as a network would, so
  // neither side runs inside the other's call.
  return class Socket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState: number = Socket.CONNECTING;
    readonly protocol = ws.GRAPHQL_TRANSPORT_WS_PROTOCOL;
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
          // No socket or request in memory: `ctx.extra` is empty.
          {} as never
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
            ws.CloseCode.InternalServerError,
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
 * mutations through the app's fetch handler, subscriptions through the app's
 * own graphql-ws options (run over an in-memory socket) and graphql-sse
 * handler. No server is started. Its clients never retry: in memory, a
 * failure is final.
 */
export function testClient<O extends Operations>(
  operations: O,
  server: TestServer<O> | ([Transports<O>] extends [never] ? Handler : never),
  options: { url?: string | URL; headers?: HeadersSource } = {}
): Client<O> {
  const handlers = (
    typeof server === "function" ? { http: server } : server
  ) as { http: Handler; ws?: ServerOptions<never, never>; sse?: Handler };
  for (const kind of operations.transports ?? []) {
    if (!handlers[kind]) {
      throw new Error(
        `These operations subscribe over ${kind}: pass testClient(operations, { http, ${kind} }) the app's own ${kind === "ws" ? "graphql-ws server options" : "graphql-sse handler"}`
      );
    }
  }
  const url = String(options.url ?? "http://localhost/graphql");
  const headers = async (): Promise<Record<string, string>> =>
    Object.fromEntries(await resolveHeaders(options.headers));
  const fetch = async (
    target: string,
    init: RequestInit
  ): Promise<Response> => {
    const request = new Request(target, init);
    const streams = request.headers
      .get("accept")
      ?.includes("text/event-stream");
    return handlers.sse && streams
      ? handlers.sse(request)
      : handlers.http(request);
  };
  const ws = handlers.ws && installed(graphqlWs, "graphql-ws");
  const sse = handlers.sse && installed(graphqlSse, "graphql-sse");
  return createClient(operations, {
    url,
    headers: options.headers,
    fetch,
    ws:
      ws &&
      handlers.ws &&
      ws.createClient({
        url: url.replace(/^http/, "ws"),
        webSocketImpl: memoryWebSocket(ws, handlers.ws),
        retryAttempts: 0,
        connectionParams: async () => ({ headers: await headers() })
      }),
    sse:
      sse &&
      sse.createClient({ url, fetchFn: fetch, headers, retryAttempts: 0 })
  } as unknown as ClientOptions<O>);
}
