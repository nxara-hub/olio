import { createFeature, createModule } from "./olio.js";
import type {
  FeatureConfig,
  FeatureId,
  FeatureMiddleware,
  LooseMap,
  Middleware,
  ModuleConfig,
  ModuleId,
  ModuleMiddleware,
  ModuleTypeName,
  MutationResolvers,
  OlioFeature,
  OlioModule,
  OwnerResolvers,
  QueryResolvers,
  RootName,
  StrictFields,
  StrictMap,
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

// One type's fields, checked against what its owner declares.
type FieldsBuilder<O extends string, T extends string, S> = <R>(
  value: StrictFields<O, T, S, R>
) => S;

// A map of types, as a module's `middleware` takes.
type MapBuilder<O extends string, S> = <const R extends LooseMap<S>>(
  value: R & StrictMap<O, S, R>
) => S;

type ConfigBuilder<O extends string, Config, Resolvers, Mw, Built> = <
  const R extends LooseMap<Resolvers>,
  const W extends LooseMap<Mw>
>(
  config: Omit<Config, "resolvers" | "middleware"> & {
    resolvers?: R & StrictMap<O, Resolvers, R>;
    middleware?: W & StrictMap<O, Mw, W>;
  }
) => Built;

export const module = perModule(
  (id) => (config: ModuleConfig<ModuleId>) =>
    createModule(id as ModuleId, config)
) as {
  [M in ModuleId]: ConfigBuilder<
    M,
    ModuleConfig<M>,
    OwnerResolvers<M>,
    ModuleMiddleware<M>,
    OlioModule
  >;
};

export const feature = perModule((m) =>
  perModule(
    (f) => (config: FeatureConfig<ModuleId, string>) =>
      createFeature(m as ModuleId, f, config)
  )
) as {
  [M in ModuleId]: {
    [F in FeatureId<M>]: ConfigBuilder<
      `${M}/${F}`,
      FeatureConfig<M, F>,
      OwnerResolvers<`${M}/${F}`>,
      FeatureMiddleware<M, F>,
      OlioFeature
    >;
  };
};

export const mw = new Proxy(identity, {
  get: () => nested
}) as unknown as Builder<Middleware> & {
  [M in ModuleId]: MapBuilder<M, ModuleMiddleware<M>> & {
    [F in FeatureId<M>]: MapBuilder<`${M}/${F}`, FeatureMiddleware<M, F>>;
  };
};

export const query = perModule(() => nested) as unknown as {
  [M in ModuleId]: FieldsBuilder<M, RootName<"query">, QueryResolvers<M>> & {
    [F in FeatureId<M>]: FieldsBuilder<
      `${M}/${F}`,
      RootName<"query">,
      QueryResolvers<`${M}/${F}`>
    >;
  };
};

export const mutation = perModule(() => nested) as unknown as {
  [M in ModuleId]: FieldsBuilder<
    M,
    RootName<"mutation">,
    MutationResolvers<M>
  > & {
    [F in FeatureId<M>]: FieldsBuilder<
      `${M}/${F}`,
      RootName<"mutation">,
      MutationResolvers<`${M}/${F}`>
    >;
  };
};

export const subscription = perModule(() => nested) as unknown as {
  [M in ModuleId]: FieldsBuilder<
    M,
    RootName<"subscription">,
    SubscriptionResolvers<M>
  > & {
    [F in FeatureId<M>]: FieldsBuilder<
      `${M}/${F}`,
      RootName<"subscription">,
      SubscriptionResolvers<`${M}/${F}`>
    >;
  };
};

type TypeBuilders<O extends string> = {
  [T in ModuleTypeName<O>]: FieldsBuilder<O, T, TypeResolvers<O, T>>;
};

export const resolvers = perModule(() =>
  perModule(() => nested)
) as unknown as {
  [M in ModuleId]: TypeBuilders<M> & {
    [F in FeatureId<M>]: TypeBuilders<`${M}/${F}`>;
  };
};
