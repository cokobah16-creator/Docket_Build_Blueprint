import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "@/lib/cn";

// The prototype draws fields at 14px, but its "fields" are static divs. A real
// input under 16px makes iOS Safari zoom the whole page on focus, and a client
// filling in an intake form on a phone should not have to pinch back out after
// every question. 16px it stays — which is why `text-base` survives the type
// ramp untouched: 16 is a platform constraint, not a typographic choice.
//
// The border is `edge` rather than a hairline because it is the only thing
// bounding the control, so it has to clear 3:1 (WCAG 1.4.11), and the
// placeholder is `ink-muted` rather than `ink-disabled` because a placeholder
// is content and needs 4.5:1.
const fieldClasses =
  "w-full rounded-control border border-edge bg-raised px-3 py-[11px] text-base text-ink " +
  "placeholder:text-ink-muted focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

const labelClasses = "block text-13 font-semibold text-ink";

const errorClasses = "text-13 text-danger";

const hintClasses = "text-11 text-ink-muted";

function fieldId(label: string, id?: string): string {
  return id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className, ...props }: InputProps) {
  const inputId = fieldId(label, id);
  const errorId = `${inputId}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className={labelClasses}>
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(fieldClasses, error && "border-danger", className)}
        {...props}
      />
      {hint && !error && <p className={hintClasses}>{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className={errorClasses}>
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Textarea({ label, error, hint, id, className, ...props }: TextareaProps) {
  const areaId = fieldId(label, id);
  const errorId = `${areaId}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={areaId} className={labelClasses}>
        {label}
      </label>
      <textarea
        id={areaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(fieldClasses, "min-h-[76px] leading-relaxed", error && "border-danger", className)}
        {...props}
      />
      {hint && !error && <p className={hintClasses}>{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className={errorClasses}>
          {error}
        </p>
      )}
    </div>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, error, id, className, children, ...props }: SelectProps) {
  const selectId = fieldId(label, id);
  const errorId = `${selectId}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className={labelClasses}>
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(fieldClasses, error && "border-danger", className)}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} role="alert" className={errorClasses}>
          {error}
        </p>
      )}
    </div>
  );
}

// Both helpers below are worn by real <button>s, which get the browser's own
// focus ring by default — a ring that changes shape with the browser and
// disappears against some grounds. They state the app's own instead.
const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * A choice rendered as a full-width card or a chip — the prototype's booking
 * controls. Selection is a border and a fill, never colour alone, and the
 * caller supplies a real radio or checkbox behind it where one is needed.
 */
export function choiceCardClasses(selected: boolean, className?: string): string {
  return cn(
    "block w-full cursor-pointer rounded-control border bg-raised px-[15px] py-3.5 text-left transition duration-fast",
    focusRing,
    // The inset ring is the firm's own colour rather than an elevation token:
    // it is what marks the chosen card, so it must not flatten into the
    // shadow scale.
    selected ? "border-brand shadow-[0_0_0_1px_var(--dk-primary)_inset]" : "border-edge hover:border-ink",
    className,
  );
}

export function chipClasses(selected: boolean, className?: string): string {
  return cn(
    // 42px was two pixels under the floor tests/fixtures/ergonomics.mjs
    // enforces, and a chip in a horizontal scroller is exactly the control a
    // moving thumb misses.
    "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3.5 text-13 font-medium transition duration-fast",
    focusRing,
    selected ? "border-brand bg-brand text-brand-on" : "border-edge bg-raised text-ink hover:border-ink",
    className,
  );
}
