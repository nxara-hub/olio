import { resolvers } from "@nxlab/olio";

export const User = resolvers.users.User({
  // `user` is a UserRow: the mapper for User.
  name: (user, { trim }) => (trim ? user.name.trim() : user.name),
  role: (user) => user.role
});
