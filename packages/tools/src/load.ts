import { glob, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { LoadedResolvers, OlioFeature, OlioModule } from "@nxlab/olio";
import { parse, Source, type DocumentNode } from "graphql";

export type TypeSource = string | DocumentNode;

/** A glob string, or a `file:` URL such as `new URL("*.gql", import.meta.url)`. */
export type Pattern = string | URL;

export type ResolverMap = Record<string, object>;

const COMMENT = /#[^\n]*/g;

// Sorted for stable output. A pattern matching nothing throws, so a typo
// can't load an empty module.
async function matchFiles(patterns: readonly Pattern[]): Promise<string[]> {
  const paths = patterns.map((p) =>
    typeof p === "string" ? p : fileURLToPath(p)
  );
  const matches = await Promise.all(
    paths.map((path) => Array.fromAsync(glob(path)))
  );
  for (const [i, found] of matches.entries()) {
    if (found.length === 0) throw new Error(`No files match "${paths[i]}"`);
  }
  return [...new Set(matches.flat())].sort();
}

// With its file name, so errors point at `file:line:column`.
function parseFile(source: string, file: string): DocumentNode {
  try {
    return parse(new Source(source, file));
  } catch (error) {
    const { message, locations } = error as {
      message: string;
      locations?: readonly { line: number; column: number }[];
    };
    const loc = locations?.[0];
    throw new Error(
      `${loc ? `${file}:${loc.line}:${loc.column}` : file}: ${message}`
    );
  }
}

async function loadFile(file: string): Promise<DocumentNode | undefined> {
  const ext = extname(file);
  if (ext === ".graphql" || ext === ".gql") {
    const source = await readFile(file, "utf8");
    return source.replace(COMMENT, "").trim() === ""
      ? undefined
      : parseFile(source, file);
  }
  if (ext === ".ts" || ext === ".js") {
    const mod = (await import(pathToFileURL(file).href)) as {
      default?: TypeSource;
    };
    if (!mod.default) return undefined;
    return typeof mod.default === "string"
      ? parseFile(mod.default, file)
      : mod.default;
  }
  throw new Error(
    `Cannot load type definitions from "${file}" (unknown extension)`
  );
}

/** `.ts`/`.js` files default-export SDL or a DocumentNode. Files holding only comments are skipped. */
export async function loadTypeDefs(
  ...patterns: Pattern[]
): Promise<DocumentNode[]> {
  const loaded = await Promise.all((await matchFiles(patterns)).map(loadFile));
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
      for (const [field, resolver] of Object.entries(value)) {
        claim(`${type}.${field}`, file);
        target[field] = resolver;
      }
      merged[type] = target;
    }
  }
  // Each file is typed where it's written, with olio's builders.
  return merged as LoadedResolvers;
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
