import { asResult, errorResult, resolveHeaders, stream } from "./transport.js";
import type {
  CallOptions,
  Client,
  ClientOptions,
  Operations,
  Result,
  SubscriptionClient,
  TypedDocument
} from "./types.js";

export type { Fetch, HeadersSource, RequestParams } from "./transport.js";
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
    const params = {
      query: document.query,
      variables,
      operationName: document.name
    };
    const response = await send(
      String(options.url),
      {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal: call.signal
      },
      params
    );
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
