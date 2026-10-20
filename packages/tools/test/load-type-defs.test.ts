import { describe, expect, test } from "bun:test";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { print } from "graphql";

import { loadResolvers, loadTypeDefs } from "../src/index.js";

const sdl = (defs: readonly unknown[]): string[] =>
  defs.map((d) => print(d as Parameters<typeof print>[0]).trim());

async function withDir(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "nxlab-tools-"));
  await Promise.all(
    Object.entries(files).map(([name, content]) =>
      writeFile(join(dir, name), content)
    )
  );
  return {
    dir,
    clean: () => rm(dir, { recursive: true, force: true })
  };
}

describe("loadTypeDefs", () => {
  test("loads .graphql files", async () => {
    const { dir, clean } = await withDir({
      "schema.graphql": "type Query { viewer: User }"
    });
    try {
      const defs = await loadTypeDefs(`${dir}/*.graphql`);
      expect(sdl(defs)).toEqual(["type Query {\n  viewer: User\n}"]);
    } finally {
      await clean();
    }
  });

  test("loads .gql files", async () => {
    const { dir, clean } = await withDir({
      "schema.gql": "type Query { viewer: User }"
    });
    try {
      const [def] = await loadTypeDefs(`${dir}/*.gql`);
      expect(def?.loc?.source.name).toEndWith("schema.gql");
    } finally {
      await clean();
    }
  });

  test("loads a .ts module default export", async () => {
    const { dir, clean } = await withDir({
      "schema.ts": "export default `type Query { viewer: User }`;"
    });
    try {
      const defs = await loadTypeDefs(`${dir}/*.ts`);
      expect(sdl(defs)).toEqual(["type Query {\n  viewer: User\n}"]);
    } finally {
      await clean();
    }
  });

  test("loads glob patterns and dedupes overlapping matches", async () => {
    const { dir, clean } = await withDir({
      "user.graphql": "type User { id: ID! }",
      "post.gql": "type Post { id: ID! }"
    });
    try {
      const defs = await loadTypeDefs(
        `${dir}/*.graphql`,
        `${dir}/*.{graphql,gql}`
      );
      expect(defs).toHaveLength(2);
    } finally {
      await clean();
    }
  });
});

describe("loadTypeDefs extras", () => {
  test("accepts file URLs and skips comment-only files", async () => {
    const { dir, clean } = await withDir({
      "a.gql": "type A { id: ID! }",
      "empty.gql": "# type B { id: ID! }\n"
    });
    try {
      const defs = await loadTypeDefs(new URL(`file://${dir}/*.gql`));
      expect(sdl(defs)).toEqual(["type A {\n  id: ID!\n}"]);
    } finally {
      await clean();
    }
  });
});

describe("loadResolvers", () => {
  test("merges named exports by type across files", async () => {
    const { dir, clean } = await withDir({
      "query.ts": "export const Query = { a: () => 1 };",
      "user.ts":
        "export const Query = { b: () => 2 };\nexport const User = { name: () => 'x' };\nexport default 1;"
    });
    try {
      const resolvers = await loadResolvers(`${dir}/*.ts`);
      expect(Object.keys(resolvers).sort()).toEqual(["Query", "User"]);
      expect(Object.keys(resolvers.Query ?? {}).sort()).toEqual(["a", "b"]);
    } finally {
      await clean();
    }
  });

  test("throws on a field defined twice", async () => {
    const { dir, clean } = await withDir({
      "a.ts": "export const Query = { a: () => 1 };",
      "b.ts": "export const Query = { a: () => 2 };"
    });
    try {
      await expect(loadResolvers(`${dir}/*.ts`)).rejects.toThrow(
        /Resolver "Query\.a" is defined in .*a\.ts and .*b\.ts/
      );
    } finally {
      await clean();
    }
  });

  test("keeps scalars and other class instances as they are", async () => {
    const { dir, clean } = await withDir({
      "scalars.ts":
        "class Scalar { name = 'Upper'; }\nexport const Upper = new Scalar();"
    });
    try {
      const resolvers = await loadResolvers(`${dir}/*.ts`);
      expect(resolvers.Upper?.constructor.name).toBe("Scalar");
    } finally {
      await clean();
    }
  });
});

describe("errors", () => {
  test("a pattern that matches nothing throws", async () => {
    await expect(loadTypeDefs("/nowhere/*.gql")).rejects.toThrow(
      'No files match "/nowhere/*.gql"'
    );
    await expect(loadResolvers("/nowhere/*.ts")).rejects.toThrow(
      'No files match "/nowhere/*.ts"'
    );
  });

  test("syntax errors point at the file, line and column", async () => {
    const { dir, clean } = await withDir({
      "bad.gql": "type Query {\n  a: \n}"
    });
    try {
      await expect(loadTypeDefs(`${dir}/*.gql`)).rejects.toThrow(
        /bad\.gql:3:1: Syntax Error/
      );
    } finally {
      await clean();
    }
  });
});
