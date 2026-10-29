import { globSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse, Source, type DocumentNode } from "graphql";

import type { Pattern, TypeSource } from "./index.js";

const COMMENT = /#[^\n]*/g;

// Sorted for stable output. A pattern matching nothing throws, so a typo
// can't load an empty module. Synchronous: this runs while the app starts,
// often one module after another, and each async glob waits about 1 ms.
export async function matchFiles(
  patterns: readonly Pattern[]
): Promise<string[]> {
  const paths = patterns.map((p) =>
    typeof p === "string" ? p : fileURLToPath(p)
  );
  const matches = paths.map((path) => globSync(path));
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

/**
 * One GraphQL file (SDL or operations): `.graphql` / `.gql`, or a `.ts` /
 * `.js` module whose default export is GraphQL source or a DocumentNode.
 * `undefined` for a file with only comments (or no default export), so a
 * placeholder doesn't fail the load.
 */
export async function loadGraphQLFile(
  file: string
): Promise<DocumentNode | undefined> {
  const ext = extname(file);
  if (ext === ".graphql" || ext === ".gql") {
    const source = readFileSync(file, "utf8");
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
  throw new Error(`Cannot load GraphQL from "${file}" (unknown extension)`);
}
