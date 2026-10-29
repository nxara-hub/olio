import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codegen } from "../src/index.js";

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nxara-codegen-"));
}

async function writeModule(
  modulesDir: string,
  id: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(modulesDir, id, rel);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, content);
  }
}

describe("module discovery", () => {
  test("discovers direct child directories as modules", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "auth", {
        "auth.gql": "type Query { login: Boolean }"
      });
      await writeModule(modules, "user", {
        "user.gql": "extend type Query { me: String }"
      });
      const output = join(dir, "generated.ts");

      await codegen({ modules, typeDefs: "**/*.gql", output });

      const out = await readFile(output, "utf8");
      expect(out).toContain("\n  auth: {");
      expect(out).toContain("\n  user: {");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("derives module IDs from directory names", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "account", {
        "auth.gql": "type Query { viewer: User } type User { id: ID! }"
      });
      const output = join(dir, "generated.ts");

      await codegen({ modules, typeDefs: "**/*.gql", output });

      const out = await readFile(output, "utf8");
      expect(out).toContain("\n  account: {");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("resolves typeDefs relative to each module directory", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "auth", {
        "query.gql": "type Query { viewer: User } type User { id: ID! }"
      });
      await writeModule(modules, "user", {
        "query.gql":
          "extend type Query { profiles: [Profile!]! } type Profile { id: ID! }"
      });
      const output = join(dir, "generated.ts");

      // A more specific glob still resolves within each module.
      await codegen({ modules, typeDefs: "*.gql", output });

      const out = await readFile(output, "utf8");
      expect(out).toContain("\n  auth: {");
      expect(out).toContain("\n  user: {");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("combines multiple SDL files within one module", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "auth", {
        "Query.gql": "type Query { login: Boolean }",
        "User.gql": "type User { id: ID! }"
      });
      const output = join(dir, "generated.ts");

      await codegen({ modules, typeDefs: "**/*.gql", output });

      const out = await readFile(output, "utf8");
      expect(out).toContain("\n  auth: {");
      expect(out).toContain("export type User = {");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a subfolder with SDL of its own is a feature, not a module", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "sales", {
        "typedefs/core.gql": "type Customer { id: ID! }",
        "typedefs/more/extra.gql": "extend type Customer { name: String }",
        "orders/typedefs/orders.gql":
          "extend type Query { orders: Int } extend type Customer { orderCount: Int }",
        "orders/returns/typedefs/returns.gql":
          "extend type Query { returns: Int }",
        "notes/readme.md": "not SDL"
      });
      const output = join(dir, "generated.ts");

      await codegen({
        modules,
        typeDefs: "**/typedefs/**/*.gql",
        output,
        logs: false
      });

      const out = await readFile(output, "utf8");
      // sales/typedefs/ is the module's own SDL, including its subfolders.
      expect(out).toContain(
        '  sales: {\n    Customer: { type: Customer; fields: "__isTypeOf" | "id" | "name" };\n  };'
      );
      // orders/ is a feature; features don't nest, so returns/ belongs to it.
      expect(out).toContain(
        '  "sales/orders": {\n    Customer: { type: Customer; fields: "orderCount" };\n    Query: { type: Query; fields: "orders" | "returns"; root: "query" };\n  };'
      );
      expect(out).not.toContain("notes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors when the modules directory does not exist", async () => {
    const dir = await makeDir();
    try {
      await expect(
        codegen({
          modules: join(dir, "missing"),
          typeDefs: "**/*.gql",
          output: join(dir, "generated.ts")
        })
      ).rejects.toThrow(/Modules directory does not exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors when no module directories are found", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await mkdir(modules, { recursive: true });
      await writeFile(join(modules, "stray.txt"), "not a module");

      await expect(
        codegen({ modules, typeDefs: "**/*.gql", output: join(dir, "out.ts") })
      ).rejects.toThrow(/No module directories found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors when a module contains no matching typeDefs", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "auth", { "resolvers.ts": "export {}" });

      await expect(
        codegen({ modules, typeDefs: "**/*.gql", output: join(dir, "out.ts") })
      ).rejects.toThrow(/contains no matching typeDefs/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports syntax errors with filename and location", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "auth", { "broken.gql": "type Query {" });

      await expect(
        codegen({ modules, typeDefs: "**/*.gql", output: join(dir, "out.ts") })
      ).rejects.toThrow(/broken\.gql:1:\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skips empty files and logs them", async () => {
    const dir = await makeDir();
    const warnings: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const modules = join(dir, "modules");
      await writeModule(modules, "auth", {
        "empty.gql": "",
        "data.gql": "type Query { ok: Boolean }"
      });
      const output = join(dir, "out.ts");
      await codegen({ modules, typeDefs: "**/*.gql", output });
      const out = await readFile(output, "utf8");
      expect(out).toContain("\n  auth: {");
      expect(out).not.toContain("Empty");
    } finally {
      console.log = original;
      await rm(dir, { recursive: true, force: true });
    }
    expect(warnings.some((w) => w.includes("empty.gql"))).toBe(true);
  });
});
