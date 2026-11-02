// The GitHub release's notes, from the commits since the previous tag, so
// there's no changelog to keep by hand. A `Behaviour: ...` line in a commit's
// body is how a change existing apps must act on gets into them.
//   bun scripts/release-notes.ts v0.3.0
import { $ } from "bun";

const REPO = "https://github.com/nxara-hub/olio";
// Only what reaches npm: the site, the example apps and docs don't.
const INTERNAL_SCOPES = new Set(["website", "example"]);

export interface Commit {
  subject: string;
  body: string;
}

// GitHub reads a bare @name as a mention: it notifies whoever owns that login and
// lists them as a contributor. Directive names read as code; code spans stay as
// they are, since a mention can't start inside one.
const withoutMentions = (text: string): string =>
  text
    .split("`")
    .map((part, index) =>
      index % 2 === 0
        ? part.replaceAll(/(^|[^\w/])@([\w-]+)/g, "$1`@$2`")
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

export function renderNotes(commits: readonly Commit[]): string {
  const features: string[] = [];
  const fixes: string[] = [];
  const behaviour: string[] = [];
  for (const { subject, body } of commits) {
    const match = /^(feat|fix)(?:\(([^)]+)\))?:\s*(.+)$/.exec(subject);
    if (!match) continue;
    const [, type, scope, text] = match;
    if (scope && INTERNAL_SCOPES.has(scope)) continue;
    const line = `- ${scope ? `${scope}: ` : ""}${text}`;
    (type === "feat" ? features : fixes).push(line);
    behaviour.push(
      ...behaviourLines(body).map(
        (change) => `- ${scope ? `${scope}: ` : ""}${change}`
      )
    );
  }
  const section = (title: string, lines: readonly string[]): string[] =>
    lines.length > 0 ? [`## ${title}\n\n${lines.join("\n")}`] : [];
  const sections = [
    ...section("Behaviour changes", behaviour),
    ...section("Fixes", fixes),
    ...section("Features", features)
  ];
  return sections.length > 0
    ? withoutMentions(sections.join("\n\n"))
    : "No `feat` or `fix` commits in this release.";
}

async function previousTag(tag: string): Promise<string | undefined> {
  const found = await $`git describe --tags --abbrev=0 ${tag}^`
    .nothrow()
    .quiet();
  return found.exitCode === 0 ? found.text().trim() : undefined;
}

async function commitsBetween(from: string, to: string): Promise<Commit[]> {
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
  const tag = process.argv[2];
  if (!tag) throw new Error("Usage: bun scripts/release-notes.ts <tag>");
  const previous = await previousTag(tag);
  console.log(
    previous
      ? `${renderNotes(await commitsBetween(previous, tag))}\n\n**Full diff**: ${REPO}/compare/${previous}...${tag}`
      : "First release."
  );
}
