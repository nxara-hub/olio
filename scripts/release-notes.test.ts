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

- olio: *.* covers plain fields
- a bug with no scope

## Features

- tools: loaders(root)`);
});

test("says so when nothing reached the packages", () => {
  expect(renderNotes([{ subject: "docs: reword", body: "" }])).toBe(
    "No `feat` or `fix` commits in this release."
  );
});
