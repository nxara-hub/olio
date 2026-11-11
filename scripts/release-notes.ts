// The GitHub release's notes and title, from the commits since the previous
// tag, so there's no changelog to keep by hand. A `Behaviour: ...` line in a commit's
// body is how a change existing apps must act on gets into them.
//   bun scripts/release-notes.ts v0.3.0
//   bun scripts/release-notes.ts --title v0.3.0
import { $ } from "bun";

const REPO = "https://github.com/nxara-hub/olio";
// Only what reaches npm: the site, the example apps, this script and docs don't.
const INTERNAL_SCOPES = new Set(["website", "example", "release"]);

export interface Commit {
  subject: string;
  body: string;
}

// GitHub reads a bare @name as a mention: it notifies whoever owns that login and
// lists them as a contributor. Markdown reads the asterisks in `*.*` as emphasis.
// Both are code. Code spans stay as they are, since neither can start inside one.
const quoteCode = (text: string): string =>
  text
    .split("`")
    .map((part, index) =>
      index % 2 === 0
        ? part
            .replaceAll(/(^|[^\w/])@([\w-]+)/g, "$1`@$2`")
            .replaceAll(/(^|\s)(\w*\*?\.\*)(?=[\s.,:;]|$)/gm, "$1`$2`")
        : part
    )
    .join("`");

function behaviourLines(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replaceAll(/\s*\n\s*/g, " ").trim())
    .filter((paragraph) => paragraph.startsWith("Behaviour:"))
    .map((paragraph) => paragraph.replace(/^Behaviour:\s*/, ""));
}

interface Change {
  type: "feat" | "fix";
  scope: string | undefined;
  text: string;
  behaviour: string[];
}

// Only `feat` and `fix` commits outside the internal scopes.
function changes(commits: readonly Commit[]): Change[] {
  return commits.flatMap(({ subject, body }): Change[] => {
    const match = /^(feat|fix)(?:\(([^)]+)\))?:\s*(.+)$/.exec(subject);
    if (!match) return [];
    const [, type, scope, text = ""] = match;
    if (scope && INTERNAL_SCOPES.has(scope)) return [];
    return [
      {
        type: type as Change["type"],
        scope,
        text,
        behaviour: behaviourLines(body)
      }
    ];
  });
}

export function renderNotes(commits: readonly Commit[]): string {
  const all = changes(commits);
  const line = (scope: string | undefined, text: string): string =>
    `- ${scope ? `${scope}: ` : ""}${text}`;
  const section = (title: string, lines: readonly string[]): string[] =>
    lines.length > 0 ? [`## ${title}\n\n${lines.join("\n")}`] : [];
  const sections = [
    ...section(
      "Behaviour changes",
      all.flatMap((c) => c.behaviour.map((b) => line(c.scope, b)))
    ),
    ...section(
      "Fixes",
      all.filter((c) => c.type === "fix").map((c) => line(c.scope, c.text))
    ),
    ...section(
      "Features",
      all.filter((c) => c.type === "feat").map((c) => line(c.scope, c.text))
    )
  ];
  return sections.length > 0
    ? quoteCode(sections.join("\n\n"))
    : "No `feat` or `fix` commits in this release.";
}

/**
 * The version and what's new, for the release and its PR: the first two
 * features, or fixes when there are none. `v0.2.0: Add X, and add Y`.
 */
export function releaseTitle(tag: string, commits: readonly Commit[]): string {
  const all = changes(commits);
  const features = all.filter((c) => c.type === "feat");
  const texts = (features.length > 0 ? features : all).map((c) => c.text);
  if (texts.length === 0) return tag;
  const [first = "", second] = texts;
  const more = texts.length - 2;
  const summary =
    second === undefined
      ? first
      : more > 0
        ? `${first}, ${second}, and ${more} more`
        : `${first}, and ${second}`;
  // A word, not code: `typeDefsOutput`, `loaders(root)` and `graphql-ws` keep their case.
  const sentence = /^[a-z]+\b(?![(.-])/.test(summary)
    ? `${summary.charAt(0).toUpperCase()}${summary.slice(1)}`
    : summary;
  return `${tag}: ${sentence}`;
}

/** The newest tag `ref` contains: `v0.2.0^` for the one before v0.2.0. */
export async function lastTag(ref: string): Promise<string | undefined> {
  const found = await $`git describe --tags --abbrev=0 ${ref}`
    .nothrow()
    .quiet();
  return found.exitCode === 0 ? found.text().trim() : undefined;
}

export async function commitsBetween(
  from: string,
  to: string
): Promise<Commit[]> {
  const log =
    await $`git log --no-merges --reverse --format=%s%x00%b%x1e ${from}..${to}`.text();
  return log
    .split("\u001E")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = "", body = ""] = entry.split("\0");
      return { subject, body };
    });
}

if (import.meta.main) {
  const titleOnly = process.argv[2] === "--title";
  const tag = process.argv[titleOnly ? 3 : 2];
  if (!tag) {
    throw new Error("Usage: bun scripts/release-notes.ts [--title] <tag>");
  }
  const previous = await lastTag(`${tag}^`);
  const commits = previous ? await commitsBetween(previous, tag) : [];
  if (titleOnly) {
    console.log(releaseTitle(tag, commits));
  } else {
    console.log(
      previous
        ? `${renderNotes(commits)}\n\n**Full diff**: ${REPO}/compare/${previous}...${tag}`
        : "First release."
    );
  }
}
