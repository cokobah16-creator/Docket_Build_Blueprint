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
// every question. 16px it stays.
const fieldClasses =
  "w-full rounded-[9px] border border-gray-300 bg-white px-3 py-[11px] text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

const labelClasses = "block text-[12.5px] font-semibold text-gray-700";

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
        className={cn(fieldClasses, error && "border-red-600", className)}
        {...props}
      />
      {hint && !error && <p className="text-[11.5px] leading-relaxed text-gray-500">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-[12.5px] text-red-700">
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
        className={cn(fieldClasses, "min-h-[76px] leading-relaxed", error && "border-red-600", className)}
        {...props}
      />
      {hint && !error && <p className="text-[11.5px] leading-relaxed text-gray-500">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-[12.5px] text-red-700">
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
        className={cn(fieldClasses, error && "border-red-600", className)}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={errorId} role="alert" className="text-[12.5px] text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A choice rendered as a full-width card or a chip — the prototype's booking
 * controls. Selection is a border and a fill, never colour alone, and the
 * caller supplies a real radio or checkbox behind it where one is needed.
 */
export function choiceCardClasses(selected: boolean, className?: string): string {
  return cn(
    "block w-full cursor-pointer rounded-[11px] border bg-white px-[15px] py-3.5 text-left transition",
    selected ? "border-brand shadow-[0_0_0_1px_var(--dk-primary)_inset]" : "border-gray-200 hover:border-gray-300",
    className,
  );
}

export function chipClasses(selected: boolean, className?: string): string {
  return cn(
    "inline-flex min-h-[42px] cursor-pointer items-center justify-center rounded-full border px-3.5 text-[12.5px] font-medium transition",
    selected ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400",
    className,
  );
}
