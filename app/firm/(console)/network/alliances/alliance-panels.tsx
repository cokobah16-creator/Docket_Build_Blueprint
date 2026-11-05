"use client";

// Propose an alliance, answer one, leave or end one, and keep its notes. The rules are the
// database's: propose_alliance() takes only connected firms, respond_alliance() only a firm that
// was asked, leave_or_terminate_alliance() needs an owner or administrator, and a note is shared
// with accepted members or kept internal to the firm that wrote it.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Input, Select, Textarea, chipClasses } from "@/components/ui/input";
import { leaveOrTerminateAlliance, postAllianceNote, proposeAlliance, respondAlliance } from "@/lib/actions/network";
import { formatWhen } from "@/lib/time";
import { formatDay } from "@/lib/days";
import type { AllianceNoteRow, AllianceRosterRow, AllianceRow } from "@/lib/db/types";

const STATUS_TONE = { proposed: "waiting", active: "settled", terminated: "quiet" } as const;
const MEMBER_LABEL: Record<string, string> = { invited: "Asked", accepted: "In", declined: "Declined", left: "Left" };

export function AlliancePanels({
  firmId, canPropose, canAnswer, canTerminate, alliances, roster, notes, connected, areas, jurisdictions, timezone,
}: {
  firmId: string;
  canPropose: boolean;
  canAnswer: boolean;
  canTerminate: boolean;
  alliances: AllianceRow[];
  roster: AllianceRosterRow[];
  notes: AllianceNoteRow[];
  connected: Array<{ id: string; name: string }>;
  areas: Array<{ key: string; label: string }>;
  jurisdictions: Array<{ code: string; name: string }>;
  timezone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  // the proposal
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [pickedAreas, setPickedAreas] = useState<string[]>([]);
  const [pickedJurisdictions, setPickedJurisdictions] = useState<string[]>([]);
  const [procedure, setProcedure] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [renewsOn, setRenewsOn] = useState("");
  const [notesDraft, setNotesDraft] = useState<Record<string, { body: string; visibility: "shared" | "internal" }>>({});

  const areaLabel = new Map(areas.map((a) => [a.key, a.label]));
  const countryName = new Map(jurisdictions.map((j) => [j.code, j.name]));
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function run(id: string, fn: () => Promise<{ error: string } | undefined | { allianceId: string }>, after?: () => void) {
    setBusy(id);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r && "error" in r) {
      setError({ id, message: r.error });
      return;
    }
    after?.();
    router.refresh();
  }

  function propose(e: FormEvent) {
    e.preventDefault();
    void run("propose", () => proposeAlliance(firmId, {
      name, memberFirmIds: members, practiceAreas: pickedAreas, jurisdictions: pickedJurisdictions,
      referralProcedure: procedure, startsOn: startsOn || undefined, renewsOn: renewsOn || undefined,
    }), () => {
      setName(""); setMembers([]); setPickedAreas([]); setPickedJurisdictions([]); setProcedure(""); setStartsOn(""); setRenewsOn("");
    });
  }

  return (
    <div className="flex flex-col gap-3.5">
      {alliances.length === 0 ? (
        <Card>
          <EmptyState
            title="Your firm is in no alliance"
            hint="An alliance is a standing arrangement with firms you are connected to: who refers what to whom, in which jurisdictions. It shares no matter by itself."
          />
        </Card>
      ) : (
        alliances.map((a) => {
          const members = roster.filter((r) => r.alliance_id === a.id).sort((x, y) => (x.role === "founder" ? -1 : y.role === "founder" ? 1 : x.firm_name.localeCompare(y.firm_name)));
          const me = members.find((m) => m.firm_id === firmId);
          const myNotes = notes.filter((n) => n.alliance_id === a.id);
          const nameOf = (id: string) => members.find((m) => m.firm_id === id)?.firm_name ?? "A member firm";
          const draft = notesDraft[a.id] ?? { body: "", visibility: "shared" as const };
          return (
            <Card key={a.id}>
              <CardHeader title={a.name} />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[a.status]} icon={a.status === "active" ? "check" : a.status === "proposed" ? "clock" : "dot"}>{a.status === "proposed" ? "Proposed" : a.status === "active" ? "Active" : "Terminated"}</Badge>
                  {a.starts_on && <span className="text-13 text-ink-muted">From {formatDay(a.starts_on)}</span>}
                  {a.renews_on && <span className="text-13 text-ink-muted">Renews {formatDay(a.renews_on)}</span>}
                  {a.status === "terminated" && a.terminated_at && (
                    <span className="text-13 text-ink-muted">
                      Ended {formatWhen(a.terminated_at, timezone)} by {nameOf(a.terminated_by_firm_id ?? "")}{a.termination_reason ? `: ${a.termination_reason}` : ""}
                    </span>
                  )}
                </div>

                <ul className="divide-y divide-hairline rounded-card border border-hairline">
                  {members.map((m) => (
                    <li key={m.firm_id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="text-15 text-ink">
                        {m.firm_name}
                        <span className="text-13 text-ink-muted"> · {countryName.get(m.jurisdiction_code) ?? m.jurisdiction_code}{m.role === "founder" ? " · founder" : ""}</span>
                      </span>
                      <Badge tone={m.status === "accepted" ? "settled" : m.status === "invited" ? "waiting" : "quiet"} icon={m.status === "accepted" ? "check" : m.status === "invited" ? "clock" : "dot"}>{MEMBER_LABEL[m.status]}</Badge>
                    </li>
                  ))}
                </ul>

                {(a.practice_areas.length > 0 || a.jurisdictions.length > 0) && (
                  <p className="text-13 text-ink-muted">
                    {[a.practice_areas.map((k) => areaLabel.get(k) ?? k).join(", "), a.jurisdictions.map((c) => countryName.get(c) ?? c).join(", ")].filter(Boolean).join(" · ")}
                  </p>
                )}
                {a.referral_procedure && (
                  <div>
                    <p className="text-13 font-semibold text-ink-strong">How referrals work</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-15 text-ink">{a.referral_procedure}</p>
                  </div>
                )}

                {error?.id === a.id && <Alert kind="error" title="That was refused">{error.message}</Alert>}

                {a.status !== "terminated" && me && (
                  <div className="flex flex-wrap gap-2">
                    {me.status === "invited" && (
                      <>
                        <Button size="sm" disabled={!canAnswer || busy === a.id} onClick={() => run(a.id, () => respondAlliance(a.id, firmId, true))}>Join</Button>
                        <Button size="sm" variant="ghost" disabled={!canAnswer || busy === a.id} onClick={() => run(a.id, () => respondAlliance(a.id, firmId, false))}>Decline</Button>
                      </>
                    )}
                    {me.status === "accepted" && canTerminate && (
                      <>
                        <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => run(a.id, () => leaveOrTerminateAlliance(a.id, firmId, false))}>Leave</Button>
                        <Button size="sm" variant="danger" disabled={busy === a.id} onClick={() => run(a.id, () => leaveOrTerminateAlliance(a.id, firmId, true))}>End it for everybody</Button>
                      </>
                    )}
                  </div>
                )}

                {me && (me.status === "accepted" || myNotes.length > 0) && (
                  <div className="space-y-2 border-t border-hairline pt-3">
                    <p className="text-13 font-semibold text-ink-strong">Notes</p>
                    {myNotes.length === 0 && <p className="text-13 text-ink-muted">No notes yet.</p>}
                    <ul className="space-y-2">
                      {myNotes.map((n) => (
                        <li key={n.id} className="rounded-card border border-hairline px-3 py-2">
                          <p className="text-11 text-ink-muted">
                            {nameOf(n.firm_id)} · {formatWhen(n.created_at, timezone)} · {n.visibility === "internal" ? "internal to your firm" : "shared with members"}
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap text-15 text-ink">{n.body}</p>
                        </li>
                      ))}
                    </ul>
                    {me.status === "accepted" && a.status !== "terminated" && (
                      <form
                        className="space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(a.id, () => postAllianceNote(a.id, firmId, draft.visibility, draft.body), () =>
                            setNotesDraft((d) => ({ ...d, [a.id]: { body: "", visibility: draft.visibility } })));
                        }}
                      >
                        <Textarea label="Add a note" value={draft.body} maxLength={4000} required
                          onChange={(e) => setNotesDraft((d) => ({ ...d, [a.id]: { ...draft, body: e.target.value } }))} />
                        <div className="flex flex-wrap items-end gap-2">
                          <Select label="Who reads it" value={draft.visibility}
                            onChange={(e) => setNotesDraft((d) => ({ ...d, [a.id]: { ...draft, visibility: e.target.value as "shared" | "internal" } }))}>
                            <option value="shared">Every member firm</option>
                            <option value="internal">Your firm only</option>
                          </Select>
                          <Button type="submit" size="sm" disabled={busy === a.id}>Post</Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })
      )}

      <Card>
        <CardHeader title="Propose an alliance" />
        <CardBody>
          {connected.length === 0 ? (
            <p className="text-15 text-ink-muted">An alliance is between firms you are connected to. Connect with a firm first, from Docket Network.</p>
          ) : (
            <form onSubmit={propose} className="space-y-4">
              <fieldset disabled={!canPropose || busy === "propose"} className="space-y-4">
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="For example, West Africa Shipping Group" />
                <div>
                  <p className="text-13 font-semibold text-ink-strong">Firms to ask</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {connected.map((c) => (
                      <button key={c.id} type="button" aria-pressed={members.includes(c.id)} onClick={() => setMembers(flip(members, c.id))} className={chipClasses(members.includes(c.id))}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-13 font-semibold text-ink-strong">Practice areas</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {areas.map((a) => (
                      <button key={a.key} type="button" aria-pressed={pickedAreas.includes(a.key)} onClick={() => setPickedAreas(flip(pickedAreas, a.key))} className={chipClasses(pickedAreas.includes(a.key))}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-13 font-semibold text-ink-strong">Jurisdictions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {jurisdictions.map((j) => (
                      <button key={j.code} type="button" aria-pressed={pickedJurisdictions.includes(j.code)} onClick={() => setPickedJurisdictions(flip(pickedJurisdictions, j.code))} className={chipClasses(pickedJurisdictions.includes(j.code))}>
                        {j.name}
                      </button>
                    ))}
                  </div>
                </div>
                <Textarea label="How referrals work" value={procedure} onChange={(e) => setProcedure(e.target.value)} maxLength={4000}
                  hint="Who refers what to whom, and how fees are handled between the firms." />
                <div className="grid gap-4 md:grid-cols-2">
                  <Input label="Starts on" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                  <Input label="Renews on" type="date" value={renewsOn} onChange={(e) => setRenewsOn(e.target.value)} />
                </div>
              </fieldset>
              {error?.id === "propose" && <Alert kind="error" title="That was refused">{error.message}</Alert>}
              {!canPropose && <p className="text-13 text-ink-muted">Proposing needs a verified firm and the invite firms permission.</p>}
              <Button type="submit" disabled={!canPropose || busy === "propose" || members.length === 0}>
                {busy === "propose" ? "Proposing…" : "Propose the alliance"}
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
