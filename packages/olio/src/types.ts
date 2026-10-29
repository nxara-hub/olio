import type {
  Context,
  LoadedEnums,
  LoadedResolvers,
  Olio,
  OlioFeature,
  OlioModule,
  ResolverMap,
  TypeSource
} from "@nxara/olio-core";
import type {
  GraphQLFieldExtensions,
  GraphQLResolveInfo,
  GraphQLScalarType
} from "graphql";

type MaybePromise<T> = T | Promise<T>;

// Codegen's emit-application.ts writes this shape; change both together.
// Roots are marked by operation, never found by name, so custom root names work.
interface TypeShape {
  type: unknown;
  fields: string;
  args?: object;
  resolveType?: string;
  root?: Operation;
  enum?: string;
  scalar?: true;
}

type Operation = "query" | "mutation" | "subscription";

type ApplicationShape = Record<string, Record<string, TypeShape>>;

type Registered<Key extends string, Fallback> =
  Olio extends Record<Key, infer T> ? T : Fallback;

type Registration = Registered<"application", ApplicationShape>;

type App =
  Omit<Registration, "~directives"> extends infer A extends ApplicationShape
    ? A
    : ApplicationShape;

/** The schema directives codegen composed with; `olio()` needs the same. */
export type DirectiveName = Registration extends {
  "~directives": infer D extends string;
}
  ? D
  : never;

type Owner = keyof App & string;

export type ModuleId = Exclude<Owner, `${string}/${string}`>;

/** A module's features, one per feature folder: `FeatureId<"sales">` → `"customers" | "orders"`. */
export type FeatureId<M extends ModuleId> = Untyped extends true
  ? string
  : Owner extends infer O
    ? O extends `${M}/${infer F}`
      ? F
      : never
    : never;

type ModuleOwners<M extends ModuleId> = M | `${M}/${FeatureId<M>}`;
export type SubscriptionContext = Registered<"sub_ctx", Context>;

type Untyped = string extends ModuleId ? true : false;

interface DefaultRoots {
  query: "Query";
  mutation: "Mutation";
  subscription: "Subscription";
}

type RootName<Op extends Operation> = Untyped extends true
  ? DefaultRoots[Op]
  : {
      [O in Owner]: {
        [T in keyof App[O]]: App[O][T] extends { root: Op } ? T : never;
      }[keyof App[O]];
    }[Owner] &
      string;

type RootType = RootName<Operation>;
type TypeHook = "__isTypeOf" | "__resolveType";

type Entry<M extends string, T> = M extends Owner
  ? App[M] extends infer Types
    ? T extends keyof Types
      ? Types[T]
      : never
    : never
  : never;

type Owned<E> = E extends { fields: infer F extends string } ? F : never;
type Mappers = Registered<"mappers", Record<never, never>>;

/**
 * Deep, so `UserPage.data: User[]` holds rows too. An unmapped interface
 * takes any implementer's mapper, since that's what graphql resolves.
 */
type Mapped<X> = [keyof Mappers] extends [never] ? X : DeepMapped<X>;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type DeepMapped<X> = X extends Primitive
  ? X
  : X extends readonly (infer I)[]
    ? DeepMapped<I>[]
    : // Generated object types are named by their `__typename`.
      X extends { __typename?: infer N }
      ? NonNullable<N> extends keyof Mappers
        ? Mappers[NonNullable<N>]
        : { [K in keyof X]: DeepMapped<X[K]> }
      : [InterfaceEntry<X>] extends [never]
        ? X
        : MappedInterface<InterfaceEntry<X>>;

type AllEntries = {
  [O in Owner]: {
    [T in keyof App[O]]: App[O][T] & { name: T };
  }[keyof App[O]];
}[Owner];

type InterfaceEntry<X> = AllEntries extends infer E
  ? E extends { resolveType: string; type: infer T }
    ? // Both ways: an object type that merely fits an interface isn't it.
      [X] extends [T]
      ? [T] extends [X]
        ? E
        : never
      : never
    : never
  : never;

type MappedInterface<E> = E extends { name: infer N; resolveType: infer P }
  ? N extends keyof Mappers
    ? Mappers[N]
    : MappedName<P>
  : never;

type MappedName<P> = P extends keyof Mappers
  ? Mappers[P]
  : DeepMapped<
      AllEntries extends infer E
        ? E extends { name: P; type: infer T }
          ? T
          : never
        : never
    >;

type Parent<E> = E extends { type: infer T } ? Mapped<T> : never;
type Out<E, F> = E extends { type: infer T }
  ? F extends keyof T
    ? Mapped<T[F]>
    : never
  : never;
type Args<E, F> = E extends { args: infer A }
  ? F extends keyof A
    ? A[F]
    : Record<string, never>
  : Record<string, never>;

/**
 * Inline under a field key (in `mw.<id>()` or a module's `middleware`),
 * `root` and `args` are that field's parent and arguments. A middleware
 * written on its own keeps these defaults, so it fits any key.
 */
export interface MiddlewareParams<
  Ctx = Context,
  Root = unknown,
  A = Record<string, unknown>
> {
  root: Root;
  args: A;
  ctx: Ctx;
  info: GraphQLResolveInfo;
  /**
   * The keys `@bypass` gives this field in the SDL, on the field or on its
   * type block: `if (bypass.has("tokenCheck")) return next();`.
   */
  bypass: ReadonlySet<BypassKey>;
}

/** Every key a `@bypass` in the SDL uses. */
export type BypassKey = Untyped extends true
  ? string
  : {
      [O in Owner]: {
        [T in keyof App[O]]: App[O][T] extends { bypass: infer B }
          ? B[keyof B]
          : never;
      }[keyof App[O]];
    }[Owner];

/**
 * `"*"` middleware also runs on subscriptions: type it
 * `MiddlewareFn<Context | SubscriptionContext>`.
 */
export type MiddlewareFn<
  Ctx = Context,
  Root = unknown,
  A = Record<string, unknown>
> = (params: MiddlewareParams<Ctx, Root, A>, next: () => unknown) => unknown;

type ContextOf<T> = T extends "*"
  ? Context | SubscriptionContext
  : T extends RootName<"subscription">
    ? SubscriptionContext
    : Context;

type Fns<
  T = string,
  Root = unknown,
  A = Record<string, unknown>
> = readonly MiddlewareFn<ContextOf<T>, Root, A>[];

export type MiddlewareMap = Partial<
  Record<string, Partial<Record<string, Fns>>>
>;

type RootFields<R extends RootType> = {
  [O in Owner]: Owned<Entry<O, R>>;
}[Owner];

export type Middleware = Untyped extends true
  ? MiddlewareMap
  : {
      [
        T in "*" | RootType as T extends RootType
          ? [RootFields<T>] extends [never]
            ? never
            : T
          : T
      ]?: {
        [K in "*" | (T extends RootType ? RootFields<T> : never)]?: Fns<
          T,
          T extends RootType ? undefined : unknown,
          K extends "*" ? Record<string, unknown> : Args<Declaring<T, K>, K>
        >;
      };
    };

type MiddlewareFields<O extends Owner, T> = Exclude<
  Owned<Entry<O, T>>,
  TypeHook
>;

type MiddlewareRoot<Os extends Owner, T> = T extends RootType
  ? undefined
  : { [O in Os]: Parent<Entry<O, T>> }[Os];

// "*" keys span fields with different arguments, so they keep the loose type.
type MiddlewareArgs<Os extends Owner, T, K> = K extends "*"
  ? Record<string, unknown>
  : {
      [O in Os]: K extends Owned<Entry<O, T>> ? Args<Entry<O, T>, K> : never;
    }[Os];

type MiddlewareFor<Os extends Owner> = {
  [
    T in { [O in Os]: keyof App[O] & string }[Os] as [
      { [O in Os]: MiddlewareFields<O, T> }[Os]
    ] extends [never]
      ? never
      : T
  ]?: {
    [K in "*" | { [O in Os]: MiddlewareFields<O, T> }[Os]]?: Fns<
      T,
      MiddlewareRoot<Os, T>,
      MiddlewareArgs<Os, T, K>
    >;
  } & DeclaredElsewhere<Os, T>;
};

/** Reaches the module's features too. */
export type ModuleMiddleware<M extends ModuleId> = Untyped extends true
  ? MiddlewareMap
  : MiddlewareFor<ModuleOwners<M> & Owner>;

/** Runs after the module's layers. */
export type FeatureMiddleware<
  M extends ModuleId,
  F extends string
> = Untyped extends true ? MiddlewareMap : MiddlewareFor<`${M}/${F}` & Owner>;

/**
 * What a field's `extensions` may hold, registered like `Olio` (`Source` and
 * `Args` are the field's parent and arguments, for extensions that are
 * functions). Strict: an unregistered key is a compile error.
 *
 * ```ts
 * declare module "@nxara/olio" {
 *   interface FieldExtensions<Source, Args> {
 *     complexity?: number | ((args: Args, childComplexity: number) => number);
 *   }
 * }
 * ```
 */
// oxlint-disable-next-line typescript/no-empty-interface -- augmented by apps
export interface FieldExtensions<Source, Args> {}

// Read back through graphql (`info.parentType.getFields()[name].extensions`,
// `schema.getQueryType().getFields()`), the registered keys keep their types.
declare module "graphql" {
  // oxlint-disable-next-line typescript/no-empty-interface -- merges into graphql's own
  interface GraphQLFieldExtensions<
    _TSource,
    _TContext,
    _TArgs
  > extends FieldExtensions<_TSource, _TArgs> {}
}

// Keys libraries add to graphql's own interface count too; its index
// signature (any key) doesn't, so typos stay errors.
type KnownKeys<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
};

type Extensions<Source, Args> = Untyped extends true
  ? Record<string, unknown>
  : FieldExtensions<Source, Args> &
      KnownKeys<GraphQLFieldExtensions<Source, Context, Args>>;

/** A resolver, or `{ resolve?, extensions? }` to attach extensions to the field too. */
export type FieldResolver<Fn, Source, Args> =
  | Fn
  | { resolve?: Fn; extensions?: Extensions<Source, Args> };

type OwnerOf<T, F> = {
  [O in Owner]: F extends Owned<Entry<O, T>> ? O : never;
}[Owner];

type OwnerKind<O> = O extends `${string}/${string}` ? "feature" : "module";

// Another owner's field reads as olio's runtime error, so the compile error
// names the owner instead of saying the field doesn't exist.
type DeclaredElsewhere<Os extends string, T> = {
  [
    F in Exclude<
      { [O in Owner]: Owned<Entry<O, T>> }[Owner],
      { [O in Os & Owner]: Owned<Entry<O, T>> }[Os & Owner]
    >
  ]?: `${T & string}.${F} is declared by ${OwnerKind<OwnerOf<T, F>>} ${OwnerOf<T, F>}; only that ${OwnerKind<OwnerOf<T, F>>} can resolve it`;
};

type RootResolvers<M extends string, R extends RootType> = DeclaredElsewhere<
  M,
  R
> & {
  [F in Owned<Entry<M, R>>]?: FieldResolver<
    (
      root: undefined,
      args: Args<Entry<M, R>, F>,
      ctx: Context,
      info: GraphQLResolveInfo
    ) => MaybePromise<Out<Entry<M, R>, F>>,
    undefined,
    Args<Entry<M, R>, F>
  >;
};

export type QueryResolvers<M extends string> = RootResolvers<
  M,
  RootName<"query">
>;
export type MutationResolvers<M extends string> = RootResolvers<
  M,
  RootName<"mutation">
>;

/** Middleware runs once, when a client subscribes, not per event. */
export type SubscriptionResolvers<M extends string> = DeclaredElsewhere<
  M,
  RootName<"subscription">
> & {
  [F in Owned<Entry<M, RootName<"subscription">>>]?: FieldResolver<
    (
      root: undefined,
      args: Args<Entry<M, RootName<"subscription">>, F>,
      ctx: SubscriptionContext,
      info: GraphQLResolveInfo
    ) => MaybePromise<
      AsyncIterable<Out<Entry<M, RootName<"subscription">>, F>>
    >,
    undefined,
    Args<Entry<M, RootName<"subscription">>, F>
  >;
};

export type ModuleTypeName<M extends string> = M extends Owner
  ? Exclude<keyof App[M] & string, RootType>
  : never;

type TypeHookResolver<E, F> = (
  root: Parent<E>,
  ctx: Context,
  info: GraphQLResolveInfo
) => MaybePromise<
  F extends "__isTypeOf"
    ? boolean
    : (E extends { resolveType: infer R } ? R : never) | null
>;

/** An enum takes its internal values (`CustomEnums` in @nxara/olio-codegen): `{ ADMIN: 1 }`. */
export type TypeResolvers<M extends string, T extends ModuleTypeName<M>> =
  Entry<M, T> extends { scalar: true }
    ? GraphQLScalarType
    : Entry<M, T> extends { enum: infer V extends string }
      ? { [K in V]: Parent<Entry<M, T>> }
      : DeclaredElsewhere<M, T> & {
          [F in Owned<Entry<M, T>>]?: F extends TypeHook
            ? TypeHookResolver<Entry<M, T>, F>
            : FieldResolver<
                (
                  root: Parent<Entry<M, T>>,
                  args: Args<Entry<M, T>, F>,
                  ctx: Context,
                  info: GraphQLResolveInfo
                ) => MaybePromise<Out<Entry<M, T>, F>>,
                Parent<Entry<M, T>>,
                Args<Entry<M, T>, F>
              >;
        };

type TypeName = { [O in Owner]: keyof App[O] & string }[Owner];

type Declaring<T, F> = {
  [O in Owner]: Entry<O, T> extends infer E
    ? E extends unknown
      ? F extends Owned<E>
        ? E
        : never
      : never
    : never;
}[Owner];

type FieldName<T> = Exclude<
  { [O in Owner]: Owned<Entry<O, T>> }[Owner],
  TypeHook
>;

/**
 * For code outside resolvers: `Fields["Query"]["user"]["args"]`. Indexed
 * access, so editors complete each key.
 */
export type Fields = {
  [T in TypeName as [FieldName<T>] extends [never] ? never : T]: {
    [F in FieldName<T>]: {
      args: Args<Declaring<T, F>, F>;
      result: Out<Declaring<T, F>, F>;
    };
  };
};

// Shared with @nxara/olio-tools and @nxara/olio-http, which mustn't depend on olio.
export type {
  Context,
  LoadedEnums,
  LoadedResolvers,
  Olio,
  OlioFeature,
  OlioModule,
  ResolverMap,
  TypeSource
};

type UntypedResolver = (
  root: unknown,
  args: Record<string, unknown>,
  ctx: Context,
  info: GraphQLResolveInfo
) => unknown;

type UntypedInlineResolvers = Record<
  string,
  Record<
    string,
    | UntypedResolver
    | { resolve?: UntypedResolver; extensions?: Record<string, unknown> }
  >
>;

// The brand's key, so a typed map may carry it too.
type LoadedBrand = {
  readonly [K in Exclude<keyof LoadedResolvers, string | number>]?: true;
};

type OwnEnum<O extends string> = {
  [T in ModuleTypeName<O>]: Entry<O, T> extends { enum: string } ? T : never;
}[ModuleTypeName<O>];

// Codegen's `type` is what CustomEnums made of the enum, so a `type` other
// than its GraphQL names means the enum has internal values.
type CustomEnum<O extends string> = {
  [T in OwnEnum<O>]: Entry<O, T> extends { enum: infer V; type: infer I }
    ? [I] extends [V]
      ? [V] extends [I]
        ? never
        : T
      : T
    : never;
}[OwnEnum<O>];

/** Internal values per enum, `{ Role: { ADMIN: 1, USER: 2 } }`; see `CustomEnums` in @nxara/olio-codegen. */
export type EnumValues<O extends string> = Untyped extends true
  ? Record<string, Record<string, unknown>>
  : { [T in CustomEnum<O>]: TypeResolvers<O, T & ModuleTypeName<O>> };

// Required once CustomEnums gives one of the owner's enums internal values:
// without them graphql would fail on every value a resolver returns.
type EnumsOption<O extends string> = Untyped extends true
  ? { enums?: EnumValues<O> }
  : [CustomEnum<O>] extends [never]
    ? unknown
    : { enums: EnumValues<O> | LoadedEnums };

export type OwnerResolvers<O extends string> = Untyped extends true
  ? ResolverMap | UntypedInlineResolvers
  : O extends Owner
    ? {
        [
          T in Exclude<keyof App[O] & string, OwnEnum<O>>
        ]?: T extends RootName<"query">
          ? QueryResolvers<O>
          : T extends RootName<"mutation">
            ? MutationResolvers<O>
            : T extends RootName<"subscription">
              ? SubscriptionResolvers<O>
              : TypeResolvers<O, T & ModuleTypeName<O>>;
      } & LoadedBrand
    : never;

export type ModuleConfig<M extends ModuleId> = {
  typeDefs?: TypeSource | readonly TypeSource[];
  /**
   * One map: inline, or what `loadResolvers` returns. Not a list: a union
   * with one would stop errors from pointing at the field.
   */
  resolvers?: OwnerResolvers<M>;
  /** May target the features' fields too. */
  middleware?: ModuleMiddleware<M>;
  /** One per feature folder, usually from `loadFeatures` in @nxara/olio-tools. */
  features?: readonly OlioFeature[];
} & EnumsOption<M>;

export type FeatureConfig<M extends ModuleId, F extends string> = {
  typeDefs?: TypeSource | readonly TypeSource[];
  /** One map, as for a module. */
  resolvers?: OwnerResolvers<`${M}/${F}`>;
  middleware?: FeatureMiddleware<M, F>;
} & EnumsOption<`${M}/${F}`>;
