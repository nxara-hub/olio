import { compose, type Ownership, type SchemaDirective } from "@nxlab/schema";
import {
  defaultFieldResolver,
  isEnumType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  parse,
  Source,
  type GraphQLEnumType,
  type GraphQLFieldResolver,
  type GraphQLNamedType,
  type DocumentNode,
  type GraphQLScalarType,
  type GraphQLSchema
} from "graphql";

import type {
  FeatureConfig,
  Middleware,
  MiddlewareFn,
  MiddlewareMap,
  MiddlewareParams,
  ModuleConfig,
  ModuleId,
  OlioFeature,
  OlioModule,
  ResolverMap,
  TypeSource
} from "./types.js";

export interface OlioConfig {
  modules: readonly OlioModule[];
  middleware?: Middleware;
  /** Schema-design directives, the same ones passed to codegen. */
  directives?: readonly SchemaDirective[];
}

export interface OlioApp {
  readonly schema: GraphQLSchema;
  readonly modules: readonly OlioModule[];
}

type Resolve = GraphQLFieldResolver<unknown, unknown, Record<string, unknown>>;

const toList = <T>(value: T | readonly T[] | undefined): readonly T[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as T];
};

const parseAll = (
  typeDefs: TypeSource | readonly TypeSource[] | undefined,
  name: string
): DocumentNode[] =>
  toList(typeDefs).map((typeDef) =>
    typeof typeDef === "string" ? parse(new Source(typeDef, name)) : typeDef
  );

export function createModule<M extends ModuleId>(
  id: M,
  config: ModuleConfig<M>
): OlioModule {
  return {
    id,
    typeDefs: parseAll(config.typeDefs, `module "${id}"`),
    resolvers: toList(config.resolvers),
    middleware: (config.middleware ?? {}) as MiddlewareMap,
    features: config.features ?? []
  };
}

/** A feature of `module`, owning the fields its own SDL declares. */
export function createFeature<M extends ModuleId, F extends string>(
  module: M,
  id: F,
  config: FeatureConfig<M, F>
): OlioFeature {
  return {
    module,
    id,
    typeDefs: parseAll(config.typeDefs, `feature "${module}/${id}"`),
    resolvers: toList(config.resolvers),
    middleware: (config.middleware ?? {}) as MiddlewareMap
  };
}

// ---------------------------------------------------------------------------
// Owners: modules and their features

/** A module, or one of its features: what owns SDL and resolves it. */
interface Owner {
  /** `"sales"`, or `"sales/orders"` for a feature. */
  id: string;
  kind: "module" | "feature";
  /** For errors: `Module "sales"`, `Feature "sales/orders"`. */
  label: string;
  typeDefs: readonly DocumentNode[];
  resolvers: readonly ResolverMap[];
  middleware: MiddlewareMap;
  /** Middleware layers between the app and this owner: its module's, for a feature. */
  parents: readonly MiddlewareMap[];
  /** Whether this owner's middleware may target a field owned by `id`. */
  reaches: (id: string) => boolean;
}

/** Flatten modules into owners: each module, then each of its features. */
function owners(modules: readonly OlioModule[]): Owner[] {
  const result: Owner[] = [];
  const ids = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) throw new Error(`Module "${m.id}" is registered twice`);
    ids.add(m.id);
    result.push({
      ...m,
      kind: "module",
      label: `Module "${m.id}"`,
      parents: [],
      reaches: (id) => id === m.id || id.startsWith(`${m.id}/`)
    });
    for (const f of m.features) {
      const id = `${m.id}/${f.id}`;
      if (f.module !== m.id) {
        throw new Error(
          `Feature "${f.module}/${f.id}" is listed in module "${m.id}"`
        );
      }
      if (ids.has(id)) throw new Error(`Feature "${id}" is registered twice`);
      ids.add(id);
      result.push({
        id,
        kind: "feature",
        label: `Feature "${id}"`,
        typeDefs: f.typeDefs,
        resolvers: f.resolvers,
        middleware: f.middleware,
        parents: [m.middleware],
        reaches: (owner) => owner === id
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Middleware chains

interface Layer {
  fns: readonly MiddlewareFn[];
  /** `-` key: drop every layer above this one. */
  exclusive: boolean;
}

function layer(
  middleware: MiddlewareMap,
  type: string,
  key: string
): Layer | undefined {
  const fields = middleware[type];
  const inclusive = fields?.[key];
  const exclusive = fields?.[`-${key}`];
  if (inclusive && exclusive) {
    throw new Error(
      `Middleware "${type}.${key}" cannot be combined with "${type}.-${key}"`
    );
  }
  if (exclusive) return { fns: exclusive, exclusive: true };
  return inclusive ? { fns: inclusive, exclusive: false } : undefined;
}

/**
 * Layers run top-down: app `*.*`, app `Type.*`, app `Type.field`, then for the
 * module and (for a feature's field) the feature: `Type.*`, `Type.field`. An
 * exclusive layer resets what came before.
 */
function chainFor(
  app: MiddlewareMap,
  owner: Owner,
  type: string,
  field: string
): MiddlewareFn[] {
  const layers = [
    layer(app, "*", "*"),
    layer(app, type, "*"),
    layer(app, type, field),
    ...[...owner.parents, owner.middleware].flatMap((map) => [
      layer(map, type, "*"),
      layer(map, type, field)
    ])
  ];
  const chain: MiddlewareFn[] = [];
  for (const current of layers) {
    if (!current) continue;
    if (current.exclusive) chain.length = 0;
    chain.push(...current.fns);
  }
  return chain;
}

function wrap(resolve: Resolve, chain: readonly MiddlewareFn[]): Resolve {
  if (chain.length === 0) return resolve;
  return (root, args, ctx, info) => {
    const params: MiddlewareParams = { root, args, ctx, info };
    const run = (index: number): unknown => {
      const fn = chain[index];
      // Middleware may replace root/args/ctx on `params` before calling next.
      return fn
        ? fn(params, () => run(index + 1))
        : resolve(params.root, params.args, params.ctx, info);
    };
    return run(0);
  };
}

// ---------------------------------------------------------------------------
// Attaching resolvers

interface Attach {
  schema: GraphQLSchema;
  owner: Owner;
  appMiddleware: MiddlewareMap;
  /** `Type.field` -> the module that declares it in SDL. */
  declared: ReadonlyMap<string, string>;
  /** `Type.field` already given a resolver, to catch a module resolving twice. */
  resolved: Set<string>;
  /** Enums given internal values, finished once every module is applied. */
  enums: Set<GraphQLEnumType>;
}

/** Only the module that declares `Type.field` (or an enum value) may resolve it. */
function claim({ owner: self, declared, resolved }: Attach, key: string): void {
  const where = self.label;
  const owner = declared.get(key);
  if (owner !== self.id) {
    throw new Error(
      owner
        ? `${where}: "${key}" is declared by ${owner.includes("/") ? "feature" : "module"} "${owner}"; only that ${owner.includes("/") ? "feature" : "module"} can resolve it`
        : `${where}: "${key}" can't be resolved here`
    );
  }
  if (resolved.has(key))
    throw new Error(`${where}: "${key}" is resolved twice`);
  resolved.add(key);
}

/**
 * What graphql 17 calls on a scalar. A scalar written the older way
 * (`serialize`, `parseValue`, as graphql-scalars does) gets the coerce methods
 * from its constructor, and literals still fall back to `parseLiteral`.
 */
const SCALAR_METHODS = [
  "coerceOutputValue",
  "coerceInputValue",
  "coerceInputLiteral",
  "parseLiteral",
  "valueToLiteral"
] as const;

function applyScalar(type: GraphQLScalarType, value: object): void {
  const target = type as unknown as Record<string, unknown>;
  const source = value as Record<string, unknown>;
  for (const method of SCALAR_METHODS) {
    if (typeof source[method] === "function") target[method] = source[method];
  }
}

function applyField(
  attach: Attach,
  type: GraphQLNamedType,
  fieldName: string,
  resolver: unknown
): void {
  const { schema, owner, appMiddleware } = attach;
  const key = `${type.name}.${fieldName}`;
  const where = owner.label;

  if (fieldName === "__resolveType" || fieldName === "__isTypeOf") {
    if (typeof resolver !== "function") {
      throw new TypeError(`${where}: "${key}" must be a function`);
    }
    claim(attach, key);
    const abstract = isUnionType(type) || isInterfaceType(type);
    if (fieldName === "__resolveType" && abstract) {
      type.resolveType = resolver as typeof type.resolveType;
      return;
    }
    if (fieldName === "__isTypeOf" && isObjectType(type)) {
      type.isTypeOf = resolver as typeof type.isTypeOf;
      return;
    }
    throw new Error(`${where}: "${key}" is not valid on ${type.name}`);
  }

  if (!isObjectType(type) && !isInterfaceType(type)) {
    throw new Error(`${where}: ${type.name} only accepts __resolveType`);
  }
  const field = type.getFields()[fieldName];
  if (!field) throw new Error(`${where}: unknown field "${key}"`);

  claim(attach, key);

  const chain = chainFor(appMiddleware, owner, type.name, fieldName);
  if (typeof resolver !== "function") {
    throw new TypeError(
      type === schema.getSubscriptionType()
        ? `${where}: "${key}" must be a function returning an AsyncIterable, e.g. an async generator`
        : `${where}: "${key}" must be a function`
    );
  }
  if (type === schema.getSubscriptionType()) {
    // Each event is the field's value; middleware runs once, on subscribe.
    field.subscribe = wrap(resolver as Resolve, chain);
    field.resolve = (event) => event;
    return;
  }
  field.resolve = wrap(resolver as Resolve, chain);
}

/** `Role: { ADMIN: 1 }`: internal values for an enum's values. */
function applyEnum(
  attach: Attach,
  type: GraphQLEnumType,
  values: object
): void {
  for (const [name, internal] of Object.entries(values)) {
    const key = `${type.name}.${name}`;
    const value = type.getValue(name);
    if (!value) {
      throw new Error(`${attach.owner.label}: unknown enum value "${key}"`);
    }
    claim(attach, key);
    (value as { value: unknown }).value = internal;
  }
  attach.enums.add(type);
}

/**
 * Reject enums whose values share an internal value. graphql builds its
 * internal-value lookup lazily, on first use, so the values set above are the
 * ones it sees; defaults are coerced when an operation runs.
 */
function checkEnums(enums: ReadonlySet<GraphQLEnumType>): void {
  for (const type of enums) {
    const seen = new Map<unknown, string>();
    for (const value of type.getValues()) {
      const other = seen.get(value.value);
      if (other !== undefined) {
        throw new Error(
          `Enum "${type.name}": ${other} and ${value.name} have the same internal value ${JSON.stringify(value.value)}`
        );
      }
      seen.set(value.value, value.name);
    }
  }
}

function applyResolvers(attach: Attach): void {
  for (const map of attach.owner.resolvers) {
    for (const [typeName, value] of Object.entries(map)) {
      const type = attach.schema.getType(typeName);
      if (!type) {
        throw new Error(`${attach.owner.label}: unknown type "${typeName}"`);
      }
      if (isScalarType(type)) {
        applyScalar(type, value);
        continue;
      }
      if (isEnumType(type)) {
        applyEnum(attach, type, value);
        continue;
      }
      if (!isObjectType(type) && !isInterfaceType(type) && !isUnionType(type)) {
        throw new Error(
          `${attach.owner.label}: cannot attach resolvers to ${typeName}`
        );
      }
      for (const [fieldName, resolver] of Object.entries(value)) {
        applyField(attach, type, fieldName, resolver);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware targets

/** `Type.field` -> declaring module id, from `compose`'s ownership. */
function declarations(ownership: Ownership): Map<string, string> {
  const declared = new Map<string, string>();
  for (const [id, types] of ownership) {
    for (const [type, fields] of types) {
      for (const field of fields) declared.set(`${type}.${field}`, id);
    }
  }
  return declared;
}

/** The app may target `"*"` and root types, with no `-` keys. */
function checkAppMiddleware(
  schema: GraphQLSchema,
  middleware: MiddlewareMap
): void {
  for (const [type, fields] of Object.entries(middleware)) {
    for (const key of Object.keys(fields ?? {})) {
      const target = `"${type}.${key}"`;
      if (key.startsWith("-")) {
        throw new Error(
          `Application middleware ${target}: "-" keys only apply to module middleware`
        );
      }
      if (type === "*") {
        if (key !== "*") {
          throw new Error(
            `Application middleware ${target}: "*" only takes "*"`
          );
        }
        continue;
      }
      const root = [
        schema.getQueryType(),
        schema.getMutationType(),
        schema.getSubscriptionType()
      ].find((t) => t?.name === type);
      if (!root) {
        throw new Error(
          `Application middleware ${target}: the application can target "*" and root types only`
        );
      }
      if (key !== "*" && !root.getFields()[key]) {
        throw new Error(`Application middleware ${target}: unknown field`);
      }
    }
  }
}

/**
 * A module's middleware may target the fields it and its features declare; a
 * feature's, only its own. Plus `*` and the `-` forms.
 */
function checkOwnerMiddleware(
  schema: GraphQLSchema,
  owner: Owner,
  declared: ReadonlyMap<string, string>
): void {
  for (const [type, fields] of Object.entries(owner.middleware)) {
    for (const key of Object.keys(fields ?? {})) {
      if (!isObjectType(schema.getType(type))) {
        throw new Error(
          `${owner.label}: middleware "${type}.${key}" targets ${type}, which has no fields to wrap`
        );
      }
      const field = key.replace(/^-/, "");
      const reaches =
        field === "*"
          ? [...declared].some(
              ([k, id]) => owner.reaches(id) && k.startsWith(`${type}.`)
            )
          : owner.reaches(declared.get(`${type}.${field}`) ?? "") &&
            !field.startsWith("__");
      if (!reaches) {
        throw new Error(
          `${owner.label}: middleware "${type}.${key}" targets a field the ${owner.kind} doesn't declare`
        );
      }
    }
  }
}

/**
 * Fields named explicitly in middleware (`Type.field`, not `*`) that have no
 * resolver get GraphQL's default resolver wrapped, so the middleware runs.
 */
function wrapDefaults(
  schema: GraphQLSchema,
  app: MiddlewareMap,
  all: readonly Owner[],
  declared: ReadonlyMap<string, string>
): void {
  const byId = new Map(all.map((o) => [o.id, o]));
  const targets = new Set<string>();
  for (const map of [app, ...all.map((o) => o.middleware)]) {
    for (const [type, fields] of Object.entries(map)) {
      for (const key of Object.keys(fields ?? {})) {
        const field = key.replace(/^-/, "");
        if (type !== "*" && field !== "*") targets.add(`${type}.${field}`);
      }
    }
  }
  for (const target of targets) {
    const [typeName = "", fieldName = ""] = target.split(".");
    const type = schema.getType(typeName);
    if (!isObjectType(type) || type === schema.getSubscriptionType()) continue;
    const field = type.getFields()[fieldName];
    const owner = byId.get(declared.get(target) ?? "");
    if (!field || field.resolve || !owner) continue;
    field.resolve = wrap(
      defaultFieldResolver as Resolve,
      chainFor(app, owner, typeName, fieldName)
    );
  }
}

/**
 * Compose modules into one executable schema. Middleware wraps the resolvers
 * modules define, and any field it names explicitly.
 */
export function olio(config: OlioConfig): OlioApp {
  const all = owners(config.modules);
  const { schema, ownership } = compose(all, config.directives);
  const declared = declarations(ownership);
  const appMiddleware = (config.middleware ?? {}) as MiddlewareMap;
  checkAppMiddleware(schema, appMiddleware);

  const resolved = new Set<string>();
  const enums = new Set<GraphQLEnumType>();
  for (const owner of all) {
    checkOwnerMiddleware(schema, owner, declared);
    applyResolvers({ schema, owner, appMiddleware, declared, resolved, enums });
  }
  checkEnums(enums);
  wrapDefaults(schema, appMiddleware, all, declared);

  return { schema, modules: config.modules };
}
