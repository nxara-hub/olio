import { createModule } from "./olio.js";
import type {
  Middleware,
  ModuleConfig,
  ModuleId,
  ModuleMiddleware,
  ModuleTypeName,
  MutationResolvers,
  OlioModule,
  QueryResolvers,
  SubscriptionResolvers,
  TypeResolvers
} from "./types.js";

/**
 * `builder.<id>`: module ids exist only in the generated types, so each
 * builder is a Proxy that makes its member from whichever key is read.
 */
function perModule<T>(make: (id: string) => T): Record<string, T> {
  return new Proxy({} as Record<string, T>, {
    get: (_target, id) => make(String(id))
  });
}

/** Typed builders are identity at runtime; the types carry the safety. */
const identity = <T>(value: T): T => value;

export const module = perModule(
  (id) => (config: ModuleConfig<ModuleId>) => createModule(id, config)
) as { [M in ModuleId]: (config: ModuleConfig<M>) => OlioModule };

/** `mw({...})` is application middleware; `mw.<id>({...})` is a module's. */
export const mw = new Proxy(identity, { get: () => identity }) as unknown as ((
  middleware: Middleware
) => Middleware) & {
  [M in ModuleId]: (middleware: ModuleMiddleware<M>) => ModuleMiddleware<M>;
};

export const query = perModule(() => identity) as {
  [M in ModuleId]: (resolvers: QueryResolvers<M>) => QueryResolvers<M>;
};

export const mutation = perModule(() => identity) as {
  [M in ModuleId]: (resolvers: MutationResolvers<M>) => MutationResolvers<M>;
};

export const subscription = perModule(() => identity) as {
  [M in ModuleId]: (
    resolvers: SubscriptionResolvers<M>
  ) => SubscriptionResolvers<M>;
};

export const resolvers = perModule(() => perModule(() => identity)) as {
  [M in ModuleId]: {
    [T in ModuleTypeName<M>]: (
      resolvers: TypeResolvers<M, T>
    ) => TypeResolvers<M, T>;
  };
};
