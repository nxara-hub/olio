import type { ProductRow } from "./modules/inventory/store.js";

export interface Topics {
  "stock:changed": ProductRow;
}

/**
 * A tiny typed in-memory pub/sub, enough for one process. Behind more than
 * one server instance, swap it for Redis or similar with the same shape.
 */
export function createPubSub<T extends object>() {
  const listeners = new Map<keyof T, Set<(payload: never) => void>>();
  return {
    publish<K extends keyof T>(topic: K, payload: T[K]): void {
      for (const listen of listeners.get(topic) ?? []) listen(payload as never);
    },
    /** Events published from now on, until the consumer stops iterating. */
    subscribe<K extends keyof T>(topic: K): AsyncIterableIterator<T[K]> {
      const queue: T[K][] = [];
      const waiting: ((result: IteratorResult<T[K], undefined>) => void)[] = [];
      const listen = (payload: T[K]): void => {
        const resolve = waiting.shift();
        if (resolve) resolve({ value: payload, done: false });
        else queue.push(payload);
      };
      const set = listeners.get(topic) ?? new Set();
      set.add(listen as (payload: never) => void);
      listeners.set(topic, set);
      return {
        next: () =>
          queue.length > 0
            ? Promise.resolve({ value: queue.shift() as T[K], done: false })
            : new Promise((resolve) => waiting.push(resolve)),
        return: () => {
          set.delete(listen as (payload: never) => void);
          for (const resolve of waiting.splice(0)) {
            resolve({ value: undefined, done: true });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
        [Symbol.asyncIterator]() {
          return this;
        }
      };
    }
  };
}

export type PubSub = ReturnType<typeof createPubSub<Topics>>;

export const pubsub: PubSub = createPubSub<Topics>();
