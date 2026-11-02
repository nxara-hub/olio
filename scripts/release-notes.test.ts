import { expect, test } from "bun:test";

import { renderNotes } from "./release-notes.ts";

test("groups what reaches npm, with behaviour changes first", () => {
  expect(
    renderNotes([
      { subject: "feat(tools): loaders(root)", body: "" },
      {
        subject: "fix(olio): *.* covers plain fields",
        body: "Why it mattered.\n\nBehaviour: a public login\nneeds its result marked."
      },
      { subject: "fix: a bug with no scope", body: "" },
      { subject: "docs: reword the intro", body: "" },
      { subject: "fix(website): a broken link", body: "Behaviour: not this." },
      { subject: "feat(example): a new server", body: "" },
      { subject: "release: v1.0.0", body: "" }
    ])
  ).toBe(`## Behaviour changes

- olio: a public login needs its result marked.

## Fixes

- olio: \`*.*\` covers plain fields
- a bug with no scope

## Features

- tools: loaders(root)`);
});

test("says so when nothing reached the packages", () => {
  expect(renderNotes([{ subject: "docs: reword", body: "" }])).toBe(
    "No `feat` or `fix` commits in this release."
  );
});

test("a directive name can't read as a GitHub mention", () => {
  expect(
    renderNotes([
      {
        subject: "fix(schema): report @copy and @implements used on a field",
        body: 'Behaviour: mark it: `type S @bypass(keys: "a")`, or use @bypass.'
      },
      { subject: "feat(http): works with @nxara/olio-core", body: "" }
    ])
  ).toBe(`## Behaviour changes

- schema: mark it: \`type S @bypass(keys: "a")\`, or use \`@bypass\`.

## Fixes

- schema: report \`@copy\` and \`@implements\` used on a field

## Features

- http: works with \`@nxara\`/olio-core`);
});

test("release scope commits aren't listed, and wildcards read as code", () => {
  expect(
    renderNotes([
      { subject: "feat(release): notes from commits", body: "" },
      {
        subject: "fix(olio): *.* and User.* cover plain fields",
        body: "Behaviour: `*.*` stays quoted, and so does *.*."
      }
    ])
  ).toBe(`## Behaviour changes

- olio: \`*.*\` stays quoted, and so does \`*.*\`.

## Fixes

- olio: \`*.*\` and \`User.*\` cover plain fields`);
});
