import { pathToFileURL } from "node:url";

import type {
  LoadedEnums,
  LoadedResolvers,
  OlioFeature,
  OlioModule,
  Pattern,
  ResolverMap
} from "@nxara/olio-core";
import { loadGraphQLFile, matchFiles } from "@nxara/olio-core/files";
import type { DocumentNode } from "graphql";

export type { Pattern, ResolverMap, TypeSource } from "@nxara/olio-core";

/** `.ts`/`.js` files default-export SDL or a DocumentNode. Files holding only comments are skipped. */
export async function loadTypeDefs(
  ...patterns: Pattern[]
): Promise<DocumentNode[]> {
  const loaded = await Promise.all(
    (await matchFiles(patterns)).map(loadGraphQLFile)
  );
  return loaded.filter((doc): doc is DocumentNode => doc !== undefined);
}

const isPlainObject = (value: object): boolean =>
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Every named object export is a type (`export const User = ...`). Plain
 * objects for one type merge across files; a field defined twice throws.
 * Anything else, such as a `GraphQLScalarType`, is used as it is.
 */
export async function loadResolvers(
  ...patterns: Pattern[]
): Promise<LoadedResolvers> {
  // Each file is typed where it's written, with olio's builders.
  return (await loadMaps(patterns)) as LoadedResolvers;
}

/**
 * Every named export is an enum's internal values, typed where it's written
 * (`export const Role = resolvers.users.Role({ ADMIN: 1 })`), for a module's
 * `enums`. Unlike an inline map, it isn't checked for every enum the module
 * needs: a missing one fails per query, with an error naming it.
 */
export async function loadEnums(...patterns: Pattern[]): Promise<LoadedEnums> {
  return (await loadMaps(patterns)) as LoadedEnums;
}

async function loadMaps(patterns: readonly Pattern[]): Promise<ResolverMap> {
  const files = await matchFiles(patterns);
  const modules = await Promise.all(
    files.map(
      async (file) =>
        [
          file,
          (await import(pathToFileURL(file).href)) as Record<string, unknown>
        ] as const
    )
  );

  const merged: ResolverMap = {};
  const origin = new Map<string, string>();
  const claim = (key: string, file: string): void => {
    const first = origin.get(key);
    if (first) {
      throw new Error(`Resolver "${key}" is defined in ${first} and ${file}`);
    }
    origin.set(key, file);
  };

  for (const [file, exports] of modules) {
    for (const [type, value] of Object.entries(exports)) {
      if (type === "default" || typeof value !== "object" || value === null) {
        continue;
      }
      if (!isPlainObject(value)) {
        claim(type, file);
        merged[type] = value;
        continue;
      }
      const target = (merged[type] ?? {}) as Record<string, unknown>;
      if (!isPlainObject(target)) claim(type, file);
      if (!origin.has(type)) origin.set(type, file);
      for (const [field, resolver] of Object.entries(value)) {
        claim(`${type}.${field}`, file);
        target[field] = resolver;
      }
      merged[type] = target;
    }
  }
  // olio reads it to name the file in its errors; Symbol.for, so it matches
  // across copies of the packages.
  Object.defineProperty(merged, Symbol.for("nxara.origin"), { value: origin });
  return merged;
}

function hasParts(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    Array.isArray(v.typeDefs) &&
    Array.isArray(v.resolvers) &&
    typeof v.middleware === "object"
  );
}

// Recognised by shape, so any copy of olio works.
const isModule = (value: unknown): value is OlioModule =>
  hasParts(value) && Array.isArray(value.features);

const isFeature = (value: unknown): value is OlioFeature =>
  hasParts(value) && typeof value.module === "string";

async function collect<T>(
  patterns: readonly Pattern[],
  is: (value: unknown) => value is T,
  what: string
): Promise<T[]> {
  const files = await matchFiles(patterns);
  const loaded = await Promise.all(
    files.map(async (file) => {
      const exports = (await import(pathToFileURL(file).href)) as Record<
        string,
        unknown
      >;
      const found = Object.values(exports).filter(is);
      if (found.length === 0) throw new Error(`${file} exports no ${what}`);
      return found;
    })
  );
  return loaded.flat();
}

/** Every exported module, in file order. A file that exports none throws. */
export const loadModules = (...patterns: Pattern[]): Promise<OlioModule[]> =>
  collect(patterns, isModule, "module");

/** Every exported feature, in file order. A file that exports none throws. */
export const loadFeatures = (...patterns: Pattern[]): Promise<OlioFeature[]> =>
  collect(patterns, isFeature, "feature");
