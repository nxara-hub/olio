import {
  asFunction,
  asValue,
  createContainer as createAwilix,
  InjectionMode,
  type AwilixContainer
} from "awilix";

/**
 * Register your context type, so `operation` providers see it:
 *
 * ```ts
 * declare module "@nxlab/di" {
 *   interface Register {
 *     ctx: RequestInfo;
 *   }
 * }
 * ```
 */
// oxlint-disable-next-line typescript/no-empty-interface -- augmented by apps
export interface Register {}

type Ctx = Register extends { ctx: infer C } ? C : unknown;
type MaybePromise<T> = T | Promise<T>;

export type Lifetime = "singleton" | "operation";

declare const provides: unique symbol;

export interface Provider<T, L extends Lifetime = Lifetime> {
  readonly lifetime: L;
  /** @internal */
  readonly create: (deps: OperationDeps) => T;
  // Method syntax, so a Provider<Pool> still passes as a Provider<unknown>.
  dispose?(value: T): MaybePromise<unknown>;
  /** Carries `T` for `get`, never set. */
  readonly [provides]?: T;
}

export interface SingletonDeps {
  get<T>(provider: Provider<T, "singleton">): T;
}

export interface OperationDeps {
  get<T>(provider: Provider<T>): T;
  readonly ctx: Ctx;
}

interface Options<T> {
  /** Runs when its container (or operation scope) is disposed. */
  dispose?: (value: T) => MaybePromise<unknown>;
}

/** One instance per container, created on first use. */
export function singleton<T>(
  create: (deps: SingletonDeps) => T,
  options: Options<T> = {}
): Provider<T, "singleton"> {
  return { lifetime: "singleton", create, dispose: options.dispose };
}

/** One instance per operation (per scope), created on first use. */
export function operation<T>(
  create: (deps: OperationDeps) => T,
  options: Options<T> = {}
): Provider<T, "operation"> {
  return { lifetime: "operation", create, dispose: options.dispose };
}

export interface Override {
  readonly provider: Provider<unknown>;
  readonly value: unknown;
}

export const override = <T>(provider: Provider<T>, value: T): Override => ({
  provider,
  value
});

export type Services = Readonly<Record<string, Provider<unknown>>> & {
  readonly dispose?: never;
  readonly ctx?: never;
};

/** Each instance is created on first access. */
export type Scope<S extends Services> = {
  readonly [K in keyof S]: S[K] extends Provider<infer T> ? T : never;
} & AsyncDisposable & {
    /** Disposes this operation's instances, newest first. */
    dispose(): Promise<void>;
  };

export interface Container<S extends Services> extends AsyncDisposable {
  scope(ctx: Ctx): Scope<S>;
  /** Disposes every singleton, newest first. */
  dispose(): Promise<void>;
}

/** The scope type of a container, for your context: `di: ScopeOf<typeof container>`. */
export type ScopeOf<C> = C extends Container<infer S> ? Scope<S> : never;

/** Awilix keeps `ctx` under this name in each scope. */
const CTX = "ctx";
const RESERVED = new Set([CTX, "dispose"]);

type Cradle = Record<string, unknown>;

/** `services` names what resolvers reach through `ctx.di`; what those depend on needn't be listed. */
export function createContainer<const S extends Services>(
  services: S,
  options: { override?: readonly Override[] } = {}
): Container<S> {
  const root = createAwilix<Cradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true
  });
  const replaced = new Map(options.override?.map((o) => [o.provider, o.value]));
  const names = new Map<Provider<unknown>, string>();

  const register = (provider: Provider<unknown>, name: string): void => {
    names.set(provider, name);
    if (replaced.has(provider)) {
      root.register(name, asValue(replaced.get(provider)));
      return;
    }
    const resolver = asFunction((cradle: Cradle) =>
      provider.create({
        get: (dep) => cradle[ensure(dep)] as never,
        // Only operation providers have a ctx; reading it is lazy so
        // singletons never touch it.
        get ctx() {
          return cradle[CTX] as Ctx;
        }
      })
    );
    const lifetime =
      provider.lifetime === "singleton"
        ? resolver.singleton()
        : resolver.scoped();
    const { dispose } = provider;
    root.register(name, dispose ? lifetime.disposer(dispose) : lifetime);
  };

  // ponytail: unlisted providers get a numbered name; Awilix's messages show it.
  const ensure = (provider: Provider<unknown>): string => {
    const known = names.get(provider);
    if (known) return known;
    const name = `#${names.size + 1}`;
    register(provider, name);
    return name;
  };

  for (const [name, provider] of Object.entries(services)) {
    if (RESERVED.has(name)) {
      throw new Error(`"${name}" is reserved; give the service another name`);
    }
    if (!names.has(provider)) register(provider, name);
  }

  const disposable = (awilix: AwilixContainer<Cradle>) => ({
    dispose: async () => {
      await awilix.dispose();
    },
    [Symbol.asyncDispose]: async () => {
      await awilix.dispose();
    }
  });

  return {
    scope: (ctx) => {
      const scope = root.createScope<Cradle>();
      scope.register(CTX, asValue(ctx));
      const instances = disposable(scope);
      for (const [name, provider] of Object.entries(services)) {
        Object.defineProperty(instances, name, {
          enumerable: true,
          get: () => scope.resolve(ensure(provider))
        });
      }
      return instances as Scope<S>;
    },
    ...disposable(root)
  };
}
