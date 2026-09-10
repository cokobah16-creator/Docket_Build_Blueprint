export { captureException, type ErrorContext } from "./sentry";
export { capture, identify, FUNNEL, type FunnelEvent } from "./posthog";

/** The cookie the middleware mints so a visitor can be counted before they sign in. */
export const VISITOR_COOKIE = "docket_did";
