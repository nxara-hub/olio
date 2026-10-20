// Compile-time only: each @ts-expect-error proves the generated types close
// that door. Checked by `bun run check-types`.
import { mw, query, resolvers, type Fields } from "@nxlab/olio";

// User belongs to the users module; the application cannot target it.
// @ts-expect-error
mw({ User: { name: [] } });

// createUser is not a users Mutation field.
// @ts-expect-error
mw.users({ Mutation: { createUser: [] } });

// The exclusive form only exists for real targets.
// @ts-expect-error
mw.auth({ Query: { "-nope": [] } });

// Not a users Query field.
// @ts-expect-error
query.users({ login: () => null });

// Wrong return type for User.name.
// @ts-expect-error
resolvers.users.User({ name: () => 42 });

// auth does not define User.
// @ts-expect-error
resolvers.auth.User({});

// Field types outside resolvers: arguments and results by type and field.
export const userArgs: Fields["Query"]["user"]["args"] = { id: "1" };
export const role: Fields["Mutation"]["setRole"]["args"]["role"] = "Admin";
export const name: Fields["User"]["name"]["result"] = null;

// @ts-expect-error id is a string
export const badArgs: Fields["Query"]["user"]["args"] = { id: 1 };

// @ts-expect-error not a Query field
export type NoField = Fields["Query"]["nope"];

// @ts-expect-error hooks are not fields
export type NoHook = Fields["User"]["__isTypeOf"];

// Mappers: User is mapped to UserRow, so resolvers return rows.
query.users({ user: () => ({ _id: "1", name: "Ada", role: "Admin" }) });
// @ts-expect-error a UserRow needs a role
query.users({ user: () => ({ _id: "1", name: "Ada" }) });
// The mapping reaches into unmapped types: UserPagination.data takes rows.
type PageRows = NonNullable<Fields["Query"]["users"]["result"]>["data"];
export const page: PageRows = [{ _id: "1", name: "Ada", role: "Admin" }];
const notARow = { _id: "1", name: null, role: null };
// @ts-expect-error User-shaped objects are not rows (name may be null)
export const notRows: PageRows = [notARow];
// A User field resolver's root is the row.
resolvers.users.User({ role: (row) => row.role });
