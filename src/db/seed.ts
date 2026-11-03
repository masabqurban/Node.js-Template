import { randomUUID } from 'node:crypto';

import type { Container } from '../container.js';
import type { Role } from '../shared/auth/permissions.js';
import type { UserStatus } from '../modules/users/users.repository.js';

/**
 * PLACEHOLDER DATA for development and demos. Every name and email is
 * fictional. Refuses to run in production (see `parseConfig`).
 */
export const DEMO_ACCOUNT = { email: 'demo@example.com', password: 'password123' };

const firstNames = [
  'Ava',
  'Liam',
  'Mia',
  'Noah',
  'Zoe',
  'Ethan',
  'Ivy',
  'Lucas',
  'Nora',
  'Owen',
  'Ruby',
  'Leo',
  'Isla',
  'Mason',
  'Chloe',
  'Elias',
];
const lastNames = [
  'Turner',
  'Brooks',
  'Hayes',
  'Price',
  'Bennett',
  'Foster',
  'Reed',
  'Coleman',
  'Ward',
  'Hughes',
  'Perry',
  'Long',
];
const roles: Role[] = ['viewer', 'editor', 'viewer', 'admin', 'viewer', 'editor'];
const statuses: UserStatus[] = ['active', 'active', 'active', 'invited', 'active', 'suspended'];
const DAY = 86_400_000;

export async function seedDemoData(container: Container) {
  const { users } = container.repositories;
  if (await users.findByEmail(DEMO_ACCOUNT.email)) return;

  const now = container.now().getTime();

  await users.create({
    id: randomUUID(),
    name: 'Demo Admin',
    email: DEMO_ACCOUNT.email,
    role: 'admin',
    status: 'active',
    passwordHash: await container.hasher.hash(DEMO_ACCOUNT.password),
    createdAt: new Date(now - 200 * DAY),
    lastActiveAt: new Date(now),
  });

  // Spread over the last ~6 months, so the dashboard chart has data.
  for (let index = 0; index < 47; index++) {
    const first = firstNames[(index * 7) % firstNames.length] ?? 'Alex';
    const last = lastNames[(index * 5) % lastNames.length] ?? 'Doe';
    const status = statuses[index % statuses.length] ?? 'active';
    await users.create({
      id: randomUUID(),
      name: `${first} ${last}`,
      email: `${first}.${last}${index + 2}@example.com`.toLowerCase(),
      role: roles[index % roles.length] ?? 'viewer',
      status,
      // Seeded users have no password, so only the demo account can sign in.
      passwordHash: null,
      createdAt: new Date(now - (index * 3.7 + 1) * DAY),
      lastActiveAt: status === 'invited' ? null : new Date(now - (index % 9) * DAY),
    });
  }

  container.logger.info(
    `Seeded demo data. Sign in with ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`,
  );
}
