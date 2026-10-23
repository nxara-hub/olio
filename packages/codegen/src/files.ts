import { existsSync, watch as fsWatch } from "node:fs";
import {
  glob,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  buildASTSchema,
  buildClientSchema,
  getIntrospectionQuery,
  parse,
  print,
  Source,
  type DocumentNode,
  type GraphQLSchema,
  type IntrospectionQuery
} from "graphql";

import { compile } from "./codegen.js";
import { emitClient } from "./emit-client.js";
import { bold, count, cyan, dim, green, red, row, shortPath } from "./log.js";
import {
  BUILTIN_SCALARS,
  type ClientCodegenOptions,
  type CodegenModule,
  type CodegenOptions
} from "./types.js";

const COMMENT = /#[^\n]*/g;

function isEmptySDL(source: string): boolean {
  return source.replace(COMMENT, "").trim() === "";
}

function parseFile(filePath: string, source: string): DocumentNode {
  try {
    return parse(new Source(source, filePath));
  } catch (error) {
    const err = error as {
      message: string;
      locations?: readonly { line: number; column: number }[];
    };
    const loc = err.locations?.[0];
    const where = loc ? `${filePath}:${loc.line}:${loc.column}` : filePath;
    throw new Error(`Failed to parse ${where}: ${err.message}`);
  }
}

interface Part {
  id: string;
  files: string[];
  typeDefs: DocumentNode[];
}

interface ModuleDefinition {
  id: string;
  parts: Part[];
  features: string[];
}

async function matchFiles(
  moduleDir: string,
  patterns: readonly string[]
): Promise<string[]> {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const pattern of patterns) {
    for await (const file of glob(join(moduleDir, pattern))) {
      const absolute = resolve(file);
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      files.push(file);
    }
  }
  return files.sort();
}

async function discoverModules(
  modulesDir: string,
  typeDefs: string | string[],
  onSkip: (file: string) => void
): Promise<ModuleDefinition[]> {
  const root = resolve(modulesDir);
  if (!existsSync(root)) {
    throw new Error(`Modules directory does not exist: ${root}`);
  }

  const entries = await readdir(root, { withFileTypes: true });
  const childDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (childDirs.length === 0) {
    throw new Error(`No module directories found in ${root}`);
  }

  const patterns = Array.isArray(typeDefs) ? typeDefs : [typeDefs];
  const modules: ModuleDefinition[] = [];

  const load = async (id: string, files: readonly string[]): Promise<Part> => {
    const part: Part = { id, files: [], typeDefs: [] };
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (isEmptySDL(source)) {
        onSkip(file);
        continue;
      }
      part.files.push(file);
      part.typeDefs.push(parseFile(file, source));
    }
    return part;
  };

  for (const id of childDirs) {
    const directory = join(root, id);
    const files = await matchFiles(directory, patterns);
    if (files.length === 0) {
      throw new Error(
        `Module "${id}" contains no matching typeDefs for "${patterns.join('", "')}"`
      );
    }

    // A feature is a direct subfolder in which the patterns find files of
    // their own; everything else is the module's own SDL.
    const subdirs = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const features: { name: string; files: string[] }[] = [];
    for (const name of subdirs) {
      const own = await matchFiles(join(directory, name), patterns);
      if (own.length > 0) features.push({ name, files: own });
    }
    const inFeature = new Set(
      features.flatMap((f) => f.files.map((file) => resolve(file)))
    );
    const rootFiles = files.filter((file) => !inFeature.has(resolve(file)));

    modules.push({
      id,
      parts: [
        await load(id, rootFiles),
        ...(await Promise.all(
          features.map((f) => load(`${id}/${f.name}`, f.files))
        ))
      ],
      features: features.map((f) => f.name)
    });
  }

  return modules;
}

// Unchanged content isn't rewritten, so watchers and builds see no change.
async function writeOutput(
  output: string,
  content: string,
  clear: boolean
): Promise<boolean> {
  const current = await readFile(output, "utf8").catch(() => undefined);
  if (current === content) return false;
  if (clear) await rm(output, { force: true });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content);
  return true;
}

function watchModules(
  modulesDir: string,
  onChange: (changedPath: string) => Promise<void>
): Promise<void> {
  const root = resolve(modulesDir);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (changedPath: string): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void onChange(changedPath), 50);
  };

  fsWatch(root, { recursive: true }, (_event, filename) => {
    debounced(filename ? join(root, filename) : root);
  });
  return new Promise<void>(() => {
    // Keep the process alive; the watcher closes when the process exits.
  });
}

export async function codegen(options: CodegenOptions): Promise<void> {
  const {
    modules: modulesDir,
    typeDefs,
    output,
    directives = [],
    schema,
    watch = false,
    clear = false,
    logs = true
  } = options;

  const log = logs
    ? (message: string): void => {
        console.log(message);
      }
    : (_message: string): void => {};

  const written = (path: string, changed: boolean, detail = ""): void =>
    log(
      changed
        ? `  ${green("✓")} ${shortPath(path)}${detail && `  ${dim(detail)}`}`
        : `  ${dim("·")} ${shortPath(path)}  ${dim("unchanged")}`
    );

  const run = async (): Promise<void> => {
    const started = performance.now();
    const modules = await discoverModules(modulesDir, typeDefs, (file) =>
      log(row("skipped", dim(`${shortPath(file)} (empty)`)))
    );
    log(
      row(
        "modules",
        modules
          .map((m) => {
            const files = m.parts.reduce((sum, p) => sum + p.files.length, 0);
            const features = m.features.length
              ? dim(` [${m.features.join(", ")}]`)
              : "";
            return `${m.id}${features} ${dim(count(files, "file"))}`;
          })
          .join(dim(" · "))
      )
    );
    if (directives.length > 0) {
      log(row("directives", directives.map((d) => `@${d.name}`).join(" ")));
    }

    const codegenModules: CodegenModule[] = modules.flatMap((m) =>
      m.parts.map((p) => ({ id: p.id, typeDefs: p.typeDefs }))
    );
    const compiled = compile(codegenModules, { directives });
    const types = Object.keys(compiled.schema.getTypeMap()).filter(
      (name) => !name.startsWith("__") && !BUILTIN_SCALARS.has(name)
    ).length;
    written(
      output,
      await writeOutput(output, compiled.code, clear),
      `${count(types, "type")} · ${count(modules.length, "module")}`
    );
    if (schema) {
      written(
        schema,
        await writeOutput(schema, print(compiled.document), clear)
      );
    }
    log(dim(`  done in ${Math.round(performance.now() - started)}ms`));
  };

  log(`${bold("@nxlab/codegen")} ${dim(watch ? "watch" : "generate")}`);
  await run();
  if (!watch) return;

  log(dim(`\n  watching ${shortPath(resolve(modulesDir))} for changes`));
  await watchModules(modulesDir, async (changedPath) => {
    log(`\n${cyan("↻")} ${shortPath(changedPath)}`);
    try {
      await run();
    } catch (error) {
      // Keep watching: the next save may fix it.
      console.error(
        `  ${red("✗")} ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

async function loadSchema(
  source: string,
  headers: Record<string, string> = {}
): Promise<GraphQLSchema> {
  if (!/^https?:\/\//.test(source)) {
    return buildASTSchema(parseFile(source, await readFile(source, "utf8")));
  }
  const response = await fetch(source, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...headers
    },
    body: JSON.stringify({ query: getIntrospectionQuery() })
  });
  const body = (await response.json().catch(() => undefined)) as
    | { data?: IntrospectionQuery; errors?: { message: string }[] }
    | undefined;
  if (!body?.data) {
    const reason =
      body?.errors?.map((e) => e.message).join("; ") ??
      `HTTP ${response.status}`;
    throw new Error(`Couldn't introspect ${source}: ${reason}`);
  }
  return buildClientSchema(body.data);
}

async function loadDocuments(
  patterns: string | string[]
): Promise<DocumentNode[]> {
  const documents: DocumentNode[] = [];
  for (const pattern of [patterns].flat()) {
    const files = (await Array.fromAsync(glob(pattern))).sort();
    if (files.length === 0) throw new Error(`No files match "${pattern}"`);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (!isEmptySDL(source)) documents.push(parseFile(file, source));
    }
  }
  return documents;
}

/**
 * Typed operations for `@nxlab/client`, from `.graphql` files and the
 * schema: a schema file, or the running server's URL.
 */
export async function codegenClient(
  options: ClientCodegenOptions
): Promise<void> {
  const { output, logs = true } = options;
  const schema = await loadSchema(options.schema, options.headers);
  const code = emitClient(schema, await loadDocuments(options.documents));
  const changed = await writeOutput(output, code, false);
  if (logs) {
    console.log(
      `${bold("@nxlab/codegen")} ${dim("client")}\n  ${changed ? green("✓") : dim("·")} ${shortPath(output)}${changed ? "" : `  ${dim("unchanged")}`}`
    );
  }
}
