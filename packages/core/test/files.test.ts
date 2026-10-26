import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { print } from "graphql";

import { loadSDLFile, matchFiles } from "../src/files.js";

async function withDir(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nxlab-core-"));
  try {
    await Promise.all(
      Object.entries(files).map(([name, content]) =>
        writeFile(join(dir, name), content)
      )
    );
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("loadSDLFile", () => {
  test("reads SDL files and .ts default exports alike", async () => {
    await withDir(
      {
        "a.gql": "type Query { a: Int }",
        "b.ts": 'export default "type B { b: Int }";',
        "only-comments.gql": "# nothing yet\n",
        "no-default.ts": "export const x = 1;"
      },
      async (dir) => {
        const a = await loadSDLFile(join(dir, "a.gql"));
        const b = await loadSDLFile(join(dir, "b.ts"));
        expect(a && print(a)).toBe("type Query {\n  a: Int\n}");
        expect(b && print(b)).toBe("type B {\n  b: Int\n}");
        expect(
          await loadSDLFile(join(dir, "only-comments.gql"))
        ).toBeUndefined();
        expect(await loadSDLFile(join(dir, "no-default.ts"))).toBeUndefined();
      }
    );
  });

  test("syntax errors point at the file, line and column", async () => {
    await withDir({ "bad.gql": "type Query {\n  a: \n}" }, async (dir) => {
      await expect(loadSDLFile(join(dir, "bad.gql"))).rejects.toThrow(
        /bad\.gql:3:1: Syntax Error/
      );
    });
  });

  test("an unknown extension throws", async () => {
    await expect(loadSDLFile("schema.txt")).rejects.toThrow(
      'Cannot load type definitions from "schema.txt" (unknown extension)'
    );
  });
});

describe("matchFiles", () => {
  test("sorts, dedupes, and throws on a pattern matching nothing", async () => {
    await withDir({ "b.gql": "", "a.gql": "" }, async (dir) => {
      expect(await matchFiles([`${dir}/*.gql`, `${dir}/a.gql`])).toEqual([
        join(dir, "a.gql"),
        join(dir, "b.gql")
      ]);
      await expect(matchFiles([`${dir}/*.graphql`])).rejects.toThrow(
        `No files match "${dir}/*.graphql"`
      );
    });
  });
});
