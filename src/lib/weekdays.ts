// The days of the week, in the order the database numbers them.
//
// availability_rules.weekday is `smallint check (weekday between 0 and 6)` with
// 0 = Sunday, so this array is indexed by that column and must stay in this order.
//
// It lives in its own module rather than beside the console's other shared reads
// because the availability editor is a client component: importing it from
// firm-data.ts would pull next/headers into the client graph and fail the build.
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type Weekday = (typeof WEEKDAYS)[number];
