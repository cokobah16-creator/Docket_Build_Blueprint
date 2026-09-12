// /firm/admin/baseline — what the firm's rows say over a window, and the dated records of it.
//
// The assessment's twenty-fifth recommendation: record the baseline before claiming any saving.
// Every figure here is computed by the database from this firm's own rows (firm_metrics, which
// asks admin_w — see below); the caveats it returns are printed as it wrote them. Reading them
// and recording one are both an owner's or administrator's act with a second factor, and the
// record cannot afterwards be edited.

import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import type { FirmBaselineRow, FirmMetrics } from "@/lib/db/types";
import { BaselinePanel } from "./baseline-panel";

export const metadata = { title: "Baseline" };

export default async function BaselinePage({ searchParams }: { searchParams: Promise<{ firm?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId } = ctx;
  // Thirty days back by default, and whatever the reader asked for otherwise.
  const to = sp.to && !Number.isNaN(Date.parse(sp.to)) ? new Date(sp.to) : new Date();
  const from = sp.from && !Number.isNaN(Date.parse(sp.from)) ? new Date(sp.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // firm_metrics() asks admin_w(): it reads across every matter of the firm, money included, over
  // a window the caller chooses — so it is an owner's or administrator's read, as recording a
  // baseline already was. A lawyer is told that rather than shown a refusal.
  const [{ data: metrics, error: metricsError }, { data: rows, error: rowsError }] = await Promise.all([
    ctx.isAdmin
      ? supabase.rpc("firm_metrics", { p_firm: firmId, p_from: from.toISOString(), p_to: to.toISOString() })
      : Promise.resolve({ data: null, error: null }),
    supabase.from("firm_baselines").select("id, firm_id, taken_at, window_from, window_to, metrics, stated, note, taken_by")
      .eq("firm_id", firmId).order("taken_at", { ascending: false }).limit(50),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Baseline</h1>
        <p className="text-sm text-gray-600">{ctx.firmName} · what your own records say, over a window you choose</p>
      </header>
      {metricsError && <Alert kind="error" title="The figures could not be computed">{metricsError.message}. That is a failed read, not a firm with no work.</Alert>}
      {rowsError && <Alert kind="error" title="The records could not be read">{rowsError.message}.</Alert>}
      {!ctx.isAdmin && (
        <Alert kind="info" title="An owner or administrator sees this">
          You are {ctx.role} here. The baseline reads across every matter of the firm, money included, so it is kept to the
          principals — the same people who record one. The baselines already taken are listed below.
        </Alert>
      )}
      <BaselinePanel
        firmId={firmId}
        timezone={ctx.timezone}
        canWrite={ctx.isAdmin}
        from={from.toISOString()}
        to={to.toISOString()}
        metrics={(metrics ?? null) as FirmMetrics | null}
        baselines={(rows ?? []) as FirmBaselineRow[]}
      />
    </div>
  );
}
