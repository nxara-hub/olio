// Every package to one version (lockstep: codegen's output is olio's input
// contract, so mixed versions break), committed on a release branch and opened
// as a PR, since main only takes PRs. Once it's merged, `bun run release:tag`
// tags main, and pushing that tag publishes (.github/workflows/release.yml).
//   bun run release 0.3.0
import { globSync, readFileSync, writeFileSync } from "node:fs";

import { $ } from "bun";

import { commitsBetween, lastTag, releaseTitle } from "./release-notes.ts";

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
await $`git fetch --quiet origin main`;
if ((await $`git rev-list --count HEAD...origin/main`.text()).trim() !== "0") {
  throw new Error("main isn't the same as origin/main: pull or push first");
}

const tag = `v${version}`;
const remoteTag = await $`git ls-remote --tags origin refs/tags/${tag}`.text();
if (remoteTag.trim() || (await $`git tag --list ${tag}`.text()).trim()) {
  throw new Error(`${tag} already exists: pick a newer version`);
}

// The release's own title (release.yml), so the PR and its merge commit
// read the same: `v0.3.0: Add X, and add Y`.
const previous = await lastTag("HEAD");
const title = releaseTitle(
  tag,
  previous ? await commitsBetween(previous, "HEAD") : []
);

const branch = `release/v${version}`;
await $`git switch --quiet -c ${branch}`;
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
await $`git push --quiet -u origin ${branch}`;
// The label keeps CodeRabbit off it (.coderabbit.yaml): it only bumps versions.
await $`gh pr create --base main --head ${branch} --title ${title} --label release --body ${`Every package to ${version}. Once this is merged, \`bun run release:tag\` publishes it.`}`;

console.log(`Opened the release PR. Once it's merged: bun run release:tag`);
