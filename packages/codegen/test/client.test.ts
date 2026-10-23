import { describe, expect, test } from "bun:test";

import { buildSchema, parse, Source } from "graphql";

import { emitClient } from "../src/emit-client.js";

const schema = buildSchema(/* GraphQL */ `
  type Query {
    me: User
  }
  type User {
    name: String!
  }
`);
const doc = (body: string) => parse(new Source(body, "ops/me.graphql"));

describe("client operations", () => {
  test("operations are checked against the schema, with file:line:col", () => {
    expect(() =>
      emitClient(schema, [doc("query Me {\n  me { nope }\n}")])
    ).toThrow('ops/me.graphql:2:8: Cannot query field "nope" on type "User".');
  });

  test("every operation needs a name, since its types are named after it", () => {
    expect(() => emitClient(schema, [doc("{ me { name } }")])).toThrow(
      "ops/me.graphql:1:1: An operation needs a name"
    );
  });

  test("names follow graphql-codegen: Me → MeQuery, and MeQuery stays MeQuery", () => {
    expect(emitClient(schema, [doc("query Me { me { name } }")])).toContain(
      "export const MeDocument: TypedDocument<MeQuery, MeQueryVariables"
    );
    expect(
      emitClient(schema, [doc("query MeQuery { me { name } }")])
    ).toContain(
      "export const MeQueryDocument: TypedDocument<MeQuery, MeQueryVariables"
    );
    expect(() =>
      emitClient(schema, [
        doc("query Me { me { name } }\nquery MeQuery { me { name } }")
      ])
    ).toThrow(
      'Operations "Me" and "MeQuery" both name their result type MeQuery'
    );
  });
});
