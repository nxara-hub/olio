// Tags main once a release PR is merged; pushing the tag publishes. The tag
// names the version the packages are at, so it can't disagree with them.
//   bun run release:tag
import { globSync, readFileSync } from "node:fs";

import { $ } from "bun";

if ((await $`git status --porcelain`.text()).trim()) {
  throw new Error("Commit or stash your changes first");
}
await $`git switch --quiet main`;
await $`git pull --quiet --ff-only origin main`;

const versions = new Set(
  globSync("packages/*/package.json").map(
    (file) =>
      (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version
  )
);
const [version] = versions;
if (versions.size !== 1 || !version) {
  throw new Error(
    `Packages are at different versions: ${[...versions].join(", ")}`
  );
}
const tag = `v${version}`;
const remote = await $`git ls-remote --tags origin refs/tags/${tag}`.text();
if (remote.trim() || (await $`git tag --list ${tag}`.text()).trim()) {
  throw new Error(
    `${tag} already exists: merge a release PR for a new version first`
  );
}

await $`git tag ${tag}`;
await $`git push --quiet origin ${tag}`;
console.log(`Pushed ${tag}: the release workflow publishes it.`);
