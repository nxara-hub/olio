import type { Role } from "../../generated.js";

/**
 * How users are stored. `User` is mapped to this (see `mappers` in
 * types.d.ts), so resolvers return rows and `User` field resolvers read them.
 */
export interface UserRow {
  _id: string;
  name: string;
  role: Role;
}

/** In-memory users, shared by every feature of the module. */
export const store = new Map<string, UserRow>([
  ["1", { _id: "1", name: "  Ada Lovelace  ", role: "Admin" }],
  ["2", { _id: "2", name: "Alan Turing", role: "Guest" }]
]);
