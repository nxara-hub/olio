import { createClient } from "graphql-ws/client";

import {
  asResult,
  stream,
  type MaybePromise,
  type Transport
} from "./transport.js";
import type { Result } from "./types.js";

export interface WsOptions {
  /** Default: the client's `url`, with `http(s)` read as `ws(s)`. */
  url?: string | URL;
  /**
   * Sent when the socket connects, since browsers can't set headers on a
   * WebSocket. Default: `{ headers }`, the client's headers as an object.
   */
  connectionParams?:
    | Record<string, unknown>
    | (() => MaybePromise<Record<string, unknown>>);
  /** Default: the global `WebSocket`. */
  webSocket?: unknown;
}

interface CloseEvent {
  code: number;
  reason: string;
}

const isClose = (error: unknown): error is CloseEvent =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  "reason" in error;

// A server that refuses an operation closes the socket with a 4xxx code and
// a reason; that becomes an error result, as it would be over SSE.
const refused = ({ code, reason }: CloseEvent): Result<never> => ({
  data: null,
  errors: [
    {
      message: reason || `WebSocket closed (${code})`,
      extensions: { code: "WEBSOCKET_CLOSED", closeCode: code }
    }
  ]
});

/** Subscriptions over one WebSocket per client, with graphql-ws. */
export const ws: Transport<WsOptions> = {
  kind: "ws",
  connect(endpoint, options = {}) {
    const client = createClient({
      url: endpoint.url,
      webSocketImpl: options.webSocket,
      lazy: true,
      connectionParams: async () => {
        const params = options.connectionParams;
        if (params) return typeof params === "function" ? params() : params;
        return { headers: Object.fromEntries(await endpoint.headers()) };
      }
    });
    return {
      async *subscribe(document, variables, signal) {
        const events = client.iterate({
          query: document.query,
          variables: variables as Record<string, unknown> | undefined,
          operationName: document.name
        });
        try {
          for await (const event of stream(events, signal))
            yield asResult(event);
        } catch (error) {
          if (!isClose(error) || error.code < 4000 || error.code > 4999) {
            throw error;
          }
          yield refused(error);
        }
      },
      // The next subscription connects again, sending fresh connectionParams.
      reconnect: () => client.terminate(),
      close: async () => {
        await client.dispose();
      }
    };
  }
};
