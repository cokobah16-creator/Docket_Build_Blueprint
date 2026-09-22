import { Icon, type IconName } from "@/components/ui/icon";

// What kind of entry a timeline row is — a sitting, a filing, a letter — as a
// line icon and a word. The two timelines (the lawyer's and the client's) used
// to carry the same table of emoji each, which rendered differently on every
// phone and meant nothing to a screen reader. One table, one mark.

export const UPDATE_KINDS: Record<string, { label: string; icon: IconName }> = {
  court_sitting: { label: "Court sitting", icon: "scale" },
  consultation: { label: "Consultation", icon: "video" },
  appointment: { label: "Appointment", icon: "calendar" },
  filing: { label: "Filing", icon: "file" },
  correspondence: { label: "Correspondence", icon: "mail" },
  milestone: { label: "Milestone", icon: "check" },
  fee: { label: "Fees", icon: "card" },
  document: { label: "Document", icon: "paperclip" },
  note: { label: "Note", icon: "file" },
  status_change: { label: "Status change", icon: "transfer" },
};

export function updateKindLabel(kind: string): string {
  return UPDATE_KINDS[kind]?.label ?? "Update";
}

/** The mark at the head of a timeline row. The label is read out; the icon is not. */
export function UpdateKindMark({ kind }: { kind: string }) {
  const k = UPDATE_KINDS[kind] ?? { label: "Update", icon: "dot" as IconName };
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-hairline bg-sunken text-ink-muted">
      <Icon name={k.icon} size={15} />
      <span className="sr-only">{k.label}</span>
    </span>
  );
}
