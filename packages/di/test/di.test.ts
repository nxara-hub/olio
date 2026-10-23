import { describe, expect, test } from "bun:test";

import {
  createContainer,
  operation,
  override,
  singleton,
  type Provider,
  type ScopeOf
} from "../src/index.js";

declare module "../src/index.js" {
  interface Register {
    ctx: { user: string };
  }
}

const made: string[] = [];
const disposed: string[] = [];

const Db = singleton(
  () => {
    made.push("db");
    return { query: (sql: string) => `rows for ${sql}` };
  },
  { dispose: () => void disposed.push("db") }
);
const Clock = singleton(() => ({ now: () => 42 }));
const Repo = operation(
  ({ get, ctx }) => {
    made.push(`repo:${ctx.user}`);
    return {
      list: () => `${ctx.user}: ${get(Db).query("users")} @${get(Clock).now()}`
    };
  },
  { dispose: () => void disposed.push("repo") }
);
const Service = operation(({ get }) => ({ run: () => get(Repo).list() }));

// Db and Clock aren't listed: they register when Repo first asks for them.
const services = { repo: Repo, service: Service, db: Db };

describe("container", () => {
  test("singletons are shared and lazy; operation instances are per scope", () => {
    made.length = 0;
    const container = createContainer(services);
    const ada = container.scope({ user: "ada" });
    const alan = container.scope({ user: "alan" });
    expect(made).toEqual([]);
    expect(ada.service.run()).toBe("ada: rows for users @42");
    expect(alan.service.run()).toBe("alan: rows for users @42");
    expect(ada.repo).toBe(ada.repo);
    expect(ada.repo).not.toBe(alan.repo);
    expect(ada.db).toBe(alan.db);
    // Db is created lazily, the first time Repo actually asks for it.
    expect(made).toEqual(["repo:ada", "db", "repo:alan"]);
  });

  test("disposing a scope cleans up its instances; the container, its singletons", async () => {
    disposed.length = 0;
    const container = createContainer(services);
    {
      await using scope = container.scope({ user: "ada" });
      scope.repo.list();
    }
    expect(disposed).toEqual(["repo"]);
    await container.dispose();
    expect(disposed).toEqual(["repo", "db"]);
  });

  test("overrides replace a provider in one container only", () => {
    const fake = { query: () => "fake rows" };
    const testing = createContainer(services, {
      override: [override(Db, fake)]
    });
    expect(testing.scope({ user: "t" }).repo.list()).toBe("t: fake rows @42");
    expect(createContainer(services).scope({ user: "t" }).db.query("x")).toBe(
      "rows for x"
    );
  });

  test("rejects reserved names, lifetime leaks and cycles", () => {
    expect(() => createContainer({ dispose: Db } as never)).toThrow(
      '"dispose" is reserved; give the service another name'
    );

    // The types forbid this; Awilix's strict mode catches it at runtime too.
    const leaky = singleton(({ get }) =>
      get(Repo as unknown as Provider<unknown, "singleton">)
    );
    expect(
      () => createContainer({ leaky }).scope({ user: "ada" }).leaky
    ).toThrow("has a shorter lifetime than its ancestor");

    const a: Provider<unknown, "operation"> = operation(({ get }) => get(b));
    const b: Provider<unknown, "operation"> = operation(({ get }) => get(a));
    expect(() => createContainer({ a }).scope({ user: "ada" }).a).toThrow(
      "Cyclic dependencies detected"
    );
  });
});

describe("types", () => {
  test("names, lifetimes and overrides are checked at compile time", () => {
    const container = createContainer(services);
    const scope: ScopeOf<typeof container> = container.scope({ user: "x" });
    const typed: { run: () => string } = scope.service;
    // @ts-expect-error not a service
    const missing = () => scope.nope;
    // @ts-expect-error "dispose" and "ctx" are reserved
    const reserved = () => createContainer({ ctx: Db });
    // @ts-expect-error a singleton can't use an operation provider
    singleton(({ get }) => get(Repo));
    // @ts-expect-error an override must fit the provider's type
    override(Db, { query: 42 });
    expect([typed, missing, reserved]).toHaveLength(3);
  });
});
