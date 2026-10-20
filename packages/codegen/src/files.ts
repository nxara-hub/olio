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

import { parse, print, Source, type DocumentNode } from "graphql";

import { compile } from "./codegen.js";
import { bold, count, cyan, dim, green, red, row, shortPath } from "./log.js";
import {
  BUILTIN_SCALARS,
  type CodegenModule,
  type CodegenOptions
} from "./types.js";

const COMMENT = /#[^\n]*/g;

/** A file with only whitespace and `#` comments has no definitions to emit. */
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

interface ModuleDefinition {
  id: string;
  directory: string;
  files: string[];
  typeDefs: DocumentNode[];
}

/** Glob for a module's typeDefs, resolved relative to its directory. */
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

/** Discover direct child directories of `modules` as modules. */
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

  for (const id of childDirs) {
    const directory = join(root, id);
    const files = await matchFiles(directory, patterns);
    if (files.length === 0) {
      throw new Error(
        `Module "${id}" contains no matching typeDefs for "${patterns.join('", "')}"`
      );
    }

    const loaded: string[] = [];
    const docs: DocumentNode[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (isEmptySDL(source)) {
        onSkip(file);
        continue;
      }
      loaded.push(file);
      docs.push(parseFile(file, source));
    }

    modules.push({ id, directory, files: loaded, typeDefs: docs });
  }

  return modules;
}

/** Write `content`, skipping the write when the file already holds it. */
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

/** Watch the modules root and re-run `onChange` (debounced) on any change. */
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

/** Discover → parse → transform → generate → write, plus optional watch/schema. */
export async function codegen(options: CodegenOptions): Promise<void> {
  const {
    modules: modulesDir,
    typeDefs,
    output,
    withDirectives = [],
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
          .map((m) => `${m.id} ${dim(count(m.files.length, "file"))}`)
          .join(dim(" · "))
      )
    );
    if (withDirectives.length > 0) {
      log(row("directives", withDirectives.map((d) => `@${d.name}`).join(" ")));
    }

    const codegenModules: CodegenModule[] = modules.map((m) => ({
      name: m.id,
      typeDefs: m.typeDefs
    }));
    const compiled = compile(codegenModules, { withDirectives });
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
