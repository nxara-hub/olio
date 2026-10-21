import { describe, expect, test } from "bun:test";

import { parse, Source } from "graphql";

import { compose, copyDirective, type Ownership } from "../src/index.js";

const mod = (id: string, sdl: string) => ({
  id,
  typeDefs: [parse(new Source(sdl, `${id}.gql`))]
});

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

  test("merges modules that share an id", () => {
    const { ownership } = compose([
      mod("a", "extend type Query { x: Int }"),
      mod("a", "extend type Query { y: Int }")
    ]);
    expect(plain(ownership).a?.Query).toEqual(["x", "y"]);
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
});
