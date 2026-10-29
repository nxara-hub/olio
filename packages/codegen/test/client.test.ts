import { describe, expect, test } from "bun:test";

import { buildSchema, parse, Source } from "graphql";

import { emitClient } from "../src/emit-client.js";

const schema = buildSchema(/* GraphQL */ `
  type Query {
    me: User
  }
  type Subscription {
    ticks: Int!
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

  test("subscriptions default to ws; @sse overrides; operations list the transports used", () => {
    const wsOnly = emitClient(schema, [doc("subscription Ticks { ticks }")]);
    expect(wsOnly).toContain('transport: "ws"');
    expect(wsOnly).toContain('transports: ["ws"]');

    const both = emitClient(schema, [
      doc("subscription Ticks { ticks }\nsubscription Feed @sse { ticks }")
    ]);
    expect(both).toContain('transports: ["sse", "ws"]');
    // The directive is the client's: the query the server receives has none.
    expect(both).toContain(
      'query: "subscription Feed {\\n  ticks\\n}",\n  transport: "sse"'
    );

    const none = emitClient(schema, [doc("query Me { me { name } }")]);
    expect(none).not.toContain("transports");
  });

  test("@ws and @sse: subscriptions only, one at a time, no arguments", () => {
    expect(() =>
      emitClient(schema, [doc("query Me @ws { me { name } }")])
    ).toThrow("ops/me.graphql:1:10: @ws only applies to subscriptions");
    expect(() =>
      emitClient(schema, [doc("subscription T @ws @sse { ticks }")])
    ).toThrow("ops/me.graphql:1:20: A subscription takes one of @ws or @sse");
    expect(() =>
      emitClient(schema, [doc("subscription T @sse(x: 1) { ticks }")])
    ).toThrow("@sse takes no arguments");
    expect(() =>
      emitClient(schema, [doc("subscription T @wss { ticks }")])
    ).toThrow('Unknown directive "@wss"');
  });
});
