import { createFeature, createModule } from "./olio.js";
import type {
  FeatureConfig,
  FeatureId,
  FeatureMiddleware,
  Middleware,
  ModuleConfig,
  ModuleId,
  ModuleMiddleware,
  ModuleTypeName,
  MutationResolvers,
  OlioFeature,
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

// Identity at runtime; the types carry the safety.
const identity = <T>(value: T): T => value;

// `query.sales(...)` and `query.sales.orders(...)` alike.
const nested = new Proxy(identity, { get: () => identity });

type Builder<T> = (value: T) => T;

export const module = perModule(
  (id) => (config: ModuleConfig<ModuleId>) =>
    createModule(id as ModuleId, config)
) as {
  [M in ModuleId]: (config: ModuleConfig<M>) => OlioModule;
};

export const feature = perModule((m) =>
  perModule(
    (f) => (config: FeatureConfig<ModuleId, string>) =>
      createFeature(m as ModuleId, f, config)
  )
) as {
  [M in ModuleId]: {
    [F in FeatureId<M>]: (config: FeatureConfig<M, F>) => OlioFeature;
  };
};

export const mw = new Proxy(identity, {
  get: () => nested
}) as unknown as Builder<Middleware> & {
  [M in ModuleId]: Builder<ModuleMiddleware<M>> & {
    [F in FeatureId<M>]: Builder<FeatureMiddleware<M, F>>;
  };
};

export const query = perModule(() => nested) as unknown as {
  [M in ModuleId]: Builder<QueryResolvers<M>> & {
    [F in FeatureId<M>]: Builder<QueryResolvers<`${M}/${F}`>>;
  };
};

export const mutation = perModule(() => nested) as unknown as {
  [M in ModuleId]: Builder<MutationResolvers<M>> & {
    [F in FeatureId<M>]: Builder<MutationResolvers<`${M}/${F}`>>;
  };
};

export const subscription = perModule(() => nested) as unknown as {
  [M in ModuleId]: Builder<SubscriptionResolvers<M>> & {
    [F in FeatureId<M>]: Builder<SubscriptionResolvers<`${M}/${F}`>>;
  };
};

type TypeBuilders<O extends string> = {
  [T in ModuleTypeName<O>]: Builder<TypeResolvers<O, T>>;
};

export const resolvers = perModule(() =>
  perModule(() => nested)
) as unknown as {
  [M in ModuleId]: TypeBuilders<M> & {
    [F in FeatureId<M>]: TypeBuilders<`${M}/${F}`>;
  };
};
