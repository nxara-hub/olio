import {
  asResult,
  resolveHeaders,
  type Endpoint,
  type Fetch,
  type Subscriber,
  type Transport
} from "./transport.js";
import type {
  CallOptions,
  Client,
  ClientOptions,
  Operations,
  Result,
  TypedDocument
} from "./types.js";

export type { Fetch, HeadersSource, Transport } from "./transport.js";
export type {
  CallOptions,
  Client,
  ClientOptions,
  ClientScalars,
  GraphQLErrorJSON,
  Operations,
  Result,
  Scalar,
  TypedDocument
} from "./types.js";

const ACCEPT = "application/graphql-response+json, application/json";

type Kind = "ws" | "sse";
type AnyDocument = TypedDocument<unknown, unknown>;
interface Section {
  url?: string | URL;
  headers?: Parameters<typeof resolveHeaders>[0];
  fetch?: Fetch;
}

/**
 * A typed client for the operations codegen emitted:
 * `client.mutation.login({ email, password }, { headers })`. Queries and
 * mutations go over HTTP; subscriptions over WebSocket, or server-sent events
 * for operations marked `@sse`.
 */
export function createClient<O extends Operations>(
  operations: O,
  options: ClientOptions<O>
): Client<O> {
  const sections = options as unknown as Partial<
    Record<Kind | "http", Section>
  >;
  const endpoint = (section: Section = {}, url?: string): Endpoint => ({
    url: String(section.url ?? url ?? options.url),
    fetch:
      section.fetch ?? options.fetch ?? ((target, init) => fetch(target, init)),
    headers: (extra) => resolveHeaders(options.headers, section.headers, extra)
  });
  const http = endpoint(sections.http);

  const request = async (
    document: AnyDocument,
    variables: unknown,
    call: CallOptions = {}
  ): Promise<Result<never>> => {
    const headers = await http.headers(call.headers);
    headers.set("accept", ACCEPT);
    headers.set("content-type", "application/json");
    const response = await http.fetch(http.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: document.query,
        variables,
        operationName: document.name
      }),
      signal: call.signal
    });
    if (!response.headers.get("content-type")?.includes("json")) {
      throw new Error(
        `${document.name}: HTTP ${response.status} ${response.statusText}`.trim()
      );
    }
    return asResult((await response.json()) as never);
  };

  // Connected on first use, so a transport costs nothing until a
  // subscription needs it.
  const subscribers = new Map<Kind, Subscriber>();
  const subscriber = (document: AnyDocument): Subscriber => {
    const kind = document.transport ?? "ws";
    const connected = subscribers.get(kind);
    if (connected) return connected;
    const transport = operations.transports?.[kind] as
      | Transport<unknown>
      | undefined;
    if (!transport) {
      throw new Error(
        `${document.name} subscribes over ${kind}, but the operations don't include that transport; rerun codegen`
      );
    }
    const wsUrl =
      kind === "ws" ? String(options.url).replace(/^http/, "ws") : undefined;
    const created = transport.connect(
      endpoint(sections[kind], wsUrl),
      sections[kind]
    );
    subscribers.set(kind, created);
    return created;
  };

  const calls = Object.fromEntries(
    (["query", "mutation", "subscription"] as const).map((root) => [
      root,
      Object.fromEntries(
        Object.entries(
          (operations[root] ?? {}) as Record<string, AnyDocument>
        ).map(([name, document]) => [
          name,
          (variables?: unknown, call?: CallOptions) =>
            root === "subscription"
              ? subscriber(document).subscribe(
                  document,
                  variables,
                  call?.signal
                )
              : request(document, variables, call)
        ])
      )
    ])
  );
  return {
    ...calls,
    reconnect: () => {
      for (const connected of subscribers.values()) connected.reconnect();
    },
    close: async () => {
      await Promise.all([...subscribers.values()].map((s) => s.close()));
      subscribers.clear();
    }
  } as unknown as Client<O>;
}

/** The part of axios `fromAxios` uses. */
interface Axios {
  request(config: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: unknown;
    signal?: AbortSignal;
    responseType: "text";
    validateStatus: () => boolean;
  }): Promise<{
    status: number;
    statusText?: string;
    data: unknown;
    headers: Record<string, unknown>;
  }>;
}

/** Use an axios instance as the client's `fetch` (not for SSE: axios can't stream). */
export function fromAxios(axios: Axios): Fetch {
  return async (url, init) => {
    const response = await axios.request({
      url,
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers)),
      data: init.body,
      signal: init.signal ?? undefined,
      responseType: "text",
      // GraphQL errors come with 4xx/5xx statuses too; the client reads them.
      validateStatus: () => true
    });
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    return new Response(String(response.data), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  };
}
