import { createClient, type Client, type ClientOptions } from "graphql-sse";

import {
  asResult,
  stream,
  type Fetch,
  type HeadersSource,
  type Transport
} from "./transport.js";

/** graphql-sse's client options (`retryAttempts`, `retry`, `credentials`...), plus: */
export interface SseOptions extends Omit<
  ClientOptions<boolean>,
  "url" | "headers" | "fetchFn"
> {
  /** Default: the client's `url`. */
  url?: string | URL;
  headers?: HeadersSource;
  /** Must stream the response body (fetch, ky; not axios). */
  fetch?: Fetch;
}

/** Subscriptions as server-sent events, over graphql-sse. */
export const sse: Transport<SseOptions> = {
  kind: "sse",
  connect(endpoint, options = {}) {
    let client: Client<boolean> | undefined;
    return {
      async *subscribe(document, variables, signal) {
        client ??= createClient({
          ...options,
          url: endpoint.url,
          fetchFn: endpoint.fetch,
          headers: async () => Object.fromEntries(await endpoint.headers())
        });
        const events = client.iterate({
          query: document.query,
          variables: variables as Record<string, unknown> | undefined,
          operationName: document.name
        });
        for await (const event of stream(events, signal)) yield asResult(event);
      },
      // Each subscription is its own request, so it reads the headers anew.
      reconnect() {},
      close: async () => {
        client?.dispose();
        client = undefined;
      }
    };
  }
};
