"use server";

// Every write the platform console makes.
//
// LAW 1 — the database decides. Not one rule below is re-implemented here: create_firm(),
// set_firm_status(), set_firm_plan() and set_firm_domain() each check is_platform_admin() and
// mfa_ok() for themselves, and the domain_requests table is written under its own RLS policy
// (migration 20). The zod schemas exist only to stop a malformed value reaching Postgres as a
// type error instead of as a sentence. When the database says no, its words are returned
// unchanged, because the words carry the reason — "that domain is already mapped to another
// firm" tells an operator what to do next and "Forbidden" does not.
//
// THE ORDER OF THE TWO SYSTEMS. Postgres cannot make an outbound request, so a hostname is only
// safe to write once Vercel has agreed to serve it. Every path that maps a domain therefore
// calls the provider FIRST and writes firms.custom_domain SECOND. A domain written the other way
// round is a firm's entire public site pointing at a host that answers nothing.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { NG_STATES } from "@/lib/nigeria";
import { captureException } from "@/lib/observability";
import { deploymentHost } from "@/lib/admin-data";
import { addDomain, getDomain, removeDomain, type DomainResult } from "@/lib/providers/domains/vercel";
import type { CreateFirmResult, DomainRequestRow } from "@/lib/db/types";

/** Host lookups are cached per instance in src/lib/tenant.ts; say so rather than let them guess. */
const CACHE_NOTE =
  "Docket caches host lookups for 60 seconds on each running instance, so the new address can " +
  "take about a minute to start resolving. That is not a failure.";

export type AdminCreateFirmState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  created?: { slug: string; firm_id: string; reference_prefix: string };
};

/** The result of one control on one firm. `notice` is true and worth reading; it is not an error. */
export type FirmWriteState = { error?: string; done?: string; notice?: string };

/** The result of acting on one domain request. */
export type DomainRequestState = { error?: string; done?: string; notice?: string };

const NOT_CONFIGURED = "Supabase is not configured on this deployment, so nothing can be saved.";

function firstIssue(error: z.ZodError): { error: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { error: "Please check the highlighted fields.", fieldErrors };
}

// ================================================================ creating a firm for an owner
//
// The field set is the one verification actually reads, copied from app/firm/(auth)/start —
// legal name and RC/BN number are what the CAC register is checked against, and the owner's
// SCN is what the Roll of Legal Practitioners is checked against. A firm created without them
// can be created but cannot honestly be activated, so they are asked for here.

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use lowercase letters, numbers and hyphens"),
  ownerEmail: z.string().trim().email("Give the owner's email exactly as they signed up"),
  legalName: z.string().trim().max(200).optional().or(z.literal("")),
  rcNumber: z.string().trim().max(40).optional().or(z.literal("")),
  stateCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => c === "" || c in NG_STATES, "Choose a state")
    .optional()
    .or(z.literal("")),
  ownerScn: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function createFirmForOwner(
  _prev: AdminCreateFirmState,
  formData: FormData,
): Promise<AdminCreateFirmState> {
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    ownerEmail: formData.get("ownerEmail"),
    legalName: formData.get("legalName") ?? "",
    rcNumber: formData.get("rcNumber") ?? "",
    stateCode: formData.get("stateCode") ?? "",
    ownerScn: formData.get("ownerScn") ?? "",
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };

  // p_owner_email is the platform-only branch of create_firm(): it refuses for anybody who is
  // not a platform admin with MFA, and it refuses if no account with that email exists yet.
  const { data, error } = await supabase.rpc("create_firm", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_legal_name: parsed.data.legalName || null,
    p_rc_number: parsed.data.rcNumber || null,
    p_state_code: parsed.data.stateCode || null,
    p_owner_email: parsed.data.ownerEmail,
    p_owner_scn: parsed.data.ownerScn || null,
  });
  if (error) return { error: error.message };

  const result = data as CreateFirmResult | null;
  if (!result?.firm_id) return { error: "The firm was not created." };

  revalidatePath("/admin");
  return {
    created: { slug: result.slug, firm_id: result.firm_id, reference_prefix: result.reference_prefix },
  };
}

// ================================================================ lifecycle: status and plan

const noteSchema = z.string().trim().max(500).optional().or(z.literal(""));

const statusSchema = z.object({
  firmId: z.string().uuid(),
  status: z.enum(["pending", "active", "suspended"]),
  note: noteSchema,
});

export async function setFirmStatus(_prev: FirmWriteState, formData: FormData): Promise<FirmWriteState> {
  const parsed = statusSchema.safeParse({
    firmId: formData.get("firmId"),
    status: formData.get("status"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Choose a status for this firm." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };

  // A platform admin has no UPDATE on firms at all. set_firm_status() is the only way these
  // columns move: it stamps verified_at the first time a firm goes active, audits the change,
  // and queues the firm_activated message.
  const { error } = await supabase.rpc("set_firm_status", {
    p_firm: parsed.data.firmId,
    p_status: parsed.data.status,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  const done =
    parsed.data.status === "active"
      // Activation opens the public site. It does NOT open bookings on its own: book_appointment()
      // refuses while terms or privacy carry a "0-" version, and every firm starts that way.
      ? "Active. The public site is open. Bookings open once the firm has published its terms and privacy notice — until then book_appointment() refuses every one."
      : parsed.data.status === "suspended"
        ? "Suspended. Every write this firm makes is now refused; its reads still work."
        : "Pending. The firm is off the public site until it is activated again.";
  return { done };
}

const planSchema = z.object({
  firmId: z.string().uuid(),
  plan: z.enum(["free", "standard", "enterprise"]),
  note: noteSchema,
});

export async function setFirmPlan(_prev: FirmWriteState, formData: FormData): Promise<FirmWriteState> {
  const parsed = planSchema.safeParse({
    firmId: formData.get("firmId"),
    plan: formData.get("plan"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Choose a plan for this firm." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };

  const { error } = await supabase.rpc("set_firm_plan", {
    p_firm: parsed.data.firmId,
    p_plan: parsed.data.plan,
    p_note: parsed.data.note || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { done: `Plan set to ${parsed.data.plan}.` };
}

// ================================================================ domains
//
// Two ways a domain gets mapped: an operator types one straight onto a firm, or an operator
// fulfils a request the firm made. Both go through the same two systems in the same order.

/** Turn a provider failure into the sentence the operator should read, quoting Vercel itself. */
function providerMessage(result: Extract<DomainResult, { ok: false }>): string {
  switch (result.reason) {
    case "not_configured":
      return result.message;
    case "taken":
      return `Vercel will not serve that hostname: ${result.message}`;
    case "not_found":
      return `Vercel is not holding that hostname for this project: ${result.message}`;
    case "unreachable":
      return `${result.message} Nothing was written, so you can try again.`;
    default:
      return `Vercel refused it: ${result.message}`;
  }
}

/** The outstanding registrar records, as one readable sentence. */
function outstanding(records: Array<{ type: string; domain: string; value: string }>): string {
  if (records.length === 0) return "";
  return records.map((r) => `${r.type} ${r.domain} → ${r.value}`).join("; ");
}

const domainSchema = z.object({
  firmId: z.string().uuid(),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .refine(
      (d) => d === "" || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d),
      "A custom domain is a bare hostname: chambers.example.ng — no https://, no port, no path.",
    ),
  currentDomain: z.string().trim().toLowerCase().max(255).optional().or(z.literal("")),
  note: noteSchema,
  /** Ticked by an operator whose deployment is not on Vercel, or whose DNS is managed elsewhere. */
  force: z.union([z.literal("on"), z.literal("")]).optional(),
});

export async function setFirmDomain(_prev: FirmWriteState, formData: FormData): Promise<FirmWriteState> {
  const parsed = domainSchema.safeParse({
    firmId: formData.get("firmId"),
    domain: formData.get("domain") ?? "",
    currentDomain: formData.get("currentDomain") ?? "",
    note: formData.get("note") ?? "",
    force: formData.get("force") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the hostname." };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { firmId, domain, currentDomain, note } = parsed.data;
  const force = parsed.data.force === "on";

  // ---- unmapping. The database first this time, and on purpose: a hostname Vercel still holds
  // for a firm that no longer claims it serves a 404, which is harmless. The reverse — a firm
  // claiming a hostname nothing serves — is the broken site this whole ordering exists to avoid.
  if (domain === "") {
    // What gets deleted from Vercel comes from the DATABASE, never from the form. The hidden
    // field is the operator's browser telling us what it believed when the page was rendered, and
    // a card left open while somebody else remaps that hostname to another firm would, on this
    // click, take the OTHER firm's live site off the project. Read it, then unmap it.
    const { data: beforeRow } = await supabase
      .from("firm_admin")
      .select("custom_domain")
      .eq("id", firmId)
      .maybeSingle();
    const liveDomain = (beforeRow as { custom_domain: string | null } | null)?.custom_domain ?? null;

    const { error } = await supabase.rpc("set_firm_domain", {
      p_firm: firmId,
      p_domain: null,
      p_note: note || null,
    });
    if (error) return { error: error.message };
    revalidatePath("/admin");

    if (!liveDomain) return { done: "This firm has no custom domain. It is reached at its Docket address." };
    const currentDomain = liveDomain;
    const removed = await removeDomain(currentDomain);
    if (!removed.ok) {
      return {
        done: `${currentDomain} is no longer mapped to this firm.`,
        notice: `It is still on the Vercel project — ${providerMessage(removed)} Take it off there yourself if another firm needs it.`,
      };
    }
    return {
      done: `${currentDomain} is no longer mapped to this firm.`,
      notice: removed.removed
        ? "It has also been taken off the Vercel project."
        : "Vercel was not holding it, so there was nothing to take off there.",
    };
  }

  // ---- mapping. Vercel first, always.
  const added = await addDomain(domain);
  if (!added.ok) {
    if (added.reason === "unreachable") {
      await captureException(new Error(added.message), {
        where: "platform domain mapping",
        tags: { provider: "vercel", firm: firmId },
        extra: { hostname: domain },
      });
    }
    if (added.reason === "not_configured" && force) {
      // The operator has said the deployment is not on Vercel. Write it, and say plainly that
      // nothing checked whether the host is served.
      const { error } = await supabase.rpc("set_firm_domain", {
        p_firm: firmId,
        p_domain: domain,
        p_note: note || null,
      });
      if (error) return { error: error.message };
      revalidatePath("/admin");
      return {
        done: `${domain} is mapped to this firm.`,
        notice: `No provider was asked to serve it — point ${domain} at this deployment yourself. ${CACHE_NOTE}`,
      };
    }
    return { error: providerMessage(added) };
  }

  if (!added.verified && !force) {
    const records = outstanding(added.verification);
    return {
      error:
        `Vercel is holding ${added.host} but has not verified it yet, so the site would not load. ` +
        (records
          ? `The firm has to add this at its registrar first: ${records}.`
          : "Vercel returned no records to add; check the domain in the Vercel dashboard.") +
        " Tick “map it anyway” if you are certain this deployment already answers for it.",
    };
  }
  if (added.misconfigured === true && !force) {
    const host = await deploymentHost();
    return {
      error:
        `Vercel has ${added.host} but DNS is not pointing here yet${host ? `, so nothing answers for it. Point it at ${host}` : ""}. ` +
        "Tick “map it anyway” if you know the DNS change is already on its way.",
    };
  }

  const { error } = await supabase.rpc("set_firm_domain", {
    p_firm: firmId,
    p_domain: domain,
    p_note: note || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return {
    done: `${added.host} is mapped to this firm.`,
    notice:
      added.misconfigured === true
        ? `Vercel still reports DNS as not pointing here. ${CACHE_NOTE}`
        : CACHE_NOTE,
  };
}

// ================================================================ the domain-request queue

const requestSchema = z.object({
  requestId: z.string().uuid(),
  note: noteSchema,
  force: z.union([z.literal("on"), z.literal("")]).optional(),
});

/**
 * The request row is read from the database rather than taken from the form. The hostname and
 * the firm decide what gets written to a live deployment; a hidden input is the operator's
 * browser telling us what it feels like, and those are not the same thing.
 */
async function openRequest(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  requestId: string,
): Promise<{ row: DomainRequestRow } | { error: string }> {
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase
    .from("domain_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (error) return { error: error.message };
  const row = data as DomainRequestRow | null;
  if (!row) return { error: "That request is not there any more." };
  if (row.status !== "requested" && row.status !== "verifying") {
    return { error: `That request was already ${row.status}. Nothing to do.` };
  }
  return { row };
}

/** The signed-in platform admin, for domain_requests.decided_by. Null if the session is gone. */
async function callerId(supabase: Awaited<ReturnType<typeof supabaseServer>>): Promise<string | null> {
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** What we keep from the provider, so the screen does not have to re-ask Vercel on every render. */
function verificationBlob(result: Extract<DomainResult, { ok: true }>) {
  return {
    provider: "vercel",
    checked_at: new Date().toISOString(),
    verified: result.verified,
    misconfigured: result.misconfigured,
    records: result.verification,
  };
}

/**
 * Step one of the handshake: ask Vercel to serve the hostname and write down what the firm has
 * to add at its registrar. Nothing about the firm changes here — firms.custom_domain is
 * untouched until step two, so a half-finished handshake leaves the firm exactly where it was.
 */
export async function startDomainRequest(
  _prev: DomainRequestState,
  formData: FormData,
): Promise<DomainRequestState> {
  const parsed = requestSchema.safeParse({
    requestId: formData.get("requestId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Invalid request." };

  const supabase = await supabaseServer();
  const found = await openRequest(supabase, parsed.data.requestId);
  if ("error" in found) return { error: found.error };
  const row = found.row;

  const added = await addDomain(row.hostname);
  if (!added.ok) {
    if (added.reason === "unreachable") {
      await captureException(new Error(added.message), {
        where: "platform domain request",
        tags: { provider: "vercel", firm: row.firm_id },
        extra: { hostname: row.hostname, request: row.id },
      });
    }
    return { error: providerMessage(added) };
  }

  const { data: updated, error } = await supabase!
    .from("domain_requests")
    .update({
      status: "verifying",
      verification: verificationBlob(added),
      note: parsed.data.note || row.note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) {
    return {
      error:
        "Vercel accepted the hostname but the database did not record it. Your session may no " +
        "longer be an MFA-verified platform admin session — sign in again and press this once more.",
    };
  }

  revalidatePath("/admin");
  const records = outstanding(added.verification);
  return {
    done: `Vercel is holding ${added.host}.`,
    notice: added.verified
      ? "Vercel has already verified it. Map it and go live."
      : records
        ? `Send the firm these records: ${records}. Come back and map it once they are in place.`
        : "Vercel returned no records to add. Check the domain in the Vercel dashboard before mapping it.",
  };
}

/**
 * Step two: Vercel is asked again, and only if it confirms the hostname does set_firm_domain()
 * write it. The request is marked live last, so nothing ever claims live while the firm's row
 * still says otherwise.
 */
export async function completeDomainRequest(
  _prev: DomainRequestState,
  formData: FormData,
): Promise<DomainRequestState> {
  const parsed = requestSchema.safeParse({
    requestId: formData.get("requestId"),
    note: formData.get("note") ?? "",
    force: formData.get("force") ?? "",
  });
  if (!parsed.success) return { error: "Invalid request." };
  const force = parsed.data.force === "on";

  const supabase = await supabaseServer();
  const found = await openRequest(supabase, parsed.data.requestId);
  if ("error" in found) return { error: found.error };
  const row = found.row;

  const current = await getDomain(row.hostname);
  if (!current.ok) {
    if (current.reason === "not_found") {
      return { error: `Add ${row.hostname} to Vercel first — that is the button above this one.` };
    }
    if (current.reason === "unreachable") {
      await captureException(new Error(current.message), {
        where: "platform domain request",
        tags: { provider: "vercel", firm: row.firm_id },
        extra: { hostname: row.hostname, request: row.id },
      });
    }
    if (!(current.reason === "not_configured" && force)) return { error: providerMessage(current) };
  }

  if (current.ok) {
    // Write down what we just learned either way, so the screen shows the firm the current
    // records even when this attempt stops here.
    await supabase!
      .from("domain_requests")
      .update({ verification: verificationBlob(current), updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (!current.verified && !force) {
      const records = outstanding(current.verification);
      return {
        error:
          `Vercel has not verified ${row.hostname} yet, so the site would not load. ` +
          (records ? `Still outstanding at the registrar: ${records}.` : "Vercel returned no records to add.") +
          " Tick “go live anyway” only if you are certain this deployment already answers for it.",
      };
    }
    if (current.misconfigured === true && !force) {
      const host = await deploymentHost();
      return {
        error:
          `DNS for ${row.hostname} is not pointing at this deployment yet${host ? ` — point it at ${host}` : ""}. ` +
          "Tick “go live anyway” if the DNS change is already on its way.",
      };
    }
  }

  // Vercel has agreed. Now, and only now, the database.
  const { error: rpcError } = await supabase!.rpc("set_firm_domain", {
    p_firm: row.firm_id,
    p_domain: row.hostname,
    p_note: parsed.data.note || `domain request ${row.id}`,
  });
  if (rpcError) return { error: rpcError.message };

  const { data: updated, error } = await supabase!
    .from("domain_requests")
    .update({
      status: "live",
      note: parsed.data.note || row.note,
      decided_by: await callerId(supabase),
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error:
        `${row.hostname} is mapped to the firm, but the request could not be marked live: ${error.message}`,
    };
  }
  if (!updated) {
    return {
      notice: `${row.hostname} is mapped to the firm, but the request row did not change. ${CACHE_NOTE}`,
      error: "Check your session is still MFA-verified, then mark the request live again.",
    };
  }

  revalidatePath("/admin");
  return { done: `${row.hostname} now serves this firm.`, notice: CACHE_NOTE };
}

/**
 * Turning a request down. The hostname comes off Vercel first — leaving it there would keep it
 * out of reach of the firm that should have it — and the reason is written where the firm can
 * read it, because a refusal without a reason is a dead end.
 */
export async function rejectDomainRequest(
  _prev: DomainRequestState,
  formData: FormData,
): Promise<DomainRequestState> {
  const parsed = z
    .object({ requestId: z.string().uuid(), note: z.string().trim().min(3, "Say why, so the firm can act on it.").max(500) })
    .safeParse({ requestId: formData.get("requestId"), note: formData.get("note") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };

  const supabase = await supabaseServer();
  const found = await openRequest(supabase, parsed.data.requestId);
  if ("error" in found) return { error: found.error };
  const row = found.row;

  // A hostname can be mapped straight onto a firm's card without the queue ever being closed, so
  // an open request may name a domain that is LIVE for somebody. Taking that off Vercel would
  // stop a real firm's site resolving. Check before touching the provider.
  const { data: liveOn } = await supabase!
    .from("firm_admin")
    .select("id, name, custom_domain")
    .eq("custom_domain", row.hostname)
    .maybeSingle();
  const live = liveOn as { id: string; name: string } | null;
  if (live) {
    return {
      error:
        `${row.hostname} is live for ${live.name} right now, so this request is stale rather than ` +
        `refusable — turning it down here would take that firm's site off the Vercel project. ` +
        `Unmap it on ${live.name}'s card first if that is what you mean to do.`,
    };
  }

  let providerNotice = "";
  const removed = await removeDomain(row.hostname);
  if (!removed.ok) {
    if (removed.reason !== "not_configured") return { error: providerMessage(removed) };
    providerNotice = " Vercel is not configured here, so nothing was taken off a provider.";
  } else if (removed.removed) {
    providerNotice = " It has been taken off the Vercel project.";
  }

  const { data: updated, error } = await supabase!
    .from("domain_requests")
    .update({
      status: "rejected",
      note: parsed.data.note,
      decided_by: await callerId(supabase),
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) {
    return {
      error:
        "The database did not change that request. Check your session is still an MFA-verified " +
        "platform admin session and try again.",
    };
  }

  revalidatePath("/admin");
  return { done: `${row.hostname} was turned down. The firm can read your reason.${providerNotice}` };
}
