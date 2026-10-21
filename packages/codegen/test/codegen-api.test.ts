import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copyDirective, implementsDirective } from "@nxlab/schema";

import { codegen } from "../src/index.js";

/** The SDL most tests generate from — one module, a realistic auth surface. */
const AUTH_SDL = `
  interface Node { id: ID! }
  type Query { viewer: User }
  type Mutation { login(email: String!, password: String!): User }
  type User implements Node { id: ID! email: String! name: String }
`;

async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "nxlab-codegen-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

/** Write `files` as the single `auth` module and return the output path. */
async function scaffold(
  dir: string,
  files: Record<string, string> = { "auth.gql": AUTH_SDL }
): Promise<{ modules: string; output: string }> {
  const modules = join(dir, "modules");
  await writeModule(modules, "auth", files);
  return { modules, output: join(dir, "generated.ts") };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for condition");
}

const read = (path: string): Promise<string> =>
  readFile(path, "utf8").catch(() => "");

describe("codegen", () => {
  test("writes generated types for a discovered module", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir);

      await codegen({ modules, typeDefs: "**/*.gql", output });

      const out = await readFile(output, "utf8");
      expect(out).toContain("export type Application = {\n  auth: {");
      expect(out).toContain(
        'Query: { type: Query; fields: "viewer"; root: "query" };'
      );
    });
  });

  test("resolves relative paths from the current working directory", async () => {
    await withTempDir(async (dir) => {
      const cwd = process.cwd();
      try {
        process.chdir(dir);
        await writeModule("modules", "auth", { "auth.gql": AUTH_SDL });

        await codegen({
          modules: "modules",
          typeDefs: "**/*.gql",
          output: "generated/out.ts"
        });

        expect(await readFile("generated/out.ts", "utf8")).toContain(
          "\n  auth: {"
        );
      } finally {
        process.chdir(cwd);
      }
    });
  });

  test("creates nested output directories", async () => {
    await withTempDir(async (dir) => {
      const { modules } = await scaffold(dir);
      const output = join(dir, "deep", "nested", "generated.ts");

      await codegen({ modules, typeDefs: "**/*.gql", output });

      expect(await readFile(output, "utf8")).toContain("\n  auth: {");
    });
  });

  test("applies a single directive", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir, {
        "schema.gql": `
          interface Node { id: ID! }
          type User @implements(from: ["Node"]) { email: String! }
          type Query { viewer: User }
        `
      });

      await codegen({
        modules,
        typeDefs: "**/*.gql",
        output,
        directives: [implementsDirective()]
      });

      // @implements spliced Node's `id` into User.
      expect(await readFile(output, "utf8")).toMatch(
        /export type User = \{[\s\S]*?id: Scalars\["ID"\]\["output"\];/
      );
    });
  });

  test("applies multiple directives", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir, {
        "schema.gql": `
          interface Node { id: ID! }
          interface Timestamped { createdAt: String! }
          type User @implements(from: ["Node"]) @copy(from: ["Timestamped"]) {
            email: String!
          }
          type Query { viewer: User }
        `
      });

      await codegen({
        modules,
        typeDefs: "**/*.gql",
        output,
        directives: [implementsDirective(), copyDirective()]
      });

      const out = await readFile(output, "utf8");
      // Spliced and copied fields belong to the module that declares User.
      expect(out).toContain(
        'User: { type: User; fields: "__isTypeOf" | "createdAt" | "email" | "id" };'
      );
    });
  });

  test("writes the transformed schema to the schema path", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir, {
        "schema.gql": `
          interface Node { id: ID! }
          type User @implements(from: ["Node"]) { email: String! }
          type Query { viewer: User }
        `
      });
      const schema = join(dir, "schema.graphql");

      await codegen({
        modules,
        typeDefs: "**/*.gql",
        output,
        schema,
        directives: [implementsDirective()]
      });

      const sdl = await readFile(schema, "utf8");
      expect(sdl).toContain("implements Node");
      expect(sdl).toContain("id: ID!");
    });
  });

  test("combines multiple source files into one schema", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir, {
        "query.gql": "type Query { viewer: User }",
        "user.gql": "type User { id: ID! }",
        "extras.gql": "extend type User { email: String! }"
      });
      const schema = join(dir, "schema.graphql");

      await codegen({ modules, typeDefs: "**/*.gql", output, schema });

      const sdl = await readFile(schema, "utf8");
      expect(sdl).toContain("viewer: User");
      expect(sdl).toContain("email: String!");
    });
  });

  test("writes no schema when schema is omitted", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir);

      await codegen({ modules, typeDefs: "**/*.gql", output });

      expect((await readdir(dir)).sort()).toEqual(["generated.ts", "modules"]);
    });
  });

  test("clear replaces stale outputs", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir);
      const schema = join(dir, "schema.graphql");
      await writeFile(output, "stale ts");
      await writeFile(schema, "stale schema");

      await codegen({
        modules,
        typeDefs: "**/*.gql",
        output,
        schema,
        clear: true
      });

      const ts = await readFile(output, "utf8");
      const sdl = await readFile(schema, "utf8");
      expect(ts).not.toContain("stale ts");
      expect(ts).toContain("\n  auth: {");
      expect(sdl).not.toContain("stale schema");
      expect(sdl).toContain("viewer: User");
    });
  });

  test("watch regenerates TypeScript and schema on change", async () => {
    await withTempDir(async (dir) => {
      const modules = join(dir, "modules");
      const source = join(modules, "auth", "auth.gql");
      const output = join(dir, "generated.ts");
      const schema = join(dir, "schema.graphql");
      await writeModule(modules, "auth", { "auth.gql": AUTH_SDL });

      void codegen({
        modules,
        typeDefs: "**/*.gql",
        output,
        schema,
        watch: true
      });

      await waitFor(async () => (await read(output)).includes("viewer"));
      await waitFor(async () => (await read(schema)).includes("viewer: User"));

      await writeFile(
        source,
        `${AUTH_SDL}\nextend type Mutation { logout: Boolean }`
      );

      await waitFor(async () => (await read(output)).includes("logout"));
      await waitFor(async () => (await read(schema)).includes("logout"));
    });
  });

  test("watch rediscovers modules when directories are added or removed", async () => {
    await withTempDir(async (dir) => {
      const modules = join(dir, "modules");
      const output = join(dir, "generated.ts");
      await writeModule(modules, "auth", { "auth.gql": AUTH_SDL });

      void codegen({ modules, typeDefs: "**/*.gql", output, watch: true });

      await waitFor(async () => (await read(output)).includes("\n  auth: {"));

      // A new module extending the root type — no Query clash with auth.
      await writeModule(modules, "billing", {
        "billing.gql":
          "extend type Query { invoices: [Invoice!]! } type Invoice { id: ID! }"
      });
      await waitFor(async () =>
        (await read(output)).includes("\n  billing: {")
      );

      await rm(join(modules, "billing"), { recursive: true, force: true });
      await waitFor(async () => {
        const out = await read(output);
        return !out.includes("\n  billing: {") && out.includes("\n  auth: {");
      });
    });
  });

  test("logs lifecycle messages, and logs: false suppresses them", async () => {
    await withTempDir(async (dir) => {
      const lines: string[] = [];
      const original = console.log;
      console.log = (...args: unknown[]) =>
        lines.push(args.map(String).join(" "));
      try {
        const { modules, output } = await scaffold(dir);
        const schema = join(dir, "schema.graphql");

        await codegen({ modules, typeDefs: "**/*.gql", output, schema });
        expect(lines[0]).toMatch(/@nxlab\/codegen.*generate/);
        expect(lines).toContainEqual(
          expect.stringMatching(/modules.*auth.*1 file/)
        );
        expect(lines).toContainEqual(
          expect.stringMatching(/✓ .*generated\.ts .*4 types · 1 module/)
        );
        expect(lines).toContainEqual(
          expect.stringMatching(/✓ .*schema\.graphql/)
        );

        // Same content again: nothing is rewritten.
        lines.length = 0;
        await codegen({ modules, typeDefs: "**/*.gql", output, schema });
        expect(lines).toContainEqual(
          expect.stringMatching(/generated\.ts .*unchanged/)
        );

        lines.length = 0;
        await codegen({ modules, typeDefs: "**/*.gql", output, logs: false });
        expect(lines).toEqual([]);
      } finally {
        console.log = original;
      }
    });
  });
});

describe("generated Application", () => {
  test("lists module types without middleware unions or an olio import", async () => {
    await withTempDir(async (dir) => {
      const { modules, output } = await scaffold(dir);

      await codegen({ modules, typeDefs: "**/*.gql", output });

      const out = await readFile(output, "utf8");
      expect(out).toContain(
        `export type Application = {
  auth: {
    Mutation: {
      type: Mutation;
      fields: "login";
      root: "mutation";
      args: {
        login: { email: Scalars["String"]["input"]; password: Scalars["String"]["input"] };
      };
    };
    Node: { type: Node; fields: "__resolveType"; resolveType: "User" };
    Query: { type: Query; fields: "viewer"; root: "query" };
    User: { type: User; fields: "__isTypeOf" | "email" | "id" | "name" };
  };
};`
      );
      expect(out).not.toContain("Middleware");
      expect(out).not.toContain("@nxlab/olio");
    });
  });
});
