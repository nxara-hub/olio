import { describe, expect, test } from "bun:test";

import { copyDirective } from "@nxlab/schema";
import {
  graphql,
  GraphQLScalarType,
  parse,
  subscribe,
  type GraphQLObjectType
} from "graphql";

import {
  createFeature,
  createModule,
  module,
  mw,
  olio,
  type MiddlewareFn,
  type ModuleConfig,
  type OlioFeature
} from "../src/index.js";

const root = createModule("root", {
  typeDefs: /* GraphQL */ `
    type Query {
      _empty: String
    }
    type Mutation {
      _empty: String
    }
  `
});

const users = (extra: ModuleConfig<string> = {}) =>
  createModule("users", {
    typeDefs: /* GraphQL */ `
      type User {
        id: ID!
        name(upper: Boolean): String!
      }
      extend type Query {
        user(id: ID!): User
        users: [User!]!
      }
    `,
    resolvers: {
      Query: {
        user: (_: unknown, { id }: { id: string }) => ({ id, name: "ada" }),
        users: () => []
      },
      User: {
        name: (u: { name: string }, { upper }: { upper?: boolean }) =>
          upper ? u.name.toUpperCase() : u.name
      }
    },
    ...extra
  });

const trace =
  (log: string[], label: string): MiddlewareFn =>
  (_params, next) => {
    log.push(label);
    return next();
  };

const run = async (app: ReturnType<typeof olio>, source: string) =>
  graphql({ schema: app.schema, source, contextValue: {} });

describe("olio", () => {
  test("composes modules and attaches resolvers", async () => {
    const app = olio({ modules: [root, users()] });
    const result = await run(app, `{ user(id: "1") { id name(upper: true) } }`);
    expect(result).toEqual({
      data: { user: { id: "1", name: "ADA" } }
    });
  });

  test("runs middleware app-first, then module, most general first", async () => {
    const log: string[] = [];
    const app = olio({
      middleware: {
        "*": { "*": [trace(log, "app *.*")] },
        Query: {
          "*": [trace(log, "app Query.*")],
          user: [trace(log, "app Query.user")]
        }
      },
      modules: [
        root,
        users({
          middleware: {
            Query: {
              "*": [trace(log, "mod Query.*")],
              user: [trace(log, "mod Query.user")]
            }
          }
        })
      ]
    });
    await run(app, `{ user(id: "1") { id } }`);
    expect(log).toEqual([
      "app *.*",
      "app Query.*",
      "app Query.user",
      "mod Query.*",
      "mod Query.user"
    ]);
  });

  test("@bypass hands each field its keys; the middleware decides", async () => {
    const log: string[] = [];
    const tokenCheck: MiddlewareFn = ({ bypass, info }, next) => {
      if (!bypass.has("tokenCheck")) log.push(`check ${info.fieldName}`);
      return next();
    };
    const app = olio({
      middleware: {
        "*": { "*": [trace(log, "log")] },
        Query: { "*": [tokenCheck] },
        Mutation: { "*": [tokenCheck] }
      },
      modules: [
        root,
        createModule("auth", {
          typeDefs: /* GraphQL */ `
            extend type Query {
              me: String @bypass(keys: "tokenCheck")
              secret: String
            }
            extend type Mutation @bypass(keys: ["tokenCheck"]) {
              login: String
            }
          `,
          resolvers: {
            Query: { me: () => "ada", secret: () => "s" },
            Mutation: { login: () => "token" }
          }
        }),
        createModule("admin", {
          typeDefs: "extend type Mutation { ban: Boolean }",
          resolvers: { Mutation: { ban: () => true } }
        })
      ]
    });
    await run(app, "{ me secret }");
    // The logger still runs everywhere: only the check reads the key.
    expect(log.splice(0)).toEqual(["log", "log", "check secret"]);
    await run(app, "mutation { login ban }");
    // The extend block covers its own fields, not another module's.
    expect(log.splice(0)).toEqual(["log", "log", "check ban"]);
  });

  test("@bypass reaches default resolvers and subscriptions too", async () => {
    const seen: string[] = [];
    const record: MiddlewareFn = ({ bypass, info }, next) => {
      seen.push(`${info.fieldName}: ${[...bypass].join(",")}`);
      return next();
    };
    const app = olio({
      modules: [
        root,
        createModule("live", {
          typeDefs: /* GraphQL */ `
            type Item {
              name: String @bypass(keys: "redact")
            }
            extend type Query {
              item: Item
            }
            extend type Subscription {
              tick: Int @bypass(keys: "rateLimit")
            }
          `,
          resolvers: {
            Query: { item: () => ({ name: "chair" }) },
            Subscription: {
              async *tick() {
                yield 1;
              }
            }
          },
          middleware: {
            Item: { name: [record] },
            Subscription: { tick: [record] }
          }
        })
      ]
    });
    await run(app, "{ item { name } }");
    const events = await subscribe({
      schema: app.schema,
      document: parse("subscription { tick }")
    });
    await (events as AsyncGenerator<unknown>).next();
    expect(seen).toEqual(["name: redact", "tick: rateLimit"]);
  });

  test("features own their fields; middleware nests app → module → feature", async () => {
    const log: string[] = [];
    const sales = createModule("sales", {
      typeDefs: "type Customer { id: ID! name: String! }",
      middleware: {
        Query: { "*": [trace(log, "sales Query.*")] },
        Customer: { name: [trace(log, "sales Customer.name")] }
      },
      features: [
        createFeature("sales", "customers", {
          typeDefs: "extend type Query { customer: Customer }",
          resolvers: {
            Query: { customer: () => ({ id: "c1", name: "Acme" }) }
          },
          middleware: { Query: { "*": [trace(log, "customers Query.*")] } }
        }),
        createFeature("sales", "orders", {
          typeDefs:
            "extend type Query { orderCount: Int! } extend type Customer { orders: Int! }",
          resolvers: {
            Query: { orderCount: () => 2 },
            Customer: { orders: () => 2 }
          },
          middleware: {
            Query: { orderCount: [trace(log, "orders orderCount")] }
          }
        })
      ]
    });
    const app = olio({
      middleware: { Query: { "*": [trace(log, "app Query.*")] } },
      modules: [sales]
    });

    await run(app, "{ customer { name } }");
    // The feature's "*" covers its own fields; the module's reach every feature.
    expect(log.splice(0)).toEqual([
      "app Query.*",
      "sales Query.*",
      "customers Query.*",
      "sales Customer.name"
    ]);

    await run(app, "{ orderCount }");
    // A feature's own layer runs last.
    expect(log.splice(0)).toEqual([
      "app Query.*",
      "sales Query.*",
      "orders orderCount"
    ]);

    expect((await run(app, "{ customer { orders } }")).data).toEqual({
      customer: { orders: 2 }
    });
  });

  test("features are isolated from each other and from the module", () => {
    const sales = (
      features: OlioFeature[],
      extra: Partial<ModuleConfig<string>> = {}
    ) =>
      createModule("sales", {
        typeDefs: "type Customer { id: ID! }",
        features: [
          createFeature("sales", "customers", {
            typeDefs: "extend type Query { customer: Customer }"
          }),
          ...features
        ],
        ...extra
      });
    expect(() =>
      olio({
        modules: [
          sales([
            createFeature("sales", "orders", {
              resolvers: { Query: { customer: () => null } }
            })
          ])
        ]
      })
    ).toThrow(
      'Feature "sales/orders": "Query.customer" is declared by feature "sales/customers"; only that feature can resolve it'
    );
    expect(() =>
      olio({
        modules: [sales([], { resolvers: { Query: { customer: () => null } } })]
      })
    ).toThrow(
      'Module "sales": "Query.customer" is declared by feature "sales/customers"'
    );
    expect(() =>
      olio({
        modules: [
          sales([
            createFeature("sales", "orders", {
              typeDefs: "extend type Query { orders: Int }",
              middleware: { Query: { customer: [] } }
            })
          ])
        ]
      })
    ).toThrow(
      'Feature "sales/orders": middleware "Query.customer" targets a field the feature doesn\'t declare'
    );
    expect(() =>
      olio({ modules: [sales([createFeature("billing", "x", {})])] })
    ).toThrow('Feature "billing/x" is listed in module "sales"');
    expect(() =>
      olio({
        modules: [sales([createFeature("sales", "customers", {})])]
      })
    ).toThrow(
      'Two different features use the id "sales/customers"; ids must be unique'
    );
  });

  test("middleware can short-circuit and replace args", async () => {
    const deny: MiddlewareFn = () => null;
    const rename: MiddlewareFn = (params, next) => {
      params.args = { ...params.args, id: "42" };
      return next();
    };
    const app = olio({
      modules: [root, users({ middleware: { Query: { user: [rename] } } })]
    });
    expect((await run(app, `{ user(id: "1") { id } }`)).data).toEqual({
      user: { id: "42" }
    });

    const denied = olio({
      modules: [root, users({ middleware: { Query: { user: [deny] } } })]
    });
    expect((await run(denied, `{ user(id: "1") { id } }`)).data).toEqual({
      user: null
    });
  });

  test("leaves fields without a resolver unwrapped", async () => {
    const log: string[] = [];
    const app = olio({
      middleware: { "*": { "*": [trace(log, "app")] } },
      modules: [root, users()]
    });
    await run(app, `{ user(id: "1") { id } }`);
    expect(log).toEqual(["app"]); // Query.user only, not User.id
  });

  test("middleware naming a field without a resolver still runs", async () => {
    const log: string[] = [];
    const app = olio({
      middleware: { "*": { "*": [trace(log, "app")] } },
      modules: [
        root,
        users({ middleware: { User: { id: [trace(log, "User.id")] } } })
      ]
    });
    const result = await run(app, `{ user(id: "7") { id } }`);
    expect(result.data).toEqual({ user: { id: "7" } });
    // The default resolver for User.id is wrapped, app layers included.
    expect(log).toEqual(["app", "app", "User.id"]);
  });

  test("a module can resolve fields it adds to another module's type", async () => {
    const posts = createModule("posts", {
      typeDefs: "extend type User { posts: [String!]! }",
      resolvers: { User: { posts: () => ["hello"] } }
    });
    const app = olio({ modules: [root, users(), posts] });
    expect((await run(app, `{ user(id: "1") { posts } }`)).data).toEqual({
      user: { posts: ["hello"] }
    });

    const thief = createModule("thief", {
      typeDefs: "extend type User { stolen: Int }",
      resolvers: { User: { name: () => "x" } }
    });
    expect(() => olio({ modules: [root, users(), thief] })).toThrow(
      'Module "thief": "User.name" is declared by module "users"; only that module can resolve it'
    );
  });

  test("modules can extend root types nobody defines", async () => {
    const app = olio({
      modules: [
        createModule("hello", {
          typeDefs: "extend type Query { hello: String! }",
          resolvers: { Query: { hello: () => "hi" } }
        })
      ]
    });
    expect((await run(app, "{ hello }")).data).toEqual({ hello: "hi" });
  });

  test("works with custom root type names", async () => {
    const log: string[] = [];
    const app = olio({
      middleware: { RootQuery: { "*": [trace(log, "app RootQuery.*")] } },
      modules: [
        createModule("app", { typeDefs: "schema { query: RootQuery }" }),
        createModule("hello", {
          typeDefs: "extend type RootQuery { hello: String! }",
          resolvers: { RootQuery: { hello: () => "hi" } },
          middleware: { RootQuery: { hello: [trace(log, "hello")] } }
        })
      ]
    });
    expect((await run(app, "{ hello }")).data).toEqual({ hello: "hi" });
    expect(log).toEqual(["app RootQuery.*", "hello"]);
    expect(() =>
      olio({
        modules: [
          createModule("x", {
            typeDefs:
              "schema { query: RootQuery } extend type RootQuery { a: Int }"
          })
        ],
        middleware: { Query: { "*": [] } }
      })
    ).toThrow(
      'Application middleware "Query.*": the application can target "*" and root types only'
    );
  });

  test("middleware values must be lists of functions", () => {
    const fn: MiddlewareFn = (_params, next) => next();
    const build = (config: Partial<Parameters<typeof olio>[0]>) => () =>
      olio({ modules: [root, users()], ...config });
    expect(
      // @ts-expect-error a function, not a list of them
      build({ middleware: { Query: { "*": fn } } })
    ).toThrow(
      'Application middleware "Query.*" must be a list of middleware functions'
    );
    expect(
      build({
        // @ts-expect-error a list with something else in it
        modules: [root, users({ middleware: { Query: { user: [fn, "x"] } } })]
      })
    ).toThrow(
      'Module "users": middleware "Query.user" must be a list of middleware functions'
    );
  });

  test("rejects middleware keys that match nothing", () => {
    const build = (config: Partial<Parameters<typeof olio>[0]>) => () =>
      olio({ modules: [root, users()], ...config });
    expect(build({ middleware: { User: { name: [] } } })).toThrow(
      'Application middleware "User.name": the application can target "*" and root types only'
    );
    expect(build({ middleware: { Query: { nope: [] } } })).toThrow(
      'Application middleware "Query.nope": unknown field'
    );
    expect(
      build({ modules: [root, users({ middleware: { User: { nmae: [] } } })] })
    ).toThrow(
      'Module "users": middleware "User.nmae" targets a field the module doesn\'t declare'
    );
  });

  test("supports __resolveType, __isTypeOf and scalars", async () => {
    const shapes = createModule("shapes", {
      typeDefs: /* GraphQL */ `
        scalar Upper
        type Circle {
          r: Int!
        }
        type Square {
          side: Int!
        }
        union Shape = Circle | Square
        extend type Query {
          shape: Shape!
          shout: Upper!
        }
        type Subscription {
          ticks: Int!
        }
      `,
      resolvers: {
        Query: { shape: () => ({ side: 2 }), shout: () => "hey" },
        Shape: {
          __resolveType: (s: object) => ("side" in s ? "Square" : "Circle")
        },
        Upper: new GraphQLScalarType({
          name: "Upper",
          serialize: (v) => String(v).toUpperCase()
        })
      }
    });
    const app = olio({ modules: [root, shapes] });
    expect(
      (await run(app, `{ shape { ... on Square { side } } shout }`)).data
    ).toEqual({ shape: { side: 2 }, shout: "HEY" });
  });

  test("subscriptions yield field values; middleware runs once", async () => {
    const log: string[] = [];
    const feed = createModule("feed", {
      typeDefs: /* GraphQL */ `
        type Tick {
          n: Int!
          label: String!
        }
        type Subscription {
          ticks(upTo: Int!): Tick!
        }
      `,
      resolvers: {
        Subscription: {
          async *ticks(_: unknown, { upTo }: { upTo: number }) {
            for (let n = 1; n <= upTo; n++) yield { n };
          }
        },
        Tick: { label: (t: { n: number }) => `tick ${t.n}` }
      },
      middleware: { Subscription: { ticks: [trace(log, "ticks")] } }
    });
    const app = olio({ modules: [root, feed] });
    const stream = await subscribe({
      schema: app.schema,
      document: parse("subscription { ticks(upTo: 3) { n label } }")
    });
    if (!(Symbol.asyncIterator in stream)) throw new Error("not a stream");
    const events: unknown[] = [];
    for await (const event of stream) events.push(event.data);
    expect(events).toEqual(
      [1, 2, 3].map((n) => ({ ticks: { n, label: `tick ${n}` } }))
    );
    expect(log).toEqual(["ticks"]);

    expect(() =>
      olio({
        modules: [
          root,
          createModule("old", {
            typeDefs: "type Subscription { x: Int }",
            resolvers: { Subscription: { x: { subscribe: () => null } } }
          })
        ]
      })
    ).toThrow(
      'Module "old": "Subscription.x" must be a function returning an AsyncIterable (e.g. an async generator), or { resolve, extensions }, not "subscribe"'
    );
  });

  test("unknown names suggest the closest ones", () => {
    const users = (resolvers: object, middleware?: object) =>
      olio({
        modules: [
          createModule("users", {
            typeDefs:
              "type Query { user: Int users: Int } type User { id: ID } enum Role { ADMIN }",
            resolvers: resolvers as never
          })
        ],
        middleware: middleware as never
      });
    expect(() => users({ Query: { usr: () => 1 } })).toThrow(
      'Module "users": unknown field "Query.usr". Did you mean "user" or "users"?'
    );
    expect(() => users({ Usr: {} })).toThrow(
      'Module "users": unknown type "Usr". Did you mean "User"?'
    );
    expect(() =>
      olio({
        modules: [
          createModule("users", {
            typeDefs: "type Query { a: Int } enum Role { ADMIN }",
            enums: { Role: { ADMN: "a" } }
          })
        ]
      })
    ).toThrow(
      'Module "users": unknown enum value "Role.ADMN". Did you mean "ADMIN"?'
    );
    expect(() => users({}, { Query: { usr: [] } })).toThrow(
      'Application middleware "Query.usr": unknown field. Did you mean "user" or "users"?'
    );
  });

  test("an SDL syntax error has its location in the message", () => {
    expect(() =>
      createModule("users", { typeDefs: "type User { name String }" })
    ).toThrow(
      'module "users":1:18: Syntax Error: Expected ":", found Name "String".'
    );
  });

  test("a subscription must return an AsyncIterable", async () => {
    const live = createModule("live", {
      typeDefs: "type Query { ok: Int } type Subscription { tick: Int }",
      resolvers: { Query: { ok: () => 1 }, Subscription: { tick: () => 1 } }
    });
    const result = await subscribe({
      schema: olio({ modules: [live] }).schema,
      document: parse("subscription { tick }")
    });
    expect(result).toMatchObject({
      errors: [
        {
          message:
            'Module "live": "Subscription.tick" must return an AsyncIterable (e.g. an async generator), got number'
        }
      ]
    });
  });

  test("a field takes { resolve, extensions }: extensions land on the schema field", async () => {
    const log: string[] = [];
    const shop = createModule("shop", {
      typeDefs: /* GraphQL */ `
        type Item {
          name: String!
          price: Int!
          secret: String
        }
        type Query {
          item: Item!
        }
        type Subscription {
          ticks: Int!
        }
      `,
      resolvers: {
        Query: {
          item: {
            resolve: () => ({ name: "chair", price: 3, secret: "s" }),
            extensions: { complexity: 2 }
          }
        },
        Item: {
          price: { resolve: (row: { price: number }) => row.price * 100 },
          // Extensions only: the default resolver stays.
          secret: { extensions: { roles: ["ADMIN"] } }
        },
        Subscription: {
          ticks: {
            async *resolve() {
              yield 1;
            },
            extensions: { complexity: 1 }
          }
        }
      },
      middleware: {
        Item: { secret: [trace(log, "secret")] },
        Query: { item: [trace(log, "item")] }
      }
    });
    // A policy read from the field: one middleware instead of a list per field.
    const policy = olio({
      modules: [shop],
      middleware: {
        "*": {
          "*": [
            ({ info }, next) => {
              const field = info.parentType.getFields()[info.fieldName];
              return field?.extensions.roles ? null : next();
            }
          ]
        }
      }
    });
    const fields = (name: string) =>
      (policy.schema.getType(name) as GraphQLObjectType).getFields();
    expect(fields("Query").item?.extensions).toEqual({ complexity: 2 });
    expect(fields("Item").secret?.extensions).toEqual({ roles: ["ADMIN"] });
    expect(fields("Subscription").ticks?.extensions).toEqual({ complexity: 1 });

    // Without the policy: resolve is wrapped, and so is the default resolver of
    // the extensions-only field its middleware names.
    const plain = await run(
      olio({ modules: [shop] }),
      "{ item { name price secret } }"
    );
    expect(plain.data).toEqual({
      item: { name: "chair", price: 300, secret: "s" }
    });
    expect(log).toEqual(["item", "secret"]);
    // The app's policy runs first and stops the field before its own middleware.
    const guarded = await run(policy, "{ item { name price secret } }");
    expect(guarded.data).toEqual({
      item: { name: "chair", price: 300, secret: null }
    });
    expect(log).toEqual(["item", "secret", "item"]);

    const stream = (await subscribe({
      schema: policy.schema,
      document: parse("subscription { ticks }")
    })) as AsyncIterableIterator<unknown>;
    expect((await stream.next()).value).toEqual({ data: { ticks: 1 } });
  });

  test("the object form takes resolve and extensions only", () => {
    const build =
      (resolvers: Record<string, object>, sdl = "type Query { x: Int }") =>
      () =>
        olio({ modules: [createModule("m", { typeDefs: sdl, resolvers })] });
    expect(build({ Query: { x: { resolve: () => 1, cost: 2 } } })).toThrow(
      'Module "m": "Query.x" must be a function, or { resolve, extensions }, not "cost"'
    );
    expect(build({ Query: { x: { resolve: 1 } } })).toThrow(
      '"Query.x".resolve must be a function'
    );
    expect(build({ Query: { x: { extensions: "cheap" } } })).toThrow(
      '"Query.x".extensions must be an object'
    );
    expect(
      build(
        { Subscription: { x: { extensions: {} } } },
        "type Query { y: Int } type Subscription { x: Int }"
      )
    ).toThrow('"Subscription.x" needs a resolve');
  });

  test("enums can have internal values, in and out", async () => {
    const seen: unknown[] = [];
    const roles = createModule("roles", {
      typeDefs: /* GraphQL */ `
        enum Role {
          ADMIN
          GUEST
        }
        input Filter {
          role: Role = GUEST
        }
        type Query {
          role: Role!
          roles: [Role!]!
          echo(role: Role!): Role!
          byDefault(role: Role = ADMIN, filter: Filter = {}): Role!
          nested(filter: Filter!): Role!
        }
      `,
      enums: { Role: { ADMIN: 1, GUEST: 2 } },
      resolvers: {
        Query: {
          role: () => 1,
          roles: () => [2, 1],
          echo: (_: unknown, { role }: { role: unknown }) => {
            seen.push(role);
            return role;
          },
          byDefault: (
            _: unknown,
            args: { role: unknown; filter: { role: unknown } }
          ) => {
            seen.push(args.role, args.filter.role);
            return args.role;
          },
          nested: (_: unknown, { filter }: { filter: { role: unknown } }) => {
            seen.push(filter.role);
            return filter.role;
          }
        }
      }
    });
    const app = olio({ modules: [roles] });
    const result = await graphql({
      schema: app.schema,
      source: `query ($r: Role!) {
        role roles echo(role: GUEST) v: echo(role: $r) byDefault nested(filter: { role: ADMIN })
      }`,
      variableValues: { r: "ADMIN" }
    });
    expect(result.data).toEqual({
      role: "ADMIN",
      roles: ["GUEST", "ADMIN"],
      echo: "GUEST",
      v: "ADMIN",
      byDefault: "ADMIN",
      nested: "ADMIN"
    });
    // Resolvers only ever see internal values, defaults included.
    expect(seen).toEqual([2, 1, 1, 2, 1]);
    // A value with no internal mapping is an error, as for any bad enum value.
    const bad = olio({
      modules: [
        createModule("roles", {
          typeDefs: "enum Role { ADMIN GUEST } type Query { role: Role }",
          enums: { Role: { ADMIN: 1, GUEST: 2 } },
          resolvers: { Query: { role: () => "ADMIN" } }
        })
      ]
    });
    expect((await run(bad, "{ role }")).errors?.[0]?.message).toContain(
      'Enum "Role" cannot represent value'
    );
  });

  test("rejects invalid enum mappings", () => {
    const sdl = "enum Role { ADMIN GUEST } type Query { role: Role }";
    const build =
      (enums: Record<string, Record<string, unknown>>, extra = "") =>
      () =>
        olio({
          modules: [
            createModule("roles", { typeDefs: sdl + extra }),
            createModule("other", {
              typeDefs: "extend enum Role { BOT }",
              enums
            })
          ]
        });
    expect(build({ Role: { NOPE: 1 } })).toThrow(
      'Module "other": unknown enum value "Role.NOPE"'
    );
    expect(build({ Role: { ADMIN: 1 } })).toThrow(
      'Module "other": "Role.ADMIN" is declared by module "roles"; only that module can resolve it'
    );
    expect(() =>
      olio({
        modules: [
          createModule("roles", {
            typeDefs: sdl,
            enums: { Role: { ADMIN: 1, GUEST: 1 } }
          })
        ]
      })
    ).toThrow('Enum "Role": ADMIN and GUEST have the same internal value 1');
    // A partial map would leave GUEST on its name, next to internal values.
    expect(() =>
      olio({
        modules: [
          createModule("roles", {
            typeDefs: sdl,
            enums: { Role: { ADMIN: 1 } }
          })
        ]
      })
    ).toThrow(
      'Module "roles": enum "Role" needs an internal value for GUEST too'
    );
    // Each module maps the values it declares: BOT is other's.
    expect(build({ Role: { BOT: 3 } })).not.toThrow();
    expect(() =>
      olio({
        modules: [
          createModule("roles", {
            typeDefs: sdl,
            middleware: { Role: { ADMIN: [] } }
          })
        ]
      })
    ).toThrow(
      'middleware "Role.ADMIN" targets Role, which has no fields to wrap'
    );
  });

  test("enum values go through enums, and their absence is explained", async () => {
    const sdl = "enum Role { ADMIN GUEST } type Query { role: Role }";
    const build = (config: object) => () =>
      olio({ modules: [createModule("roles", { typeDefs: sdl, ...config })] });
    expect(build({ resolvers: { Role: { ADMIN: 1, GUEST: 2 } } })).toThrow(
      'Module "roles": enum "Role" takes its internal values through enums, not resolvers: { enums: { Role: { ... } } }'
    );
    expect(build({ enums: { Rol: { ADMIN: 1, GUEST: 2 } } })).toThrow(
      'Module "roles": enums: unknown enum "Rol". Did you mean "Role"?'
    );
    expect(build({ enums: { Query: {} } })).toThrow(
      'Module "roles": enums: "Query" is not an enum'
    );
    expect(build({ enums: [] })).toThrow(
      'Module "roles": enums must be one map keyed by enum, e.g. { Role: { ADMIN: 1 } }'
    );
    // Values registered in types (CustomEnums) but never supplied: say why.
    const app = build({ resolvers: { Query: { role: () => "admin" } } })();
    expect((await run(app, "{ role }")).errors?.[0]?.message).toBe(
      'Enum "Role" cannot represent value: "admin". No module gave "Role" internal values: pass them as { enums: { Role: { ... } } }'
    );
  });

  test("only the module defining a scalar implements it", () => {
    const upper = new GraphQLScalarType({ name: "Upper" });
    const core = createModule("core", {
      typeDefs: "scalar Upper extend type Query { shout: Upper }"
    });
    expect(() =>
      olio({
        modules: [core, createModule("x", { resolvers: { Upper: upper } })]
      })
    ).toThrow(
      'Module "x": scalar "Upper" is defined by "core"; only it can implement the scalar'
    );
    expect(() =>
      olio({
        modules: [root, createModule("x", { resolvers: { String: upper } })]
      })
    ).toThrow(
      'Module "x": scalar "String" isn\'t defined in any module\'s SDL'
    );
  });

  test("applies schema-design directives", () => {
    const app = olio({
      directives: [copyDirective()],
      modules: [
        createModule("copy", {
          typeDefs: /* GraphQL */ `
            type Base {
              id: ID!
            }
            type Query @copy(from: ["Base"]) {
              name: String
            }
          `
        })
      ]
    });
    expect(Object.keys(app.schema.getQueryType()?.getFields() ?? {})).toEqual([
      "id",
      "name"
    ]);
  });

  test("works without generated types: inline resolvers are loosely typed", async () => {
    const greet = createModule("greet", {
      typeDefs: "extend type Query { hello(name: String!): String! }",
      // No annotations: root/args/ctx get fallback types, not implicit any.
      resolvers: {
        Query: { hello: (_root, args) => `hi ${String(args.name)}` }
      }
    });
    const app = olio({ modules: [root, greet] });
    expect((await run(app, `{ hello(name: "ada") }`)).data).toEqual({
      hello: "hi ada"
    });
  });

  test("module.<id> builds a module with that id", () => {
    expect(module.users?.({}).id).toBe("users");
  });

  test("mw() is app middleware and mw.<id>() a module's; both pass through", () => {
    const map = { Query: { "*": [] } };
    expect(mw(map)).toBe(map);
    expect(mw.users?.(map)).toBe(map);
  });

  test('ids are non-empty and have no "/", so none passes for a feature', () => {
    expect(() => createModule("", {})).toThrow(
      'Module id "" must be non-empty and can\'t contain "/"'
    );
    expect(() => createModule("x/y", {})).toThrow(
      'Module id "x/y" must be non-empty and can\'t contain "/"'
    );
    expect(() => createFeature("m", "f/g", {})).toThrow(
      'Feature id "f/g" must be non-empty and can\'t contain "/"'
    );
    expect(() => createFeature("m", "", {})).toThrow('Feature id ""');
  });

  test("rejects invalid configuration", () => {
    expect(() => olio({ modules: [root, root] })).toThrow(
      'Module "root" is listed twice'
    );
    expect(() => olio({ modules: [root, createModule("root", {})] })).toThrow(
      'Two different modules use the id "root"; ids must be unique'
    );
    expect(() =>
      olio({
        modules: [
          root,
          users(),
          createModule("other", { resolvers: { Query: { user: () => null } } })
        ]
      })
    ).toThrow(
      'Module "other": "Query.user" is declared by module "users"; only that module can resolve it'
    );
    const resolveNode = (id: string) =>
      createModule(id, {
        resolvers: { Node: { __resolveType: () => "X" } }
      });
    expect(() =>
      olio({
        modules: [
          root,
          createModule("node", {
            typeDefs:
              "interface Node { id: ID! } type X implements Node { id: ID! }"
          }),
          resolveNode("a"),
          resolveNode("b")
        ]
      })
    ).toThrow(
      'Module "a": "Node.__resolveType" is declared by module "node"; only that module can resolve it'
    );
    expect(() =>
      olio({ modules: [root, createModule("x", { resolvers: { Nope: {} } })] })
    ).toThrow('Module "x": unknown type "Nope"');
    expect(() =>
      createModule("x", {
        // @ts-expect-error a list of maps isn't accepted, typed or not
        resolvers: [{ Query: {} }]
      })
    ).toThrow(
      'Module "x": resolvers must be one map keyed by type, not a list'
    );
    // A root field map passed without its type key gets a hint.
    expect(() =>
      olio({
        modules: [
          root,
          users(),
          createModule("x", { resolvers: { user: () => null } })
        ]
      })
    ).toThrow(
      'Module "x": unknown type "user". It\'s a Query field: key resolvers by type, e.g. { Query: { user: ... } }'
    );
    expect(() =>
      olio({
        modules: [
          root,
          createModule("x", { resolvers: { Query: { nope: () => 1 } } })
        ]
      })
    ).toThrow('Module "x": unknown field "Query.nope"');
  });
});
