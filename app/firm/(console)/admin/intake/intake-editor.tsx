"use client";

// The intake form builder: a list of forms, a plain textarea holding the questions as JSON, and
// a live preview that renders them exactly the way the booking wizard will.
//
// Why a textarea and not a drag-and-drop builder: nothing can be installed in this environment —
// no editor component, no JSON widget, no CDN — and a builder that pretends to be one while
// silently dropping what it cannot express would be worse than the truth. So the questions are
// edited as JSON, parsed on every keystroke, and the preview underneath is the real check: if a
// question does not appear there, it will not appear for a client either.
//
// Rules obeyed here:
//  · The database is the authorization layer. saveIntakeForm() and deleteIntakeForm() write
//    intake_forms as the signed-in person; admin_w(firm_id) answers. Nothing here decides who
//    may write, and every refusal is shown in the database's words.
//  · The checks below are a courtesy to the person typing. The SAME checks run in the server
//    action, which is the rule — a server action is a public endpoint and the column has no
//    validation of its own.
//  · The service picker only ever offers this firm's own services: intake_forms.service_id is
//    not covered by check_row_firm(), so the database itself would accept another firm's id.
//  · Mobile first: one column at 390px, 44px targets. The JSON box is the only thing that may
//    scroll sideways, and it does so inside itself.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteIntakeForm, saveIntakeForm } from "@/lib/actions/services";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { IntakeQuestion } from "@/lib/db/types";

export interface FormView {
  id: string;
  name: string;
  serviceId: string | null;
  serviceName: string | null;
  isActive: boolean;
  schemaJson: string;
  questionCount: number;
  responseCount: number;
}

export interface ServiceOption {
  id: string;
  name: string;
  isActive: boolean;
}

type Answers = Record<string, string | string[]>;

const field =
  "mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 focus:border-brand focus:outline focus:outline-2 focus:outline-brand";
const labelClass = "block text-sm font-medium text-gray-800";
const KEY_RE = /^[a-z][a-z0-9_]*$/;
const TYPES = ["text", "longtext", "choice", "file"] as const;

const STARTER = `{
  "questions": [
    {
      "key": "summary",
      "type": "longtext",
      "label": "In your own words, what is the matter about?",
      "required": true,
      "max_length": 2000
    }
  ]
}`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The same shape check the server action runs, kept short. Its answer is only advice — the
 * action's answer is the one that decides whether anything is written.
 */
function checkQuestions(parsed: unknown): { questions: IntakeQuestion[] } | { error: string } {
  if (!isRecord(parsed)) return { error: 'The schema is an object with a questions list: {"questions": []}.' };
  const raw = parsed.questions;
  if (!Array.isArray(raw)) return { error: '"questions" has to be a list, even an empty one: {"questions": []}.' };

  const questions: IntakeQuestion[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.length; i += 1) {
    const at = `Question ${i + 1}`;
    const q = raw[i];
    if (!isRecord(q)) return { error: `${at} is not an object.` };
    const key = typeof q.key === "string" ? q.key.trim() : "";
    const where = key ? `${at} (${key})` : at;
    if (!key) return { error: `${at} has no key.` };
    if (!KEY_RE.test(key)) {
      return { error: `${where}: a key starts with a lowercase letter and holds only lowercase letters, digits and underscores.` };
    }
    if (seen.has(key)) return { error: `${where}: that key is already used above. An answer is stored under its key.` };
    const type = typeof q.type === "string" ? q.type.trim() : "";
    if (!(TYPES as readonly string[]).includes(type)) {
      return { error: `${where}: the type is one of text, longtext, choice or file.` };
    }
    const label = typeof q.label === "string" ? q.label.trim() : "";
    if (!label) return { error: `${where}: give it a label — the question the client reads.` };

    const out: IntakeQuestion = { key, type: type as IntakeQuestion["type"], label };
    if (typeof q.help === "string" && q.help.trim()) out.help = q.help.trim();
    if (q.required === true && type !== "file") out.required = true;

    if (type === "choice") {
      const options = Array.isArray(q.options) ? q.options.map((o) => (typeof o === "string" ? o.trim() : "")) : null;
      if (!options || options.length === 0) return { error: `${where}: a choice needs at least one option.` };
      if (options.some((o) => !o)) return { error: `${where}: one of the options is blank.` };
      out.options = options;
      if (q.multiple === true) out.multiple = true;
    }
    if (type === "file") out.max_files = typeof q.max_files === "number" ? Math.floor(q.max_files) : 1;
    if (type === "longtext" && typeof q.max_length === "number") out.max_length = Math.floor(q.max_length);

    if (q.show_if !== undefined) {
      if (!isRecord(q.show_if)) return { error: `${where}: show_if is {"question": "an_earlier_key", "equals": "an option"}.` };
      const on = typeof q.show_if.question === "string" ? q.show_if.question.trim() : "";
      const equals = typeof q.show_if.equals === "string" ? q.show_if.equals.trim() : "";
      if (!on || !equals) return { error: `${where}: show_if needs both "question" and "equals".` };
      if (on === key) return { error: `${where}: show_if points at itself, so it could never appear.` };
      if (!seen.has(on)) {
        return { error: `${where}: show_if points at "${on}", which is not asked before it, so it would never appear.` };
      }
      const parent = questions.find((p) => p.key === on);
      if (parent && parent.type === "file") {
        return { error: `${where}: show_if points at a file question, which has no answer to compare.` };
      }
      if (parent && parent.type === "choice" && parent.options && !parent.options.includes(equals)) {
        return { error: `${where}: "${on}" never offers "${equals}", so this question would never appear.` };
      }
      out.show_if = { question: on, equals };
    }

    seen.add(key);
    questions.push(out);
  }
  return { questions };
}

/** The wizard's own rule for whether a question is on screen yet. */
function isVisible(q: IntakeQuestion, answers: Answers): boolean {
  if (!q.show_if) return true;
  const v = answers[q.show_if.question];
  return Array.isArray(v) ? v.includes(q.show_if.equals) : v === q.show_if.equals;
}

function nextKey(questions: IntakeQuestion[], base: string): string {
  if (!questions.some((q) => q.key === base)) return base;
  let n = 2;
  while (questions.some((q) => q.key === `${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function IntakeEditor({
  firmId,
  canWrite,
  forms,
  services,
}: {
  firmId: string;
  canWrite: boolean;
  forms: FormView[];
  services: ServiceOption[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  // Parsed on every change, which is what makes the preview honest.
  const parsed = useMemo<{ questions: IntakeQuestion[] } | { error: string } | null>(() => {
    if (openId === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (err) {
      return { error: `Not valid JSON yet: ${err instanceof Error ? err.message : "unreadable"}` };
    }
    return checkQuestions(value);
  }, [openId, text]);

  const questions = parsed && "questions" in parsed ? parsed.questions : [];
  const parseProblem = parsed && "error" in parsed ? parsed.error : null;
  const editing = openId !== null && openId !== "new" ? forms.find((f) => f.id === openId) ?? null : null;
  const unknownService = Boolean(serviceId) && !services.some((s) => s.id === serviceId);

  function open(form: FormView | null) {
    setOpenId(form ? form.id : "new");
    setName(form ? form.name : "");
    setServiceId(form?.serviceId ?? "");
    setIsActive(form ? form.isActive : false);
    setText(form ? form.schemaJson : STARTER);
    setAnswers({});
    setError(null);
    setNotice(null);
    setDropped([]);
    setConfirmDelete(false);
  }

  function close() {
    setOpenId(null);
    setError(null);
    setConfirmDelete(false);
  }

  function insert(type: IntakeQuestion["type"]) {
    if (!parsed || "error" in parsed) return;
    const base =
      type === "file" ? "document" : type === "choice" ? "choice" : type === "longtext" ? "details" : "answer";
    const q: IntakeQuestion = {
      key: nextKey(parsed.questions, base),
      type,
      label: "Your question here",
    };
    if (type === "choice") q.options = ["First option", "Second option"];
    if (type === "file") q.max_files = 1;
    if (type === "longtext") q.max_length = 2000;
    setText(JSON.stringify({ questions: [...parsed.questions, q] }, null, 2));
    setNotice(null);
  }

  function format() {
    if (!parsed || "error" in parsed) return;
    setText(JSON.stringify({ questions: parsed.questions }, null, 2));
  }

  function save() {
    if (openId === null) return;
    if (parseProblem) {
      setError(parseProblem);
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await saveIntakeForm({
        firmId,
        formId: openId === "new" ? null : openId,
        serviceId: serviceId || null,
        name,
        isActive,
        schemaJson: text,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setDropped(result.dropped ?? []);
      if (result.storedJson) setText(result.storedJson);
      if (result.formId) setOpenId(result.formId);
      setNotice(result.notice ?? "Saved.");
      router.refresh();
    });
  }

  function remove() {
    if (!editing) return;
    setError(null);
    startDelete(async () => {
      const result = await deleteIntakeForm(firmId, editing.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(result.notice ?? "Deleted.");
      setOpenId(null);
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={`Forms · ${forms.length}`}
          action={
            canWrite && openId !== "new" ? (
              <Button size="sm" onClick={() => open(null)}>
                New form
              </Button>
            ) : undefined
          }
        />
        {forms.length === 0 ? (
          <EmptyState
            title="No intake form yet, so clients are asked nothing"
            hint={
              canWrite
                ? "A short form saves a first meeting from being spent on facts you could have had in advance. Start with one question — what the matter is about — and add to it."
                : "An owner or admin of this firm can write one. Until then the booking wizard goes straight from the time to the payment."
            }
            action={
              canWrite ? (
                <Button size="lg" onClick={() => open(null)}>
                  Write the first form
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {forms.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900">{f.name}</p>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        f.isActive
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-gray-200 bg-gray-50 text-gray-600",
                      )}
                    >
                      {f.isActive ? "asked of clients" : "switched off"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-700">
                    {f.serviceName ? `Only for ${f.serviceName}` : "Every service without its own form"} ·{" "}
                    {f.questionCount} question{f.questionCount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {f.responseCount === 0
                      ? "No client has answered it yet."
                      : `${f.responseCount} client${f.responseCount === 1 ? " has" : "s have"} answered it. Their answers keep the keys they were given.`}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => open(f)}>
                  {canWrite ? "Edit" : "Read"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {openId !== null && (
        <Card>
          <CardHeader title={openId === "new" ? "A new form" : `Editing “${editing?.name ?? "form"}”`} />
          <CardBody className="space-y-4">
            {openId === "new" && (
              <p className="text-sm text-gray-600">
                The box below starts with one question as a shape to work from — change the wording to your own. A new
                form is created switched off, so nothing reaches a client until you switch it on.
              </p>
            )}

            {notice && <Alert kind="success">{notice}</Alert>}

            {dropped.length > 0 && (
              <Alert kind="warning" title="Some of what you wrote was not kept">
                The booking wizard reads only the fields it knows, so these were dropped when the form was saved:{" "}
                {dropped.join("; ")}. The box below now shows exactly what the database holds.
              </Alert>
            )}

            {!canWrite && (
              <Alert kind="info">
                You are reading this form. Saving is refused by the database for anybody who is not an owner or admin of
                the firm with an MFA session.
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="form-name">Name</label>
                <input
                  id="form-name"
                  className={field}
                  value={name}
                  maxLength={120}
                  placeholder="Consultation intake"
                  disabled={!canWrite}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="mt-1 text-sm text-gray-500">For your own list. A client never sees it.</p>
              </div>
              <div>
                <label className={labelClass} htmlFor="form-service">Asked for</label>
                <select
                  id="form-service"
                  className={field}
                  value={serviceId}
                  disabled={!canWrite}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  <option value="">Every service without its own form</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.isActive ? "" : " (switched off)"}
                    </option>
                  ))}
                  {unknownService && <option value={serviceId}>A service that is not in this firm's catalogue</option>}
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  {unknownService
                    ? "This form points at a service this firm does not have. Choose one of yours before saving — the database will refuse the other."
                    : serviceId
                      ? "Only clients booking that service are asked these questions."
                      : "Used by every service that has no form of its own."}
                </p>
              </div>
            </div>

            <label className="flex min-h-[44px] items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={isActive}
                disabled={!canWrite}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span className="text-sm text-gray-800">
                Ask this form of clients
                {editing?.isActive === false && isActive ? " — it goes live on the booking page as soon as you save" : ""}
              </span>
            </label>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className={labelClass} htmlFor="form-schema">The questions</label>
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => insert("text")} disabled={Boolean(parseProblem)}>
                      + Short answer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => insert("longtext")} disabled={Boolean(parseProblem)}>
                      + Long answer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => insert("choice")} disabled={Boolean(parseProblem)}>
                      + Choice
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => insert("file")} disabled={Boolean(parseProblem)}>
                      + File
                    </Button>
                    <Button size="sm" variant="ghost" onClick={format} disabled={Boolean(parseProblem)}>
                      Tidy up
                    </Button>
                  </div>
                )}
              </div>
              <textarea
                id="form-schema"
                rows={16}
                spellCheck={false}
                disabled={!canWrite}
                className="mt-1 w-full overflow-x-auto whitespace-pre rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 focus:border-brand focus:outline focus:outline-2 focus:outline-brand"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setNotice(null);
                  setError(null);
                }}
              />
              {parseProblem ? (
                <p role="alert" className="mt-1 text-sm text-red-700">
                  {parseProblem}
                </p>
              ) : (
                <p className="mt-1 text-sm text-gray-500">
                  {questions.length} question{questions.length === 1 ? "" : "s"}. Each one is{" "}
                  <code>{"{ key, type, label }"}</code>, with <code>options</code> for a choice,{" "}
                  <code>required</code>, <code>help</code>, and <code>show_if</code> to hold it back until an earlier
                  answer matches. The buttons above rewrite the box in the shape the wizard reads, so anything it does
                  not know is dropped there and then.
                </p>
              )}
            </div>

            {error && (
              <Alert kind="error" title="The database refused this, or the form is not ready">
                {error}
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              {canWrite && (
                <Button size="lg" onClick={save} disabled={saving || Boolean(parseProblem)}>
                  {saving ? "Saving…" : openId === "new" ? "Save this form" : "Save changes"}
                </Button>
              )}
              <Button size="lg" variant="ghost" onClick={close} disabled={saving}>
                Close
              </Button>
              {canWrite && editing && !confirmDelete && (
                <Button size="lg" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  Delete this form
                </Button>
              )}
            </div>

            {confirmDelete && editing && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-900">
                  Delete “{editing.name}”? The questions go. The{" "}
                  {editing.responseCount === 0
                    ? "answers clients give"
                    : `${editing.responseCount} set${editing.responseCount === 1 ? "" : "s"} of answers already given`}{" "}
                  stay on their consultations.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="danger" onClick={remove} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete permanently"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                    Keep it
                  </Button>
                </div>
              </div>
            )}
          </CardBody>

          <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
            <p className="text-sm font-medium text-gray-900">What the client will see</p>
            <p className="mt-0.5 text-sm text-gray-600">
              The same fields the booking wizard renders, in the same order. Answer them here to watch a{" "}
              <code>show_if</code> question appear. Nothing typed in this preview is saved or uploaded.
            </p>
            <div className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-4">
              {parseProblem ? (
                <p className="text-sm text-gray-500">Nothing to show until the questions read as valid JSON.</p>
              ) : questions.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No questions yet, so the wizard skips this step entirely and goes from the time straight to signing
                  in.
                </p>
              ) : (
                <div className="space-y-4">
                  {questions.map((q) =>
                    isVisible(q, answers) ? (
                      <PreviewField
                        key={q.key}
                        q={q}
                        value={answers[q.key]}
                        onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
                      />
                    ) : (
                      <p key={q.key} className="text-xs text-gray-400">
                        “{q.label}” is hidden until {q.show_if?.question} is “{q.show_if?.equals}”.
                      </p>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * One question, drawn the way booking-wizard.tsx draws it. The file box is inert here: the
 * wizard only uploads after the client has signed in, and a preview that appeared to accept a
 * document would be a lie.
 */
function PreviewField({
  q,
  value,
  onChange,
}: {
  q: IntakeQuestion;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}) {
  const id = `preview-${q.key}`;
  const text = typeof value === "string" ? value : "";

  if (q.type === "text") {
    return (
      <div>
        <label className={labelClass} htmlFor={id}>
          {q.label}
          {q.required && <span className="text-gray-500"> (required)</span>}
        </label>
        <input id={id} className={field} value={text} onChange={(e) => onChange(e.target.value)} />
        {q.help && <p className="mt-1 text-sm text-gray-500">{q.help}</p>}
      </div>
    );
  }

  if (q.type === "longtext") {
    return (
      <div>
        <label className={labelClass} htmlFor={id}>
          {q.label}
          {q.required && <span className="text-gray-500"> (required)</span>}
        </label>
        <textarea
          id={id}
          rows={4}
          maxLength={q.max_length}
          className={field}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
        {q.help && <p className="mt-1 text-sm text-gray-500">{q.help}</p>}
        {q.max_length && <p className="mt-1 text-xs text-gray-500">Up to {q.max_length.toLocaleString("en-NG")} characters.</p>}
      </div>
    );
  }

  if (q.type === "choice" && q.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2">
        <legend className={labelClass}>
          {q.label}
          {q.required && <span className="text-gray-500"> (required)</span>}
        </legend>
        {(q.options ?? []).map((opt) => (
          <label key={opt} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={selected.includes(opt)}
              onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((v) => v !== opt))}
            />
            {opt}
          </label>
        ))}
        {q.help && <p className="text-sm text-gray-500">{q.help}</p>}
      </fieldset>
    );
  }

  if (q.type === "choice") {
    return (
      <div>
        <label className={labelClass} htmlFor={id}>
          {q.label}
          {q.required && <span className="text-gray-500"> (required)</span>}
        </label>
        <select id={id} className={field} value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(q.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {q.help && <p className="mt-1 text-sm text-gray-500">{q.help}</p>}
      </div>
    );
  }

  return (
    <div>
      <p className={labelClass}>{q.label}</p>
      <input type="file" disabled className="mt-1 block w-full text-sm text-gray-400" />
      {q.help && <p className="mt-1 text-sm text-gray-500">{q.help}</p>}
      <p className="mt-1 text-xs text-gray-500">
        PDF or images, up to 25 MB each, {q.max_files ?? 1} file{(q.max_files ?? 1) === 1 ? "" : "s"} at most. The
        client uploads after signing in; this box does nothing here.
      </p>
    </div>
  );
}
