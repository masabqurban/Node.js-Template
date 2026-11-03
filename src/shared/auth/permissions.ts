export const roles = ['admin', 'editor', 'viewer'] as const;
export type Role = (typeof roles)[number];

/**
 * Role-based access control in one table. Routes ask for a permission, never
 * for a role, so changing who can do what is a one-line edit here.
 */
const grants = {
  'users:read': ['admin', 'editor', 'viewer'],
  'users:write': ['admin'],
  'dashboard:read': ['admin', 'editor', 'viewer'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof grants;

export function can(role: Role, permission: Permission): boolean {
  return (grants[permission] as readonly Role[]).includes(role);
}
