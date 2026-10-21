// Compile-time only: olio's types against real codegen output (see
// generate.ts). Each @ts-expect-error must keep failing.
import { query, resolvers } from "../../src/index.js";
import type { Application } from "./generated.js";

interface UserRow {
  id: string;
  name: string;
  roleId: 1 | 2;
}
interface NamedRow {
  label: string;
}

// Augments olio's source, so this checks src/ rather than a build.
declare module "../../src/types.js" {
  interface Olio {
    application: Application;
    mappers: { User: UserRow; Named: NamedRow };
  }
}
declare module "@nxlab/codegen" {
  interface CustomEnums {
    Role: 1 | 2;
  }
}

const user: UserRow = { id: "u1", name: "Ada", roleId: 1 };

// ---- Interfaces --------------------------------------------------------

query.content({
  // Node has no mapper: any implementer, each as resolvers see it.
  node: () => user,
  // Named is mapped: NamedRows.
  named: () => [{ label: "x" }],
  // Unions map member by member.
  items: () => [user, { id: "p1", title: "Hello" }]
});
// @ts-expect-error a bare { id } is neither a UserRow nor a Post
query.content({ node: () => ({ id: "x" }) });
// @ts-expect-error Named is mapped, so not Named-shaped objects
query.content({ named: () => [{ name: "x" }] });

// __resolveType receives what resolvers return.
resolvers.content.Node({
  __resolveType: (node) => ("title" in node ? "Post" : "User")
});
resolvers.content.Named({
  __resolveType: (named) => (named.label ? "Tag" : "User")
});

// ---- Enums with internal values -----------------------------------------

resolvers.content.Role({ ADMIN: 1, GUEST: 2 });
// @ts-expect-error internal values are 1 | 2
resolvers.content.Role({ ADMIN: 1, GUEST: 3 });
// @ts-expect-error every value the module declares needs one
resolvers.content.Role({ ADMIN: 1 });

// Arguments and results use internal values too.
query.content({
  usersByRole: (_root, { role }) => [{ ...user, roleId: role }]
});
resolvers.content.User({ role: (row) => row.roleId });
// @ts-expect-error role resolves to an internal value, not a name
resolvers.content.User({ role: () => "ADMIN" });
