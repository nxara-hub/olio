import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { compose } from "@nxara/olio-schema";
import { parse, print, type DocumentNode } from "graphql";

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

describe("typeDefsOutput", () => {
  const OUT = "typedefs.generated.ts";
  // Inside the package, so the generated files' `graphql` import resolves, as
  // it does in an app.
  const makeDir = (): Promise<string> =>
    mkdtemp(join(import.meta.dirname, "tmp-"));

  async function project(dir: string): Promise<string> {
    const modules = join(dir, "src/modules");
    await writeModule(modules, "users", {
      "typedefs/users.gql":
        'type User {\n  id: ID!\n  "Shown as `name`, never ${interpolated}"\n  name: String!\n}\n\nextend type Query { user: User }',
      "admin/typedefs/admin.gql":
        "extend type Mutation { ban(id: ID!): Boolean! }"
    });
    await writeModule(modules, "sales", {
      "orders/typedefs/orders.gql": "extend type Query { orders: [String!]! }"
    });
    return modules;
  }

  const load = async (file: string): Promise<DocumentNode[]> =>
    ((await import(`${file}?${Math.random()}`)) as { default: DocumentNode[] })
      .default;

  test("writes each module's and feature's own SDL next to it", async () => {
    const dir = await makeDir();
    try {
      const modules = await project(dir);
      await codegen({
        root: dir,
        modules: "src/modules",
        typeDefs: "**/typedefs/**/*.gql",
        output: "src/generated.ts",
        typeDefsOutput: OUT,
        logs: false
      });

      const users = await load(join(modules, "users", OUT));
      const admin = await load(join(modules, "users/admin", OUT));
      const orders = await load(join(modules, "sales/orders", OUT));
      expect(users.map((d) => print(d))).toEqual([
        print(
          parse(
            await readFile(join(modules, "users/typedefs/users.gql"), "utf8")
          )
        )
      ]);
      expect(print(admin[0] as DocumentNode)).toContain("ban(id: ID!)");
      expect(users.map((d) => print(d)).join()).not.toContain("ban");
      expect(existsSync(join(modules, "sales", OUT))).toBe(false);
      expect(orders).toHaveLength(1);

      const { schema } = compose([
        { id: "users", typeDefs: users },
        { id: "users/admin", typeDefs: admin },
        { id: "sales/orders", typeDefs: orders }
      ]);
      expect(Object.keys(schema.getMutationType()?.getFields() ?? {})).toEqual([
        "ban"
      ]);
      expect(schema.getType("User")?.description ?? "").toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors still point at the .gql file", async () => {
    const dir = await makeDir();
    try {
      const modules = await project(dir);
      await codegen({
        root: dir,
        modules: "src/modules",
        typeDefs: "**/typedefs/**/*.gql",
        output: "src/generated.ts",
        typeDefsOutput: OUT,
        logs: false
      });
      const users = await load(join(modules, "users", OUT));
      expect(() =>
        compose([
          { id: "users", typeDefs: users },
          {
            id: "other",
            typeDefs: [parse("extend type Query { user: String }")]
          }
        ])
      ).toThrow("src/modules/users/typedefs/users.gql:7:21");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("isn't read back as SDL when typeDefs also matches .ts files", async () => {
    const dir = await makeDir();
    try {
      const modules = await project(dir);
      const run = () =>
        codegen({
          root: dir,
          modules: "src/modules",
          // "*.ts" also matches the generated file at each folder's root.
          typeDefs: ["**/typedefs/**/*.gql", "*.ts"],
          output: "src/generated.ts",
          typeDefsOutput: OUT,
          logs: false
        });
      await run();
      await run();
      expect(await load(join(modules, "users", OUT))).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("refuses to overwrite a file it didn't write, and reads it as SDL", async () => {
    const dir = await makeDir();
    try {
      const modules = join(dir, "src/modules");
      const mine = 'export default "type Query { mine: Int }";\n';
      await writeModule(modules, "users", { "schema.ts": mine });
      await expect(
        codegen({
          root: dir,
          modules: "src/modules",
          typeDefs: "*.ts",
          output: "src/generated.ts",
          typeDefsOutput: "schema.ts",
          logs: false
        })
      ).rejects.toThrow(
        `${relative(dir, join(modules, "users/schema.ts"))} is not a file codegen wrote; pick another typeDefsOutput name`
      );
      expect(await readFile(join(modules, "users/schema.ts"), "utf8")).toBe(
        mine
      );
      expect(await readFile(join(dir, "src/generated.ts"), "utf8")).toContain(
        "mine"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("removes its file from a folder that no longer has SDL", async () => {
    const dir = await makeDir();
    try {
      const modules = await project(dir);
      const options = {
        root: dir,
        modules: "src/modules",
        typeDefs: "**/typedefs/**/*.gql",
        output: "src/generated.ts",
        typeDefsOutput: OUT,
        logs: false
      };
      await codegen(options);
      const orders = join(modules, "sales/orders");
      expect(existsSync(join(orders, OUT))).toBe(true);
      // Not codegen's: a file of the user's with the same name stays.
      await writeModule(modules, "sales", { [`notes/${OUT}`]: "// mine\n" });

      await rm(join(orders, "typedefs/orders.gql"));
      await writeModule(modules, "sales", {
        "typedefs/sales.gql": "extend type Query { total: Int }"
      });
      await codegen(options);

      expect(existsSync(join(orders, OUT))).toBe(false);
      expect(existsSync(join(modules, "sales", OUT))).toBe(true);
      expect(await readFile(join(modules, "sales/notes", OUT), "utf8")).toBe(
        "// mine\n"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes nothing next to modules without the option", async () => {
    const dir = await makeDir();
    try {
      const modules = await project(dir);
      await codegen({
        root: dir,
        modules: "src/modules",
        typeDefs: "**/typedefs/**/*.gql",
        output: "src/generated.ts",
        logs: false
      });
      expect(await readdir(join(modules, "users"))).not.toContain(OUT);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
