import type { Context } from "@nxlab/olio";

import type { Role } from "../../generated.js";

export interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  // ponytail: demo only. Store a hash (argon2/bcrypt) in a real system.
  password: string;
}

const employees: readonly EmployeeRow[] = [
  {
    id: "e1",
    name: "Ada Admin",
    email: "ada@erp.test",
    role: "ADMIN",
    password: "demo"
  },
  {
    id: "e2",
    name: "Mia Manager",
    email: "mia@erp.test",
    role: "MANAGER",
    password: "demo"
  },
  {
    id: "e3",
    name: "Carl Clerk",
    email: "carl@erp.test",
    role: "CLERK",
    password: "demo"
  }
];

const employeeIdByToken = new Map<string, string>();

export const employee = (id: string): EmployeeRow | undefined =>
  employees.find((e) => e.id === id);

export function signIn(
  email: string,
  password: string
): { token: string; employee: EmployeeRow } | undefined {
  const found = employees.find(
    (e) => e.email === email && e.password === password
  );
  if (!found) return undefined;
  const token = crypto.randomUUID();
  employeeIdByToken.set(token, found.id);
  return { token, employee: found };
}

export const signOut = (token: string): boolean =>
  employeeIdByToken.delete(token);

export function viewerFor(token: string): Context["viewer"] {
  const found = employee(employeeIdByToken.get(token) ?? "");
  return found && { id: found.id, role: found.role, token };
}
