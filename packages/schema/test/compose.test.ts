import { describe, expect, test } from "bun:test";

import { parse, printSchema, Source } from "graphql";

import {
  bypassDefinition,
  compose,
  copyDirective,
  type Bypass,
  type Ownership
} from "../src/index.js";

const mod = (id: string, sdl: string) => ({
  id,
  typeDefs: [parse(new Source(sdl, `${id}.gql`))]
});

const keys = (bypass: Bypass) =>
  Object.fromEntries(
    [...bypass].map(([field, set]) => [field, [...set].sort()])
  );

const plain = (ownership: Ownership) =>
  Object.fromEntries(
    [...ownership].map(([id, types]) => [
      id,
      Object.fromEntries([...types].map(([t, f]) => [t, [...f].sort()]))
    ])
  );

describe("compose", () => {
  test("adds root types that are only extended", () => {
    const { schema } = compose([
      mod(
        "users",
        "extend type Query { user: Int } extend type Mutation { a: Int }"
      )
    ]);
    expect(Object.keys(schema.getQueryType()?.getFields() ?? {})).toEqual([
      "user"
    ]);
    expect(schema.getMutationType()?.name).toBe("Mutation");
    expect(schema.getSubscriptionType()).toBeUndefined();
  });

  test("a module owns what it declares, on any type", () => {
    const { ownership } = compose([
      mod(
        "users",
        "type User { id: ID! } interface Node { id: ID! } extend type Query { user: User }"
      ),
      mod("posts", "extend type User { posts: [Int] }")
    ]);
    expect(plain(ownership)).toEqual({
      users: {
        Node: ["__resolveType"],
        Query: ["user"],
        User: ["__isTypeOf", "id"]
      },
      posts: { User: ["posts"] }
    });
  });

  test("enum values belong to the module that declares them", () => {
    const { ownership } = compose([
      mod(
        "sales",
        "enum Status { OPEN CLOSED } extend type Query { s: Status }"
      ),
      mod("legacy", "extend enum Status { ARCHIVED }")
    ]);
    expect(plain(ownership).sales?.Status).toEqual(["CLOSED", "OPEN"]);
    expect(plain(ownership).legacy).toEqual({ Status: ["ARCHIVED"] });
  });

  test("fields added by a directive belong to the module using it", () => {
    const { ownership } = compose(
      [
        mod("app", "type Base { createdAt: String }"),
        mod(
          "users",
          'type User @copy(from: ["Base"]) { id: ID! } extend type Query { u: User }'
        )
      ],
      [copyDirective()]
    );
    expect(plain(ownership).users?.User).toEqual([
      "__isTypeOf",
      "createdAt",
      "id"
    ]);
  });

  test("a scalar belongs to the module that defines it", () => {
    const { ownership } = compose([
      mod("core", "scalar DateTime type Query { now: DateTime }"),
      mod(
        "other",
        'extend scalar DateTime @specifiedBy(url: "https://example.com")'
      )
    ]);
    expect(plain(ownership).core?.DateTime).toEqual(["__scalar"]);
    expect(plain(ownership).other).toEqual({});
  });

  test("merges modules that share an id", () => {
    const { ownership } = compose([
      mod("a", "extend type Query { x: Int }"),
      mod("a", "extend type Query { y: Int }")
    ]);
    expect(plain(ownership).a?.Query).toEqual(["x", "y"]);
  });

  test("a duplicate names every module that declares it", () => {
    expect(() =>
      compose([
        mod("users", "extend type Query { user: Int }"),
        mod("posts", "extend type Query { user: Int }")
      ])
    ).toThrow(
      'Invalid SDL:\n  users.gql:1:21: Field "Query.user" can only be defined once.\n    also at posts.gql:1:21'
    );
  });

  test("reports SDL and schema errors with file locations", () => {
    expect(() => compose([mod("bad", "type Query { a: Nope }")])).toThrow(
      'Invalid SDL:\n  bad.gql:1:17: Unknown type "Nope".'
    );
    expect(() =>
      compose([
        mod(
          "bad",
          "interface Node { id: ID! } type Query { n: Node } type U implements Node { x: Int }"
        )
      ])
    ).toThrow(
      /Invalid schema:\n {2}bad\.gql:1:\d+: Interface field Node\.id expected but U does not provide it/
    );
  });

  test("uses custom root type names from the schema definition", () => {
    const { schema, ownership, roots } = compose([
      mod("app", "schema { query: RootQuery, mutation: RootMutation }"),
      mod(
        "users",
        "type User { id: ID! } extend type RootQuery { user: User }"
      ),
      mod(
        "audit",
        "extend type RootMutation { log: Int } type Query { notRoot: Int }"
      )
    ]);
    expect(roots).toEqual({ query: "RootQuery", mutation: "RootMutation" });
    expect(schema.getQueryType()?.name).toBe("RootQuery");
    expect(schema.getMutationType()?.name).toBe("RootMutation");
    // Without a schema definition `Query` would be the root; here it's a
    // plain type, so its defining module owns __isTypeOf.
    expect(plain(ownership).audit).toEqual({
      Query: ["__isTypeOf", "notRoot"],
      RootMutation: ["log"]
    });
    expect(plain(ownership).users?.RootQuery).toEqual(["user"]);
  });

  test("@bypass: keys per field, from a field, a type or an extend block", () => {
    const { bypass, schema } = compose([
      mod(
        "auth",
        `
          type Session @bypass(keys: "audit") { token: String! }
          extend type Query { me: Session @bypass(keys: ["tokenCheck"]) }
          extend type Mutation @bypass(keys: "tokenCheck") {
            login: Session
            signUp: Session @bypass(keys: ["rateLimit", "tokenCheck"])
          }
        `
      ),
      mod("admin", "extend type Mutation { ban: Boolean }")
    ]);
    expect(keys(bypass)).toEqual({
      "Session.token": ["audit"],
      "Query.me": ["tokenCheck"],
      "Mutation.login": ["tokenCheck"],
      "Mutation.signUp": ["rateLimit", "tokenCheck"]
    });
    // Another module's fields on the same type aren't covered, and the
    // directive never reaches the schema.
    expect(bypass.has("Mutation.ban")).toBe(false);
    expect(printSchema(schema)).not.toContain("bypass");
  });

  test("@bypass: declaring it is optional; @copy doesn't carry it", () => {
    const { bypass, schema } = compose(
      [
        mod(
          "m",
          `${bypassDefinition}
          type A { a: Int @bypass(keys: "x") }
          type B @copy(from: ["A"]) { b: Int }
          extend type Query { a: A b: B }`
        )
      ],
      [copyDirective()]
    );
    expect(keys(bypass)).toEqual({ "A.a": ["x"] });
    expect(printSchema(schema)).not.toContain("bypass");
  });

  test("@bypass: rejected anywhere but object types and their fields", () => {
    const sdl = (s: string) => () =>
      compose([mod("m", `type Query { a: Int } ${s}`)]);
    expect(sdl('interface I @bypass(keys: "x") { a: Int }')).toThrow(
      "m.gql:1:35: @bypass applies to object types and their fields only"
    );
    expect(sdl('interface I { a: Int @bypass(keys: "x") }')).toThrow(
      "@bypass applies to object types and their fields only"
    );
    expect(sdl('input I { a: Int @bypass(keys: "x") }')).toThrow(
      "@bypass applies to object types and their fields only"
    );
    expect(sdl("type T { a: Int @bypass }")).toThrow(
      '@bypass on "T.a" needs keys, e.g. @bypass(keys: ["tokenCheck"])'
    );
    expect(sdl('type T { a: Int @bypass(keys: [""]) }')).toThrow(
      '@bypass on "T.a": keys are non-empty strings'
    );
    expect(sdl('type T @bypass(keys: "x", why: "y") { a: Int }')).toThrow(
      '@bypass on "T" takes only keys, not "why"'
    );
  });
});
