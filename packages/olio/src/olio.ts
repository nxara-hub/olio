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
  type GraphQLScalarType,
  type GraphQLSchema
} from "graphql";

import type {
  Middleware,
  MiddlewareFn,
  MiddlewareMap,
  MiddlewareParams,
  ModuleConfig,
  ModuleId,
  OlioModule,
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

export function createModule<M extends ModuleId>(
  id: M,
  config: ModuleConfig<M>
): OlioModule {
  return {
    id,
    typeDefs: toList(config.typeDefs).map((typeDef: TypeSource) =>
      typeof typeDef === "string"
        ? parse(new Source(typeDef, `module "${id}"`))
        : typeDef
    ),
    resolvers: toList(config.resolvers),
    middleware: mergeMiddleware(
      toList(config.middleware) as readonly MiddlewareMap[]
    )
  };
}

/** Merge per-feature middleware maps; a shared key runs each map's fns in order. */
function mergeMiddleware(maps: readonly MiddlewareMap[]): MiddlewareMap {
  const merged: Record<string, Record<string, MiddlewareFn[]>> = {};
  for (const map of maps) {
    for (const [type, fields] of Object.entries(map)) {
      const target = merged[type] ?? {};
      merged[type] = target;
      for (const [field, fns] of Object.entries(fields ?? {})) {
        target[field] = [...(target[field] ?? []), ...(fns ?? [])];
      }
    }
  }
  return merged;
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
 * Layers run top-down: app `*.*`, app `Type.*`, app `Type.field`, module
 * `Type.*`, module `Type.field`. An exclusive layer resets what came before.
 */
function chainFor(
  app: MiddlewareMap,
  module: MiddlewareMap,
  type: string,
  field: string
): MiddlewareFn[] {
  const layers = [
    layer(app, "*", "*"),
    layer(app, type, "*"),
    layer(app, type, field),
    layer(module, type, "*"),
    layer(module, type, field)
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
  module: OlioModule;
  appMiddleware: MiddlewareMap;
  /** `Type.field` -> the module that declares it in SDL. */
  declared: ReadonlyMap<string, string>;
  /** `Type.field` already given a resolver, to catch a module resolving twice. */
  resolved: Set<string>;
  /** Enums given internal values, finished once every module is applied. */
  enums: Set<GraphQLEnumType>;
}

/** Only the module that declares `Type.field` (or an enum value) may resolve it. */
function claim({ module, declared, resolved }: Attach, key: string): void {
  const where = `Module "${module.id}"`;
  const owner = declared.get(key);
  if (owner !== module.id) {
    throw new Error(
      owner
        ? `${where}: "${key}" is declared by module "${owner}"; only that module can resolve it`
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
  const { schema, module, appMiddleware } = attach;
  const key = `${type.name}.${fieldName}`;
  const where = `Module "${module.id}"`;

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

  const chain = chainFor(
    appMiddleware,
    module.middleware,
    type.name,
    fieldName
  );
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
      throw new Error(
        `Module "${attach.module.id}": unknown enum value "${key}"`
      );
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
  for (const map of attach.module.resolvers) {
    for (const [typeName, value] of Object.entries(map)) {
      const type = attach.schema.getType(typeName);
      if (!type) {
        throw new Error(
          `Module "${attach.module.id}": unknown type "${typeName}"`
        );
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
          `Module "${attach.module.id}": cannot attach resolvers to ${typeName}`
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

/** A module may target the fields it declares, plus `*` and the `-` forms. */
function checkModuleMiddleware(
  schema: GraphQLSchema,
  module: OlioModule,
  declared: ReadonlyMap<string, string>
): void {
  for (const [type, fields] of Object.entries(module.middleware)) {
    for (const key of Object.keys(fields ?? {})) {
      if (!isObjectType(schema.getType(type))) {
        throw new Error(
          `Module "${module.id}": middleware "${type}.${key}" targets ${type}, which has no fields to wrap`
        );
      }
      const field = key.replace(/^-/, "");
      const owns =
        field === "*"
          ? [...declared].some(
              ([k, id]) => id === module.id && k.startsWith(`${type}.`)
            )
          : declared.get(`${type}.${field}`) === module.id &&
            !field.startsWith("__");
      if (!owns) {
        throw new Error(
          `Module "${module.id}": middleware "${type}.${key}" targets a field the module doesn't declare`
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
  config: OlioConfig,
  declared: ReadonlyMap<string, string>
): void {
  const app = (config.middleware ?? {}) as MiddlewareMap;
  const byId = new Map(config.modules.map((m) => [m.id, m]));
  const targets = new Set<string>();
  for (const map of [app, ...config.modules.map((m) => m.middleware)]) {
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
      chainFor(app, owner.middleware, typeName, fieldName)
    );
  }
}

/**
 * Compose modules into one executable schema. Middleware wraps the resolvers
 * modules define, and any field it names explicitly.
 */
export function olio(config: OlioConfig): OlioApp {
  const ids = new Set<string>();
  for (const { id } of config.modules) {
    if (ids.has(id)) throw new Error(`Module "${id}" is registered twice`);
    ids.add(id);
  }

  const { schema, ownership } = compose(config.modules, config.directives);
  const declared = declarations(ownership);
  const appMiddleware = (config.middleware ?? {}) as MiddlewareMap;
  checkAppMiddleware(schema, appMiddleware);

  const resolved = new Set<string>();
  const enums = new Set<GraphQLEnumType>();
  for (const module of config.modules) {
    checkModuleMiddleware(schema, module, declared);
    applyResolvers({
      schema,
      module,
      appMiddleware,
      declared,
      resolved,
      enums
    });
  }
  checkEnums(enums);
  wrapDefaults(schema, config, declared);

  return { schema, modules: config.modules };
}
