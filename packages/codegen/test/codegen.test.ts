import { describe, expect, test } from "bun:test";

import { generate } from "../src/codegen.js";

const gen = (sdl: string, name = "auth"): string =>
  generate([{ name, typeDefs: sdl }]);

/** The `Application` block of the output. */
const application = (out: string): string =>
  out.slice(out.indexOf("export type Application"));

describe("generate: schema types", () => {
  test("routes every scalar through the Scalars table", () => {
    const out = gen(`
      type Query { user: User }
      type User {
        id: ID!
        name: String
        age: Int
        score: Float
        active: Boolean
      }
    `);
    expect(out).toContain(
      `export type User = {
  __typename?: "User";
  id: Scalars["ID"]["output"];
  name: Maybe<Scalars["String"]["output"]>;
  age: Maybe<Scalars["Int"]["output"]>;
  score: Maybe<Scalars["Float"]["output"]>;
  active: Maybe<Scalars["Boolean"]["output"]>;
};`
    );
    expect(out).toContain('  ID: ResolveScalar<"ID">;');
  });

  test("preserves list and element nullability", () => {
    expect(
      gen(`
        type Query { t: T }
        type T {
          a: String!
          b: [String!]!
          c: [String]
          d: [String!]
          e: [String]!
        }
      `)
    ).toContain(
      `export type T = {
  __typename?: "T";
  a: Scalars["String"]["output"];
  b: Scalars["String"]["output"][];
  c: Maybe<Maybe<Scalars["String"]["output"]>[]>;
  d: Maybe<Scalars["String"]["output"][]>;
  e: Maybe<Scalars["String"]["output"]>[];
};`
    );
  });

  test("resolves custom scalars by direction", () => {
    const out = gen(`
      scalar DateTime
      type Query { at(after: DateTime): DateTime! }
    `);
    expect(out).toContain('at: Scalars["DateTime"]["output"];');
    expect(out).toContain(
      'at: { after?: Maybe<Scalars["DateTime"]["input"]> };'
    );
    expect(out).toContain('  DateTime: ResolveScalar<"DateTime">;');
    expect(out).toContain(
      'import type { ResolveScalar } from "@nxlab/codegen";'
    );
  });

  test("generates enums as a const object and a union type", () => {
    expect(
      gen(`
        type Query { role: Role }
        enum Role { Admin Guest }
      `)
    ).toContain(
      `export const Role = {
  Admin: "Admin",
  Guest: "Guest"
} as const;
export type Role = (typeof Role)[keyof typeof Role];`
    );
  });

  test("emits implementers without intersecting their interfaces", () => {
    const out = gen(`
      type Query { n: Node }
      interface Node { id: ID! }
      type User implements Node { id: ID! name: String! }
    `);
    expect(out).toContain(
      `export type User = {
  __typename?: "User";
  id: Scalars["ID"]["output"];
  name: Scalars["String"]["output"];
};`
    );
    expect(out).toContain(
      'export type Node = {\n  id: Scalars["ID"]["output"];\n};'
    );
  });

  test("makes nullable inputs optional unless they have a default", () => {
    const out = gen(`
      type Query { users(filter: Filter, limit: Int = 10, first: Int!): [String!]! }
      input Filter { name: String, role: String!, size: Int = 5 }
    `);
    expect(out).toContain(
      `export type Filter = {
  name?: Maybe<Scalars["String"]["input"]>;
  role: Scalars["String"]["input"];
  size: Maybe<Scalars["Int"]["input"]>;
};`
    );
    expect(out).toContain(
      'users: { filter?: Maybe<Filter>; limit: Maybe<Scalars["Int"]["input"]>; first: Scalars["Int"]["input"] };'
    );
  });

  test("emits root types, unions and no helpers beyond Maybe", () => {
    const out = gen(`
      type Query { data: Data }
      type A { a: Int } type B { b: Int }
      union Data = A | B
    `);
    expect(out).toContain('export type Query = {\n  __typename?: "Query";');
    expect(out).toContain("export type Data = A | B;");
    expect(out).not.toContain("Prettify");
    expect(out).not.toContain("namespace");
    expect(out).not.toContain("Middleware");
  });
});

describe("generate: Application", () => {
  test("lists each module's types, owned fields and arguments", () => {
    expect(
      application(
        gen(`
          type Query { user(id: ID!): User users: [User!]! }
          type User { id: ID! name(trim: Boolean): String! }
        `)
      )
    ).toBe(
      `export type Application = {
  auth: {
    Query: {
      type: Query;
      fields: "user" | "users";
      root: "query";
      args: {
        user: { id: Scalars["ID"]["input"] };
      };
    };
    User: {
      type: User;
      fields: "__isTypeOf" | "id" | "name";
      args: {
        name: { trim?: Maybe<Scalars["Boolean"]["input"]> };
      };
    };
  };
};
`
    );
  });

  test("a module owns the fields it adds with extend, on any type", () => {
    const app = application(
      generate([
        {
          name: "users",
          typeDefs: "type Query { user: User } type User { id: ID! }"
        },
        {
          name: "posts",
          typeDefs:
            "type Post { id: ID! } extend type User { posts: [Post!]! } extend type Query { post: Post }"
        }
      ])
    );
    expect(app).toContain(
      `  posts: {
    Post: { type: Post; fields: "__isTypeOf" | "id" };
    Query: { type: Query; fields: "post"; root: "query" };
    User: { type: User; fields: "posts" };
  };`
    );
    expect(app).toContain(
      `  users: {
    Query: { type: Query; fields: "user"; root: "query" };
    User: { type: User; fields: "__isTypeOf" | "id" };
  };`
    );
  });

  test("__resolveType belongs to the module defining the abstract type", () => {
    const app = application(
      generate([
        {
          name: "app",
          typeDefs:
            "type Query { node: Node } interface Node { id: ID! } interface Empty { x: Int }"
        },
        { name: "users", typeDefs: "type User implements Node { id: ID! }" },
        { name: "posts", typeDefs: "type Post implements Node { id: ID! }" }
      ])
    );
    expect(app).toContain(
      'Node: { type: Node; fields: "__resolveType"; resolveType: "Post" | "User" };'
    );
    expect(app).toContain(
      'Empty: { type: Empty; fields: "__resolveType"; resolveType: never };'
    );
    expect(app).toContain(
      '  users: {\n    User: { type: User; fields: "__isTypeOf" | "id" };\n  };'
    );
  });

  test("merges same-named modules and keeps empty ones", () => {
    const app = application(
      generate([
        { name: "a", typeDefs: "type Query { x: Int }" },
        { name: "a", typeDefs: "extend type Query { y: Int }" },
        { name: "scalars", typeDefs: "scalar DateTime" }
      ])
    );
    expect(app).toContain(
      'Query: { type: Query; fields: "x" | "y"; root: "query" };'
    );
    expect(app).toContain("  scalars: {};");
  });

  test("needs no placeholder root type when modules only extend it", () => {
    const out = generate([
      { name: "users", typeDefs: "extend type Query { user: Int }" },
      { name: "posts", typeDefs: "extend type Query { post: Int }" }
    ]);
    expect(out).toContain('export type Query = {\n  __typename?: "Query";');
    expect(application(out)).toContain(
      'Query: { type: Query; fields: "post"; root: "query" };'
    );
    expect(application(out)).toContain(
      'Query: { type: Query; fields: "user"; root: "query" };'
    );
  });

  test("quotes module keys that are not identifiers", () => {
    expect(gen("type Query { x: Int }", "app-timeline")).toContain(
      '  "app-timeline": {'
    );
  });
});

describe("generate: unsupported schemas", () => {
  test("rejects type names the generated file uses", () => {
    for (const name of ["Application", "Maybe", "ResolveScalar"]) {
      expect(() =>
        gen(`type Query { x: ${name} } type ${name} { x: Int }`)
      ).toThrow(
        `Type name "${name}" is reserved by the generated file; rename it`
      );
    }
  });

  test("supports custom root type names, marking roots by operation", () => {
    const out = generate([
      { name: "app", typeDefs: "schema { query: RootQuery }" },
      { name: "users", typeDefs: "extend type RootQuery { me: Int }" }
    ]);
    expect(out).toContain(
      'export type RootQuery = {\n  __typename?: "RootQuery";'
    );
    expect(application(out)).toContain(
      'RootQuery: { type: RootQuery; fields: "me"; root: "query" };'
    );
  });
});
