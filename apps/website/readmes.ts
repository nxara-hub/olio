import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroIntegration } from "astro";

export const repoUrl = "https://github.com/nxara-hub/olio";

// Sidebar order. core is left out: apps never import it.
const packages = [
  "olio",
  "codegen",
  "schema",
  "tools",
  "http",
  "client",
  "di"
] as const;

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const outDir = fileURLToPath(
  new URL("src/content/docs/reference/", import.meta.url)
);

const readmePath = (dir: string): string =>
  path.join(repoRoot, "packages", dir, "README.md");

const plain = (markdown: string): string =>
  markdown
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replaceAll(/[`*_]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();

// README links are relative to the package folder on GitHub. On the site, a
// link to another package's README becomes its reference page; anything else
// in the repo goes to GitHub.
const rewriteLink = (dir: string, target: string): string => {
  if (/^([a-z]+:|#|\/)/i.test(target)) {
    return target;
  }
  const [file = "", anchor] = target.split("#");
  const fromRoot = path.posix.normalize(
    path.posix.join("packages", dir, file)
  );
  const pkg = /^packages\/([^/]+)\/?(README\.md)?$/.exec(fromRoot)?.[1];
  if (pkg && (packages as readonly string[]).includes(pkg)) {
    return `/reference/${pkg}/${anchor ? `#${anchor}` : ""}`;
  }
  return `${repoUrl}/blob/main/${fromRoot}${anchor ? `#${anchor}` : ""}`;
};

const toPage = (dir: string, order: number): string => {
  const source = readFileSync(readmePath(dir), "utf8");
  const [heading = "", ...rest] = source.split("\n");
  const title = heading.replace(/^#\s+/, "").trim() || `@nxara/olio-${dir}`;
  // Odd parts are fenced code, where "](" can be ordinary code.
  const body = rest
    .join("\n")
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replaceAll(
            /\]\(([^)\s]+)\)/g,
            (_match, target: string) => `](${rewriteLink(dir, target)})`
          )
    )
    .join("");
  const intro = body.trim().split(/\n\s*\n/)[0] ?? "";
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(plain(intro))}`,
    `editUrl: ${JSON.stringify(`${repoUrl}/edit/main/packages/${dir}/README.md`)}`,
    "sidebar:",
    `  label: ${JSON.stringify(title.replace("@nxara/", ""))}`,
    `  order: ${order}`,
    "---"
  ];
  return `${frontmatter.join("\n")}\n${body}`;
};

export const syncReadmes = (): string[] => {
  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const [order, dir] of packages.entries()) {
    writeFileSync(path.join(outDir, `${dir}.md`), toPage(dir, order));
  }
  return packages.map(readmePath);
};

export const readmes = (): AstroIntegration => ({
  name: "olio-readmes",
  hooks: {
    "astro:config:setup": ({ addWatchFile, logger }) => {
      const files = syncReadmes();
      for (const file of files) {
        addWatchFile(file);
      }
      logger.info(`${files.length} package READMEs synced to reference/`);
    }
  }
});
