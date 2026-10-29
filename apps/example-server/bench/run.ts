// What @nxara/olio-tools' load functions cost: the example app as it is
// (src/index.ts) against the same app wired by hand (bench/wired.ts).
//   bun bench/run.ts
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = join(import.meta.dirname, "..");
const variants = {
  loaded: join(root, "src/index.ts"),
  wired: join(root, "bench/wired.ts")
} as const;
type Variant = keyof typeof variants;

const RUNS = 20;
const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};
const run = (cmd: string[], cwd = root) => {
  const started = performance.now();
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    ms: performance.now() - started,
    ok: result.exitCode === 0,
    out: result.stdout.toString(),
    err: result.stderr.toString()
  };
};

// A fresh process per sample: the time to import the app and build its
// schema, then memory once garbage is collected.
const probe = (entry: string) => `
  const started = performance.now();
  await import(${JSON.stringify(entry)});
  const ms = performance.now() - started;
  Bun.gc(true);
  const { rss, heapUsed } = process.memoryUsage();
  console.log(JSON.stringify({ ms, rss, heapUsed }));
`;
const samples: Record<
  Variant,
  { ms: number; rss: number; heapUsed: number }[]
> = { loaded: [], wired: [] };
for (let i = 0; i < RUNS; i++) {
  // Alternated, so drift on the machine hits both alike.
  for (const variant of ["loaded", "wired"] as const) {
    const { out, ok, err } = run(["bun", "-e", probe(variants[variant])]);
    if (!ok) throw new Error(`${variant}: ${err}`);
    samples[variant].push(JSON.parse(out.trim().split("\n").at(-1) ?? "{}"));
  }
}

// Type-checking the same resolver files, plus each variant's own wiring.
const tsc = join(root, "../../node_modules/.bin/tsc");
const configs: Record<Variant, string[]> = {
  loaded: ["../src/index.ts", "../src/modules/**/*.ts", "../src/types.d.ts"],
  wired: ["wired.ts", "gql.d.ts", "../src/types.d.ts"]
};
const typeCheck: Record<Variant, number[]> = { loaded: [], wired: [] };
for (const variant of ["loaded", "wired"] as const) {
  const config = join(root, `bench/tsconfig.${variant}.json`);
  writeFileSync(
    config,
    JSON.stringify({ extends: "../tsconfig.json", include: configs[variant] })
  );
  try {
    for (let i = 0; i < 5; i++) {
      const result = run([tsc, "-p", config]);
      if (!result.ok) throw new Error(`${variant} type-check: ${result.out}`);
      typeCheck[variant].push(result.ms);
    }
  } finally {
    rmSync(config);
  }
}

// One bundle each for Node, run from a directory without the sources.
const out = mkdtempSync(join(tmpdir(), "nxara-bench-"));
const bundles: Record<Variant, { bytes: number; gzip: number; runs: string }> =
  {} as never;
try {
  for (const variant of ["loaded", "wired"] as const) {
    const file = join(out, `${variant}.js`);
    const built = run([
      "bun",
      "build",
      variants[variant],
      "--target=node",
      `--outfile=${file}`
    ]);
    if (!built.ok) throw new Error(`${variant} bundle: ${built.err}`);
    const bytes = statSync(file).size;
    const gzip = gzipSync(readFileSync(file)).length;
    const started = run(
      [
        "node",
        "-e",
        `import(${JSON.stringify(file)}).then(() => console.log("ok"))`
      ],
      out
    );
    const error = started.err.match(/Error: ([^\n]+)/)?.[1] ?? "failed";
    bundles[variant] = {
      bytes,
      gzip,
      runs: started.ok ? "yes" : `no: ${error}`
    };
  }
} finally {
  rmSync(out, { recursive: true });
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;
const row = (variant: Variant): string => {
  const s = samples[variant];
  const b = bundles[variant];
  return `| ${variant} | ${median(s.map((x) => x.ms)).toFixed(1)} ms | ${mb(median(s.map((x) => x.heapUsed)))} | ${mb(median(s.map((x) => x.rss)))} | ${(median(typeCheck[variant]) / 1000).toFixed(2)} s | ${kb(b.bytes)} (${kb(b.gzip)} gzip) | ${b.runs} |`;
};
console.log(
  [
    `Bun ${Bun.version}, ${RUNS} fresh processes per variant (medians); type-check: tsc, median of 5.`,
    "",
    "| Variant | Import + schema | Heap | RSS | Type-check | Node bundle | Bundle runs alone |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    row("loaded"),
    row("wired")
  ].join("\n")
);
