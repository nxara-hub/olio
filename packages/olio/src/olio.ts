import {
  compose,
  SCALAR,
  type Ownership,
  type SchemaDirective
} from "@nxlab/schema";
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
  FeatureMiddleware,
  Middleware,
  MiddlewareFn,
  MiddlewareMap,
  MiddlewareParams,
  ModuleConfig,
  ModuleId,
  ModuleMiddleware,
  OlioFeature,
  OlioModule,
  ResolverMap,
  TypeSource
} from "./types.js";

export interface OlioConfig {
  modules: readonly OlioModule[];
  middleware?: Middleware;
  /** Must be the same ones passed to codegen. */
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

export function createModule<
  M extends ModuleId,
  const MW extends ModuleMiddleware<M> = ModuleMiddleware<M>
>(id: M, config: ModuleConfig<M, MW>): OlioModule {
  return {
    id,
    typeDefs: parseAll(config.typeDefs, `module "${id}"`),
    resolvers: toList(config.resolvers) as readonly ResolverMap[],
    middleware: (config.middleware ?? {}) as MiddlewareMap,
    features: config.features ?? []
  };
}

export function createFeature<
  M extends ModuleId,
  F extends string,
  const MW extends FeatureMiddleware<M, F> = FeatureMiddleware<M, F>
>(module: M, id: F, config: FeatureConfig<M, F, MW>): OlioFeature {
  return {
    module,
    id,
    typeDefs: parseAll(config.typeDefs, `feature "${module}/${id}"`),
    resolvers: toList(config.resolvers) as readonly ResolverMap[],
    middleware: (config.middleware ?? {}) as MiddlewareMap
  };
}

interface Owner {
  id: string;
  kind: "module" | "feature";
  label: string;
  typeDefs: readonly DocumentNode[];
  resolvers: readonly ResolverMap[];
  middleware: MiddlewareMap;
  upperMiddleware: readonly MiddlewareMap[];
  canTarget: (owner: string) => boolean;
}

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
      upperMiddleware: [],
      canTarget: (id) => id === m.id || id.startsWith(`${m.id}/`)
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
        upperMiddleware: [m.middleware],
        canTarget: (owner) => owner === id
      });
    }
  }
  return result;
}

interface Layer {
  fns: readonly MiddlewareFn[];
  dropsAbove: boolean;
}

function layer(
  middleware: MiddlewareMap,
  type: string,
  key: string
): Layer | undefined {
  const fields = middleware[type];
  const adding = fields?.[key];
  const dropping = fields?.[`-${key}`];
  if (adding && dropping) {
    throw new Error(
      `Middleware "${type}.${key}" cannot be combined with "${type}.-${key}"`
    );
  }
  if (dropping) return { fns: dropping, dropsAbove: true };
  return adding ? { fns: adding, dropsAbove: false } : undefined;
}

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
    ...[...owner.upperMiddleware, owner.middleware].flatMap((map) => [
      layer(map, type, "*"),
      layer(map, type, field)
    ])
  ];
  const chain: MiddlewareFn[] = [];
  for (const current of layers) {
    if (!current) continue;
    if (current.dropsAbove) chain.length = 0;
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

interface Attach {
  schema: GraphQLSchema;
  owner: Owner;
  appMiddleware: MiddlewareMap;
  declared: ReadonlyMap<string, string>;
  resolved: Set<string>;
  enums: Set<GraphQLEnumType>;
}

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

// Only what graphql 17 calls. Scalars written the older way (`serialize`, as
// graphql-scalars does) get the coerce methods from their constructor.
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

// Setting `value` after the schema is built is safe: graphql builds its
// internal-value lookup lazily and coerces defaults per operation.
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

// Passing `query.users({...})` straight in as a resolver map keys it by field;
// a common slip, so the error says so.
function unknownType({ schema, owner }: Attach, name: string): string {
  const root = [
    schema.getQueryType(),
    schema.getMutationType(),
    schema.getSubscriptionType()
  ].find((t) => t?.getFields()[name]);
  const hint = root
    ? `. It's a ${root.name} field: key resolvers by type, e.g. { ${root.name}: { ${name}: ... } }`
    : "";
  return `${owner.label}: unknown type "${name}"${hint}`;
}

function applyResolvers(attach: Attach): void {
  for (const map of attach.owner.resolvers) {
    for (const [typeName, value] of Object.entries(map)) {
      const type = attach.schema.getType(typeName);
      if (!type) throw new Error(unknownType(attach, typeName));
      if (isScalarType(type)) {
        const definer = attach.declared.get(`${typeName}.${SCALAR}`);
        if (definer !== attach.owner.id) {
          throw new Error(
            definer
              ? `${attach.owner.label}: scalar "${typeName}" is defined by "${definer}"; only it can implement the scalar`
              : `${attach.owner.label}: scalar "${typeName}" isn't defined in any module's SDL`
          );
        }
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

function declarations(ownership: Ownership): Map<string, string> {
  const declared = new Map<string, string>();
  for (const [id, types] of ownership) {
    for (const [type, fields] of types) {
      for (const field of fields) declared.set(`${type}.${field}`, id);
    }
  }
  return declared;
}

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
              ([k, id]) => owner.canTarget(id) && k.startsWith(`${type}.`)
            )
          : owner.canTarget(declared.get(`${type}.${field}`) ?? "") &&
            !field.startsWith("__");
      if (!reaches) {
        throw new Error(
          `${owner.label}: middleware "${type}.${key}" targets a field the ${owner.kind} doesn't declare`
        );
      }
    }
  }
}

// A field named explicitly in middleware runs it even without a resolver: its
// default resolver gets wrapped. `*` doesn't reach those.
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

/** Middleware wraps the resolvers modules define, plus any field it names explicitly. */
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
