import { existsSync, watch as fsWatch } from "node:fs";
import {
  glob,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { loadGraphQLFile, matchFiles } from "@nxara/olio-core/files";
import {
  buildASTSchema,
  buildClientSchema,
  getIntrospectionQuery,
  printSchema,
  print,
  type DocumentNode,
  type GraphQLSchema,
  type IntrospectionQuery
} from "graphql";

import { compile } from "./codegen.js";
import { emitClient } from "./emit-client.js";
import { bold, count, cyan, dim, green, red, row, shortPath } from "./log.js";
import {
  BUILTIN_SCALARS,
  HEADER,
  type ClientCodegenOptions,
  type CodegenModule,
  type CodegenOptions
} from "./types.js";

interface Part {
  id: string;
  directory: string;
  files: string[];
  typeDefs: DocumentNode[];
}

interface ModuleDefinition {
  id: string;
  parts: Part[];
  features: string[];
}

// Relative to one directory, and empty is an answer: it's how a subfolder
// shows it isn't a feature.
async function filesIn(
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

// Only a file with codegen's header is its own: a file of the user's that
// shares the typeDefsOutput name is SDL to read, and never overwritten.
async function isOwnOutput(file: string): Promise<boolean> {
  const head = await readFile(file, "utf8").catch(() => "");
  return head.startsWith(HEADER.split("\n")[0] ?? HEADER);
}

async function withoutOwnOutput(
  files: readonly string[],
  generated: string | undefined
): Promise<string[]> {
  const kept: string[] = [];
  for (const file of files) {
    if (basename(file) === generated && (await isOwnOutput(file))) continue;
    kept.push(file);
  }
  return kept;
}

async function discoverModules(
  modulesDir: string,
  typeDefs: string | string[],
  onSkip: (file: string) => void,
  // codegen's own typeDefsOutput files, which a broad pattern would match.
  generated: string | undefined
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

  const load = async (
    id: string,
    directory: string,
    files: readonly string[]
  ): Promise<Part> => {
    const part: Part = { id, directory, files: [], typeDefs: [] };
    for (const file of files) {
      const document = await loadGraphQLFile(file);
      if (!document) {
        onSkip(file);
        continue;
      }
      part.files.push(file);
      part.typeDefs.push(document);
    }
    return part;
  };

  for (const id of childDirs) {
    const directory = join(root, id);
    const files = await withoutOwnOutput(
      await filesIn(directory, patterns),
      generated
    );
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
      const own = await withoutOwnOutput(
        await filesIn(join(directory, name), patterns),
        generated
      );
      if (own.length > 0) features.push({ name, files: own });
    }
    const inFeature = new Set(
      features.flatMap((f) => f.files.map((file) => resolve(file)))
    );
    const rootFiles = files.filter((file) => !inFeature.has(resolve(file)));

    modules.push({
      id,
      parts: [
        await load(id, directory, rootFiles),
        ...(await Promise.all(
          features.map((f) =>
            load(`${id}/${f.name}`, join(directory, f.name), f.files)
          )
        ))
      ],
      features: features.map((f) => f.name)
    });
  }

  return modules;
}

// Parsed with each file's path as its source name, so olio's errors point at
// the .gql file rather than at this one. A .gql file keeps its own text, so
// line and column match it; SDL from a .ts file is printed.
async function typeDefsModule(part: Part, root: string): Promise<string> {
  const documents = await Promise.all(
    part.files.map(async (file, i) => {
      const text = /\.(gql|graphql)$/.test(file)
        ? await readFile(file, "utf8")
        : print(part.typeDefs[i] as DocumentNode);
      const name = relative(root, file);
      return `  parse(new Source(${JSON.stringify(text)}, ${JSON.stringify(name)}))`;
    })
  );
  return (
    [
      HEADER,
      'import { parse, Source, type DocumentNode } from "graphql";',
      `const typeDefs: DocumentNode[] = [${documents.length > 0 ? `\n${documents.join(",\n")}\n` : ""}];`,
      "export default typeDefs;"
    ].join("\n\n") + "\n"
  );
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

interface WatchTarget {
  dir: string;
  recursive: boolean;
  /** Only this file in `dir` counts (a schema file, watched through its folder). */
  only?: string;
}

// Watches folders rather than files: editors that save by replacing a file
// would end a watch on the file itself.
function rerunOnChange(
  targets: readonly WatchTarget[],
  skip: ReadonlySet<string>,
  run: () => Promise<void>,
  log: (message: string) => void
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = (path: string): void => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      log(`\n${cyan("↻")} ${shortPath(path)}`);
      try {
        await run();
      } catch (error) {
        // Keep watching: the next save may fix it.
        console.error(
          `  ${red("✗")} ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }, 50);
  };
  for (const { dir, recursive, only } of targets) {
    fsWatch(dir, { recursive }, (_event, filename) => {
      const path = filename ? join(dir, filename) : dir;
      if (skip.has(path) || (only && path !== only)) return;
      changed(path);
    });
  }
  log(
    dim(
      `\n  watching ${targets.map((t) => shortPath(t.only ?? t.dir)).join(", ")} for changes`
    )
  );
  return new Promise<void>(() => {
    // Keep the process alive; the watchers close when the process exits.
  });
}

// The folder a glob starts from: its segments up to the first wildcard.
function globBase(pattern: string): string {
  const parts = pattern.split("/");
  const wild = parts.findIndex((part) => /[*?[{]/.test(part));
  return wild === -1 ? dirname(pattern) : parts.slice(0, wild).join("/") || "/";
}

export async function codegen(options: CodegenOptions): Promise<void> {
  const { typeDefs, directives = [], watch = false, clear = false } = options;
  const { logs = true } = options;
  const at = (path: string): string => resolve(options.root ?? "", path);
  const modulesDir = at(options.modules);
  const output = at(options.output);
  const schemaOutput = options.schemaOutput && at(options.schemaOutput);
  const { typeDefsOutput } = options;
  // typeDefsOutput files join as they're written, so the watcher ignores every
  // write codegen makes.
  const ownWrites = new Set([output, ...(schemaOutput ? [schemaOutput] : [])]);

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
    const modules = await discoverModules(
      modulesDir,
      typeDefs,
      (file) => log(row("skipped", dim(`${shortPath(file)} (empty)`))),
      typeDefsOutput
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
    if (schemaOutput) {
      written(
        schemaOutput,
        // Printed from the built schema: each type once, its extensions
        // merged in, so registries, linters and diff tools read it as is.
        await writeOutput(
          schemaOutput,
          `${printSchema(compiled.schema)}\n`,
          clear
        )
      );
    }
    if (typeDefsOutput) {
      const parts = modules.flatMap((m) => m.parts);
      let changed = 0;
      for (const part of parts) {
        const file = join(part.directory, typeDefsOutput);
        if (existsSync(file) && !(await isOwnOutput(file))) {
          throw new Error(
            `${relative(at(""), file)} is not a file codegen wrote; pick another typeDefsOutput name`
          );
        }
        ownWrites.add(file);
        const code = await typeDefsModule(part, at(""));
        if (await writeOutput(file, code, clear)) changed += 1;
      }
      log(
        `  ${changed > 0 ? green("✓") : dim("·")} ${typeDefsOutput}  ${dim(
          `${count(parts.length, "folder")}${changed > 0 ? "" : ", unchanged"}`
        )}`
      );
    }
    log(dim(`  done in ${Math.round(performance.now() - started)}ms`));
  };

  log(`${bold("@nxara/olio-codegen")} ${dim(watch ? "watch" : "generate")}`);
  await run();
  if (!watch) return;
  await rerunOnChange(
    [{ dir: modulesDir, recursive: true }],
    ownWrites,
    run,
    log
  );
}

async function loadSchema(
  source: string,
  headers: Record<string, string> = {}
): Promise<GraphQLSchema> {
  if (!/^https?:\/\//.test(source)) {
    const document = await loadGraphQLFile(source);
    if (!document) throw new Error(`Schema file "${source}" is empty`);
    return buildASTSchema(document);
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
  const files = await matchFiles([patterns].flat());
  const documents = await Promise.all(files.map(loadGraphQLFile));
  return documents.filter((d): d is DocumentNode => d !== undefined);
}

/**
 * Typed operations for `@nxara/olio-client`, from `.graphql` files and the
 * schema: a schema file, or the running server's URL.
 */
export async function codegenClient(
  options: ClientCodegenOptions
): Promise<void> {
  const { logs = true, watch = false } = options;
  const at = (path: string): string => resolve(options.root ?? "", path);
  const output = at(options.output);
  const remote = /^https?:\/\//.test(options.schema);
  const schema = remote ? options.schema : at(options.schema);
  const documents = [options.documents].flat().map(at);
  const log = logs
    ? (message: string): void => {
        console.log(message);
      }
    : (_message: string): void => {};

  const run = async (): Promise<void> => {
    const loaded = await loadSchema(schema, options.headers);
    const code = emitClient(loaded, await loadDocuments(documents));
    const changed = await writeOutput(output, code, false);
    log(
      `  ${changed ? green("✓") : dim("·")} ${shortPath(output)}${changed ? "" : `  ${dim("unchanged")}`}`
    );
  };
  log(
    `${bold("@nxara/olio-codegen")} ${dim(watch ? "client watch" : "client")}`
  );
  await run();
  if (!watch) return;
  // A server URL isn't watched: rerun, or save an operation, after it changes.
  const targets: WatchTarget[] = documents.map((pattern) => ({
    dir: globBase(pattern),
    recursive: true
  }));
  if (!remote)
    targets.push({ dir: dirname(schema), recursive: false, only: schema });
  await rerunOnChange(targets, new Set([output]), run, log);
}
