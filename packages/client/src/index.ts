import {
  asResult,
  errorResult,
  resolveHeaders,
  stream,
  type Fetch
} from "./transport.js";
import type {
  CallOptions,
  Client,
  ClientOptions,
  Operations,
  Result,
  SubscriptionClient,
  TypedDocument
} from "./types.js";

export type { Fetch, HeadersSource } from "./transport.js";
export type {
  CallOptions,
  Client,
  ClientOptions,
  ClientScalars,
  GraphQLErrorJSON,
  Operations,
  Result,
  Scalar,
  SubscriptionClient,
  TypedDocument
} from "./types.js";

const ACCEPT = "application/graphql-response+json, application/json";

type AnyDocument = TypedDocument<unknown, unknown>;

/**
 * A typed client for the operations codegen emitted:
 * `client.mutation.login({ email, password }, { headers })`. Queries and
 * mutations go over HTTP; subscriptions through the app's graphql-ws client,
 * or its graphql-sse client for operations marked `@sse`.
 */
export function createClient<O extends Operations>(
  operations: O,
  options: ClientOptions<O>
): Client<O> {
  const send = options.fetch ?? ((target, init) => fetch(target, init));
  const subscriptionClients = options as unknown as Partial<
    Record<"ws" | "sse", SubscriptionClient>
  >;

  const request = async (
    document: AnyDocument,
    variables: unknown,
    call: CallOptions = {}
  ): Promise<Result<never>> => {
    const headers = await resolveHeaders(options.headers, call.headers);
    headers.set("accept", ACCEPT);
    headers.set("content-type", "application/json");
    const response = await send(String(options.url), {
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

  async function* subscribe(
    document: AnyDocument,
    variables: unknown,
    signal: AbortSignal | undefined
  ): AsyncGenerator<Result<never>> {
    const kind = document.transport ?? "ws";
    const client = subscriptionClients[kind];
    if (!client) {
      throw new Error(
        `${document.name} subscribes over ${kind}: pass createClient a graphql-${kind} client as \`${kind}\``
      );
    }
    const events = client.iterate({
      query: document.query,
      variables: variables as Record<string, unknown> | undefined,
      operationName: document.name
    });
    try {
      for await (const event of stream(events, signal)) yield asResult(event);
    } catch (error) {
      const result = errorResult(error);
      if (!result) throw error;
      yield result;
    }
  }

  return Object.fromEntries(
    (["query", "mutation", "subscription"] as const).map((root) => [
      root,
      Object.fromEntries(
        Object.entries(
          (operations[root] ?? {}) as Record<string, AnyDocument>
        ).map(([name, document]) => [
          name,
          (variables?: unknown, call?: CallOptions) =>
            root === "subscription"
              ? subscribe(document, variables, call?.signal)
              : request(document, variables, call)
        ])
      )
    ])
  ) as unknown as Client<O>;
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
