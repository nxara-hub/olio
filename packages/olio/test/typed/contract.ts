// Compile-time only: olio's types against real codegen output (see
// generate.ts). Each @ts-expect-error must keep failing.
import { GraphQLScalarType } from "graphql";

import {
  feature,
  module,
  mw,
  query,
  resolvers,
  type LoadedResolvers
} from "../../src/index.js";
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

// ---- Features -------------------------------------------------------------

// A feature builds its own resolvers, typed to the fields it declares.
query.content.blog({ articles: () => [{ id: "a1", title: "Hello" }] });
resolvers.content.blog.User({ articleCount: (row) => row.name.length });
feature.content.blog({
  middleware: mw.content.blog({ Query: { articles: [] } })
});

// @ts-expect-error the module can't resolve its feature's field
query.content({ articles: () => [] });
// @ts-expect-error the feature can't resolve the module's field
query.content.blog({ items: () => [] });
// @ts-expect-error feature middleware reaches only the feature's fields
mw.content.blog({ Query: { node: [] } });
// Module middleware reaches the module's and every feature's fields.
mw.content({ Query: { node: [], articles: [] }, User: { articleCount: [] } });

// ---- Inline resolver maps -------------------------------------------------

// Typed from the module, no builders needed: args, roots, enums, scalars.
module.content({
  resolvers: {
    Query: {
      node: () => user,
      usersByRole: (_root, { role }) => [{ ...user, roleId: role }]
    },
    User: { role: (row) => row.roleId },
    Role: { ADMIN: 1, GUEST: 2 },
    Upper: new GraphQLScalarType({ name: "Upper" })
  }
});
// @ts-expect-error unknown field
module.content({ resolvers: { Query: { nope: () => null } } });
// @ts-expect-error role resolves to an internal value
module.content({ resolvers: { User: { role: () => "ADMIN" } } });
// @ts-expect-error articles belongs to the blog feature
module.content({ resolvers: { Query: { articles: () => [] } } });
// @ts-expect-error a scalar's implementation is a GraphQLScalarType
module.content({ resolvers: { Upper: { serialize: () => 1 } } });

// Features too.
feature.content.blog({
  resolvers: {
    Query: { articles: () => [] },
    User: { articleCount: (row) => row.name.length }
  }
});
// @ts-expect-error node belongs to the module, not the feature
feature.content.blog({ resolvers: { Query: { node: () => null } } });

// What loadResolvers returns passes through, alone or next to inline maps.
declare const fromFiles: LoadedResolvers;
module.content({ resolvers: [fromFiles, { Query: { node: () => null } }] });
// @ts-expect-error inline maps in a list are still checked
module.content({ resolvers: [fromFiles, { Query: { nope: () => null } }] });

// ---- Middleware maps --------------------------------------------------------

// "x" and "-x" in one map are opposite instructions: a compile error.
// @ts-expect-error "-node" can't be combined with "node"
mw.content({ Query: { "-node": [], node: [] } });
// @ts-expect-error same check inline in a module
module.content({ middleware: { Query: { node: [], "-node": [] } } });
const featureConflict = { Query: { articles: [], "-articles": [] } } as const;
// @ts-expect-error and in a feature
feature.content.blog({ middleware: featureConflict });
// Unknown keys are still rejected.
// @ts-expect-error not a field
mw.content({ Query: { nope: [] } });
// @ts-expect-error not a type
mw.content({ Nope: { x: [] } });
// A typed map passes on as it is.
const checked = mw.content({ Query: { node: [] } });
module.content({ middleware: checked });
