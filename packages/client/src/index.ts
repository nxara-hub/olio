import {
  createClient as createSseClient,
  type Client as SseClient
} from "graphql-sse";

import type {
  CallOptions,
  Client,
  GraphQLErrorJSON,
  HeadersInit,
  Operations,
  Result,
  TypedDocument
} from "./types.js";

export type {
  CallOptions,
  Client,
  ClientScalars,
  GraphQLErrorJSON,
  Operations,
  Result,
  Scalar,
  TypedDocument
} from "./types.js";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type MaybePromise<T> = T | Promise<T>;

export interface ClientOptions {
  url: string | URL;
  /** Sent with every request; a function for values that change, such as a token. */
  headers?: HeadersInit | (() => MaybePromise<HeadersInit>);
  /**
   * Default: the global `fetch`. Anything fetch-shaped works, such as a ky
   * instance; `fromAxios(axios)` adapts axios. Subscriptions need one that
   * streams the response (fetch, ky), which axios can't.
   */
  fetch?: Fetch;
}

const ACCEPT = "application/graphql-response+json, application/json";

const asResult = (body: {
  data?: unknown;
  errors?: readonly GraphQLErrorJSON[];
}): Result<never> => ({
  data: (body.data ?? null) as never,
  ...(body.errors ? { errors: body.errors } : {})
});

/**
 * A typed client for the operations codegen emitted:
 * `client.mutation.login({ email, password }, { headers })`.
 */
export function createClient<O extends Operations>(
  operations: O,
  options: ClientOptions
): Client<O> {
  const fetchFn: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const url = String(options.url);
  const headers = async (extra?: HeadersInit): Promise<Headers> => {
    const base =
      typeof options.headers === "function"
        ? await options.headers()
        : options.headers;
    const merged = new Headers(base);
    for (const [key, value] of new Headers(extra)) merged.set(key, value);
    return merged;
  };

  let sse: SseClient | undefined;
  async function* subscribe(
    document: TypedDocument<unknown, unknown>,
    variables: unknown,
    call: Pick<CallOptions, "signal"> = {}
  ): AsyncGenerator<Result<never>> {
    sse ??= createSseClient({
      url,
      fetchFn,
      headers: async () => Object.fromEntries(await headers())
    });
    const events = sse.iterate({
      query: document.query,
      variables: variables as Record<string, unknown> | undefined,
      operationName: document.name
    });
    const stop = (): void => void events.return?.();
    call.signal?.addEventListener("abort", stop, { once: true });
    try {
      for await (const event of events) yield asResult(event);
    } finally {
      call.signal?.removeEventListener("abort", stop);
    }
  }

  const request = async (
    document: TypedDocument<unknown, unknown>,
    variables: unknown,
    call: CallOptions = {}
  ): Promise<Result<never>> => {
    const request = await headers(call.headers);
    request.set("accept", ACCEPT);
    request.set("content-type", "application/json");
    const response = await fetchFn(url, {
      method: "POST",
      headers: request,
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

  return Object.fromEntries(
    Object.entries(operations).map(([root, documents]) => [
      root,
      Object.fromEntries(
        Object.entries(
          documents as Record<string, TypedDocument<unknown, unknown>>
        ).map(([name, document]) => [
          name,
          (variables?: unknown, call?: CallOptions) =>
            document.operation === "subscription"
              ? subscribe(document, variables, call)
              : request(document, variables, call)
        ])
      )
    ])
  ) as unknown as Client<O>;
}

/**
 * The same client, answered in-process by a fetch handler (`fetchHandler`
 * from `@nxlab/http/fetch`): context, error masking and `onOperationEnd` all
 * run, and no server is started.
 */
export function testClient<O extends Operations>(
  operations: O,
  handler: (request: Request) => MaybePromise<Response>,
  options: Omit<ClientOptions, "url" | "fetch"> & { url?: string | URL } = {}
): Client<O> {
  return createClient(operations, {
    ...options,
    url: options.url ?? "http://localhost/graphql",
    fetch: async (url, init) => handler(new Request(url, init))
  });
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

/** Use an axios instance as the client's `fetch` (not for subscriptions). */
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
