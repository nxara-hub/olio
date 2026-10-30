// Every package to one version (lockstep: codegen's output is olio's input
// contract, so mixed versions break), committed and tagged. Pushing the tag
// publishes (.github/workflows/release.yml).
//   bun run release 0.3.0
import { globSync, readFileSync, writeFileSync } from "node:fs";

import { $ } from "bun";

const version = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  throw new Error(
    `Usage: bun run release <version>, e.g. 0.3.0 (got "${version}")`
  );
}
if ((await $`git branch --show-current`.text()).trim() !== "main") {
  throw new Error("Release from main");
}
if ((await $`git status --porcelain`.text()).trim()) {
  throw new Error("Commit or stash your changes first");
}

for (const file of globSync("packages/*/package.json")) {
  const json = readFileSync(file, "utf8");
  writeFileSync(
    file,
    json.replace(/"version": "[^"]*"/, `"version": "${version}"`)
  );
}
// bun.lock records workspace versions; CI installs with --frozen-lockfile.
await $`bun install --lockfile-only`;
await $`git commit --quiet -am ${`release: v${version}`}`;
await $`git tag v${version}`;

console.log(`Tagged v${version}. Publish it: git push origin main v${version}`);
