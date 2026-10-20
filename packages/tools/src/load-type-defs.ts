import { glob, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse, Source, type DocumentNode } from "graphql";

export type TypeSource = string | DocumentNode;

/** A glob string, or a `file:` URL such as `new URL("*.gql", import.meta.url)`. */
export type Pattern = string | URL;

/** A resolver map: type name -> its field resolvers (or a scalar). */
export type ResolverMap = Record<string, object>;

const COMMENT = /#[^\n]*/g;

/**
 * Every file the patterns match, deduped and sorted for stable output. A
 * pattern that matches nothing throws, so a typo can't load an empty module.
 */
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

/** Parse SDL with its file name, so errors point at `file:line:column`. */
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

/** One file as a document, or undefined when it has nothing to add. */
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

/**
 * Load type definitions from `.graphql`/`.gql` files and from `.ts`/`.js`
 * modules (their default export: SDL or a DocumentNode). Files holding only
 * comments are skipped.
 */
export async function loadTypeDefs(
  ...patterns: Pattern[]
): Promise<DocumentNode[]> {
  const loaded = await Promise.all((await matchFiles(patterns)).map(loadFile));
  return loaded.filter((doc): doc is DocumentNode => doc !== undefined);
}

const isPlainObject = (value: object): boolean =>
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Load resolvers from `.ts`/`.js` modules: every named object export is a type
 * (`export const Query = ...`, `export const User = ...`). Plain objects for
 * the same type merge across files; a field defined twice throws. Anything
 * else, such as a `GraphQLScalarType`, is used as it is.
 */
export async function loadResolvers(
  ...patterns: Pattern[]
): Promise<ResolverMap> {
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
  /** `Type.field` (or `Type`) -> the file that defined it. */
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
  return merged;
}
