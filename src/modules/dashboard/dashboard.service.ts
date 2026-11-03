import type { UserFilter } from '../users/users.repository.js';

type Dependencies = {
  /** Only counting is needed; any user repository satisfies this. */
  users: { count(filter: UserFilter): Promise<number> };
  now?: () => Date;
};

const DAY = 86_400_000;
const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** Change between two periods as a ratio: 0.12 = +12%. */
export function ratioChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 1;
  return Math.round(((current - previous) / previous) * 1000) / 1000;
}

/**
 * Aggregates for the dashboard. Everything is a COUNT query, so a database
 * implementation stays fast (one indexed count per number).
 */
export function createDashboardService({ users, now = () => new Date() }: Dependencies) {
  return {
    async summary() {
      const today = now();
      const monthAgo = new Date(today.getTime() - 30 * DAY);
      const twoMonthsAgo = new Date(today.getTime() - 60 * DAY);

      const [
        total,
        active,
        invited,
        suspended,
        newThisMonth,
        newLastMonth,
        activeBefore,
        invitedBefore,
      ] = await Promise.all([
        users.count({}),
        users.count({ status: 'active' }),
        users.count({ status: 'invited' }),
        users.count({ status: 'suspended' }),
        users.count({ createdFrom: monthAgo }),
        users.count({ createdFrom: twoMonthsAgo, createdBefore: monthAgo }),
        // Approximation without status history: accounts that already existed
        // 30 days ago, by their current status. Store status changes to be exact.
        users.count({ status: 'active', createdBefore: monthAgo }),
        users.count({ status: 'invited', createdBefore: monthAgo }),
      ]);
      const totalLastMonth = total - newThisMonth;

      // Calendar months, oldest first, ending with the current month.
      const months = Array.from({ length: 6 }, (_, index) => {
        const start = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (5 - index), 1),
        );
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        return { start, end };
      });
      const signups = await Promise.all(
        months.map(async ({ start, end }) => ({
          month: monthName.format(start),
          count: await users.count({ createdFrom: start, createdBefore: end }),
        })),
      );

      return {
        stats: [
          {
            key: 'users',
            label: 'Total users',
            value: total,
            change: ratioChange(total, totalLastMonth),
            unit: 'count' as const,
          },
          {
            key: 'new',
            label: 'New this month',
            value: newThisMonth,
            change: ratioChange(newThisMonth, newLastMonth),
            unit: 'count' as const,
          },
          {
            key: 'active',
            label: 'Active users',
            value: active,
            change: ratioChange(active, activeBefore),
            unit: 'count' as const,
          },
          {
            key: 'pending',
            label: 'Pending invites',
            value: invited,
            change: ratioChange(invited, invitedBefore),
            unit: 'count' as const,
          },
        ],
        suspended,
        signups,
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
