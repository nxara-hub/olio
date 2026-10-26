import {
  compose,
  SCALAR,
  type Bypass,
  type Ownership,
  type SchemaDirective
} from "@nxlab/schema";
import {
  defaultFieldResolver,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  parse,
  Source,
  valueFromAST,
  type GraphQLArgument,
  type GraphQLEnumType,
  type GraphQLInputField,
  type GraphQLInputObjectType,
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

// Plain JavaScript can still pass a list, whose keys would read as types.
function resolverMap(
  owner: string,
  resolvers: object | undefined
): readonly ResolverMap[] {
  if (resolvers === undefined) return [];
  if (Array.isArray(resolvers)) {
    throw new TypeError(
      `${owner}: resolvers must be one map keyed by type, not a list`
    );
  }
  return [resolvers as ResolverMap];
}

// "/" separates a module from its features in owner ids ("sales/orders"), so
// an id containing one would pass for a feature of another module.
function checkId(kind: "Module" | "Feature", id: string): void {
  if (id === "" || id.includes("/")) {
    throw new Error(
      `${kind} id ${JSON.stringify(id)} must be non-empty and can't contain "/"`
    );
  }
}

export function createModule<M extends ModuleId>(
  id: M,
  config: ModuleConfig<M>
): OlioModule {
  checkId("Module", id);
  return {
    id,
    typeDefs: parseAll(config.typeDefs, `module "${id}"`),
    resolvers: resolverMap(`Module "${id}"`, config.resolvers),
    middleware: (config.middleware ?? {}) as MiddlewareMap,
    features: config.features ?? []
  };
}

export function createFeature<M extends ModuleId, F extends string>(
  module: M,
  id: F,
  config: FeatureConfig<M, F>
): OlioFeature {
  checkId("Feature", id);
  return {
    module,
    id,
    typeDefs: parseAll(config.typeDefs, `feature "${module}/${id}"`),
    resolvers: resolverMap(`Feature "${module}/${id}"`, config.resolvers),
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

function chainFor(
  app: MiddlewareMap,
  owner: Owner,
  type: string,
  field: string
): MiddlewareFn[] {
  return [
    app["*"]?.["*"],
    app[type]?.["*"],
    app[type]?.[field],
    ...[...owner.upperMiddleware, owner.middleware].flatMap((map) => [
      map[type]?.["*"],
      map[type]?.[field]
    ])
  ].flatMap((fns) => fns ?? []);
}

// One shared empty set for every field without a @bypass.
const NO_BYPASS: ReadonlySet<string> = new Set();

function wrap(
  resolve: Resolve,
  chain: readonly MiddlewareFn[],
  bypass: ReadonlySet<string>
): Resolve {
  if (chain.length === 0) return resolve;
  return (root, args, ctx, info) => {
    // The keys come from the same SDL BypassKey is generated from.
    const params: MiddlewareParams = {
      root,
      args,
      ctx,
      info,
      bypass: bypass as MiddlewareParams["bypass"]
    };
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
  bypass: Bypass;
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

const SCALAR_METHODS = ["serialize", "parseValue", "parseLiteral"] as const;

function applyScalar(type: GraphQLScalarType, value: object): void {
  const target = type as unknown as Record<string, unknown>;
  const source = value as Record<string, unknown>;
  for (const method of SCALAR_METHODS) {
    if (typeof source[method] === "function") target[method] = source[method];
  }
}

interface FieldParts {
  resolve?: Resolve;
  extensions?: Record<string, unknown>;
}

// A field's value: its resolver, or `{ resolve?, extensions? }`.
function fieldParts(
  where: string,
  key: string,
  value: unknown,
  subscription: boolean
): FieldParts {
  const expected = subscription
    ? "a function returning an AsyncIterable (e.g. an async generator), or { resolve, extensions }"
    : "a function, or { resolve, extensions }";
  if (typeof value === "function") return { resolve: value as Resolve };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${where}: "${key}" must be ${expected}`);
  }
  const { resolve, extensions, ...rest } = value as Record<string, unknown>;
  const extra = Object.keys(rest)[0];
  if (extra !== undefined) {
    throw new TypeError(
      `${where}: "${key}" must be ${expected}, not "${extra}"`
    );
  }
  if (resolve !== undefined && typeof resolve !== "function") {
    throw new TypeError(`${where}: "${key}".resolve must be a function`);
  }
  if (
    extensions !== undefined &&
    (typeof extensions !== "object" || extensions === null)
  ) {
    throw new TypeError(`${where}: "${key}".extensions must be an object`);
  }
  return {
    resolve: resolve as Resolve | undefined,
    extensions: extensions as Record<string, unknown> | undefined
  };
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

  const subscription = type === schema.getSubscriptionType();
  const { resolve, extensions } = fieldParts(
    where,
    key,
    resolver,
    subscription
  );
  if (extensions) {
    (field as { extensions: Record<string, unknown> }).extensions = {
      ...field.extensions,
      ...extensions
    };
  }
  if (!resolve) {
    if (subscription) {
      throw new TypeError(
        `${where}: "${key}" needs a resolve: a function returning an AsyncIterable`
      );
    }
    // The default resolver stays; wrapDefaults wraps it if middleware names it.
    return;
  }
  const chain = chainFor(appMiddleware, owner, type.name, fieldName);
  const bypass = attach.bypass.get(key) ?? NO_BYPASS;
  if (subscription) {
    // Each event is the field's value; middleware runs once, on subscribe.
    field.subscribe = wrap(resolve, chain, bypass);
    field.resolve = (event) => event;
    return;
  }
  field.resolve = wrap(resolve, chain, bypass);
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
// internal-value lookup lazily. Defaults are another matter (`coerceDefaults`).
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

// graphql coerced every default when the schema was built, before enums had
// internal values and scalars their implementations: `role: Role = ADMIN`
// would reach resolvers as "ADMIN", not the internal value. Coerce them again
// from their SDL literals. Input types first, since an input default (`= {}`)
// fills in its fields' defaults.
function coerceDefaults(schema: GraphQLSchema): void {
  const done = new Set<GraphQLInputObjectType>();
  const recoerce = (input: GraphQLArgument | GraphQLInputField): void => {
    const named = getNamedType(input.type);
    if (isInputObjectType(named)) coerceInputType(named);
    const literal = input.astNode?.defaultValue;
    if (!literal) return;
    const value = valueFromAST(literal, input.type);
    if (value !== undefined) input.defaultValue = value;
  };
  const coerceInputType = (type: GraphQLInputObjectType): void => {
    if (done.has(type)) return;
    done.add(type);
    for (const field of Object.values(type.getFields())) recoerce(field);
  };
  for (const type of Object.values(schema.getTypeMap())) {
    if (isInputObjectType(type)) coerceInputType(type);
    if (!isObjectType(type) && !isInterfaceType(type)) continue;
    for (const field of Object.values(type.getFields())) {
      for (const arg of field.args) recoerce(arg);
    }
  }
  for (const directive of schema.getDirectives()) {
    for (const arg of directive.args) recoerce(arg);
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
      const reaches =
        key === "*"
          ? [...declared].some(
              ([k, id]) => owner.canTarget(id) && k.startsWith(`${type}.`)
            )
          : owner.canTarget(declared.get(`${type}.${key}`) ?? "") &&
            !key.startsWith("__");
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
  declared: ReadonlyMap<string, string>,
  bypass: Bypass
): void {
  const byId = new Map(all.map((o) => [o.id, o]));
  const targets = new Set<string>();
  for (const map of [app, ...all.map((o) => o.middleware)]) {
    for (const [type, fields] of Object.entries(map)) {
      for (const key of Object.keys(fields ?? {})) {
        if (type !== "*" && key !== "*") targets.add(`${type}.${key}`);
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
      chainFor(app, owner, typeName, fieldName),
      bypass.get(target) ?? NO_BYPASS
    );
  }
}

/** Middleware wraps the resolvers modules define, plus any field it names explicitly. */
export function olio(config: OlioConfig): OlioApp {
  const all = owners(config.modules);
  const { schema, ownership, bypass } = compose(all, config.directives);
  const declared = declarations(ownership);
  const appMiddleware = (config.middleware ?? {}) as MiddlewareMap;
  checkAppMiddleware(schema, appMiddleware);

  const resolved = new Set<string>();
  const enums = new Set<GraphQLEnumType>();
  for (const owner of all) {
    checkOwnerMiddleware(schema, owner, declared);
    applyResolvers({
      schema,
      owner,
      appMiddleware,
      declared,
      bypass,
      resolved,
      enums
    });
  }
  checkEnums(enums);
  coerceDefaults(schema);
  wrapDefaults(schema, appMiddleware, all, declared, bypass);

  return { schema, modules: config.modules };
}
