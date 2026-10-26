// Compile-time only: olio's types against real codegen output (see
// generate.ts). Each @ts-expect-error must keep failing.
import { copyDirective, implementsDirective } from "@nxlab/schema";
import { GraphQLScalarType } from "graphql";

import {
  feature,
  module,
  mw,
  olio,
  query,
  resolvers,
  type LoadedResolvers,
  type TypeResolvers,
  type MiddlewareFn
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
  interface FieldExtensions<Source, Args> {
    complexity?: number | ((args: Args) => number);
    visible?: (row: Source) => boolean;
  }
}
// What a library does: add a key to graphql's own field extensions.
declare module "graphql" {
  interface GraphQLFieldExtensions<_TSource, _TContext, _TArgs> {
    cacheControl?: { maxAge: number };
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
// Another owner's field carries olio's runtime message as its type, so the
// compile error names the owner.
const message: NonNullable<TypeResolvers<"content/blog", "User">["role"]> =
  "User.role is declared by module content; only that module can resolve it";
const fromFeature: NonNullable<
  TypeResolvers<"content", "User">["articleCount"]
> =
  "User.articleCount is declared by feature content/blog; only that feature can resolve it";
void [message, fromFeature];
// @ts-expect-error node belongs to the module, not the feature
feature.content.blog({ resolvers: { Query: { node: () => null } } });

// A mistake is reported at the field, not on the whole map.
module.content({
  resolvers: {
    Query: {
      usersByRole: (_root, { role }) => [{ ...user, roleId: role }],
      // @ts-expect-error node returns a Node or null, not a number
      node: () => 42
    },
    User: {
      name: (row) => row.name,
      // @ts-expect-error nme is a typo for name
      nme: (row: UserRow) => row.name
    }
  }
});

// What loadResolvers returns passes through as the map.
declare const fromFiles: LoadedResolvers;
module.content({ resolvers: fromFiles });
feature.content.blog({ resolvers: fromFiles });
// @ts-expect-error one map, not a list
module.content({ resolvers: [fromFiles] });

// ---- Middleware maps --------------------------------------------------------

// Unknown keys are rejected.
// @ts-expect-error not a field
mw.content({ Query: { nope: [] } });
// @ts-expect-error not a type
mw.content({ Nope: { x: [] } });
// @ts-expect-error not a field, in a module's own middleware
module.content({ middleware: { Query: { nope: [] } } });
// @ts-expect-error a feature reaches only its own fields
feature.content.blog({ middleware: { Query: { node: [] } } });
// A typed map passes on as it is.
const checked = mw.content({ Query: { node: [] } });
module.content({ middleware: checked });

// Inline under a field key, root and args are that field's parent and args.
mw.content({
  Query: { usersByRole: [({ args }, next) => (args.role === 1 ? next() : [])] },
  User: { name: [({ root }, next) => (root.roleId === 1 ? next() : "")] }
});
mw.content({
  Query: {
    usersByRole: [
      // @ts-expect-error role is 1 | 2 (CustomEnums), never "ADMIN"
      ({ args }, next) => (args.role === "ADMIN" ? next() : [])
    ]
  }
});
mw.content({
  // @ts-expect-error a User row has no title
  User: { name: [({ root }, next) => (root.title ? next() : "")] }
});
// The same in a module's own middleware, and in a feature's.
module.content({
  middleware: {
    // @ts-expect-error a User row has no title
    User: { name: [({ root }, next) => (root.title ? next() : "")] }
  }
});
mw.content.blog({
  // @ts-expect-error a User row has no title
  User: { articleCount: [({ root }, next) => (root.title ? next() : 0)] }
});
// A root type has no parent; "*" keys span fields, so they stay loose.
mw({
  Query: {
    node: [({ root, args }, next) => ((root ?? args.id) ? next() : null)]
  }
});
mw.content({
  User: {
    "*": [({ root }, next) => (typeof root === "object" ? next() : null)]
  }
});
// bypass holds the keys @bypass uses anywhere in the SDL.
const tokenCheck: MiddlewareFn = ({ bypass }, next) =>
  bypass.has("tokenCheck") || bypass.has("audit") ? next() : next();
const typo: MiddlewareFn = ({ bypass }, next) =>
  // @ts-expect-error no @bypass uses "tokenChek"
  bypass.has("tokenChek") ? next() : next();
mw({ "*": { "*": [tokenCheck, typo] } });

// A middleware written on its own is the exception: loose, so it fits any key.
const logged: MiddlewareFn = (_params, next) => next();
mw.content({ Query: { usersByRole: [logged] }, User: { name: [logged] } });

// ---- Field extensions -------------------------------------------------------

// { resolve, extensions }: extensions typed from FieldExtensions, with the
// field's own args and parent.
query.content({
  usersByRole: {
    resolve: () => [user],
    extensions: { complexity: (args) => (args.role === 1 ? 2 : 1) }
  }
});
resolvers.content.User({
  name: { extensions: { visible: (row) => row.roleId === 1 } }
});
// @ts-expect-error not a registered extension
query.content({ usersByRole: { extensions: { complexty: 2 } } });
// @ts-expect-error complexity is a number or a function of the args
query.content({ usersByRole: { extensions: { complexity: "high" } } });
query.content({
  usersByRole: {
    extensions: {
      // @ts-expect-error role is 1 | 2 here (CustomEnums), never "ADMIN"
      complexity: (args) => (args.role === "ADMIN" ? 1 : 0)
    }
  }
});
resolvers.content.User({
  name: {
    extensions: {
      // @ts-expect-error visible gets the User's row, which has no title
      visible: (row) => row.title === "x"
    }
  }
});
// @ts-expect-error the object form takes resolve and extensions only
query.content({ usersByRole: { resolve: () => [user], cost: 1 } });
// @ts-expect-error resolve keeps its type in the object form
query.content({ usersByRole: { resolve: () => 42 } });
// Keys added to graphql's GraphQLFieldExtensions count, still type-checked.
query.content({
  usersByRole: { extensions: { cacheControl: { maxAge: 60 } } }
});
query.content({
  usersByRole: {
    extensions: {
      // @ts-expect-error maxAge is a number
      cacheControl: { maxAge: "1m" }
    }
  }
});

// Read back through graphql, registered keys keep their types.
mw({
  "*": {
    "*": [
      ({ info, args }, next) => {
        const extensions =
          info.parentType.getFields()[info.fieldName]?.extensions;
        const complexity = extensions?.complexity;
        const cost: number =
          typeof complexity === "function"
            ? complexity(args)
            : (complexity ?? 1);
        // @ts-expect-error complexity is a number or a function, not a string
        const label: string | undefined = extensions?.complexity;
        return cost && label && next();
      }
    ]
  }
});

// generate.ts passed @copy to codegen, so olio() must get it too.
// @ts-expect-error codegen composed with @copy: directives are required
olio({ modules: [] });
olio({ modules: [], directives: [copyDirective()] });
// @ts-expect-error codegen wasn't given @implements
olio({ modules: [], directives: [implementsDirective()] });
