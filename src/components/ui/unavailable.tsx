import { Alert } from "@/components/ui/alert";
import { isProductionDeployment } from "@/lib/env";

/**
 * The screen a signed-in person sees when their workspace cannot be resolved:
 * Supabase is unreachable or unconfigured, or the account belongs to no firm.
 *
 * It used to say "Supabase environment variables are not set. See .env.example"
 * to lawyers and clients. That sentence is for whoever deploys Docket, so it now
 * appears only outside production, beneath the one meant for the reader.
 */
export function WorkspaceUnavailable({ audience }: { audience: "staff" | "client" }) {
  return (
    <Alert kind="warning" title="This page is unavailable right now">
      {audience === "staff"
        ? "Docket could not open your firm's workspace. Either this account has not been added to a firm yet — ask your firm's owner to invite you — or the service could not be reached. Nothing has been changed; try again in a moment."
        : "Docket could not load your records just now. Nothing has been changed. Try again in a moment, and if it keeps happening, contact your firm."}
      {!isProductionDeployment() && (
        <span className="mt-1 block font-mono text-11">
          Developer note: check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).
        </span>
      )}
    </Alert>
  );
}
