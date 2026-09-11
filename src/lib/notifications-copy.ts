// Human copy for in-app notification rows (mirrors the dispatcher templates).
export interface NotificationCopy { title: string; body: string; url: string }

export function describeNotification(event: string, payload: Record<string, unknown>, firmName: string, tz: string): NotificationCopy {
  const p = payload ?? {};
  const whenIso = (p.starts_at ?? p.scheduled_at) as string | undefined;
  const when = whenIso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(whenIso)) : "";
  const appt = p.appointment_id ? `/app/appointments/${p.appointment_id}` : "/app/appointments";
  const matter = p.matter_id ? `/app/matters/${p.matter_id}` : "/app/matters";
  switch (event) {
    case "appointment_confirmed": return { title: "Consultation confirmed", body: `${p.reference ?? ""} · ${when}`, url: appt };
    case "appointment_held": return { title: "Booking held", body: `${when} · see what is still needed`, url: appt };
    case "appointment_checkin_due": return { title: "Before your consultation", body: `${when} · not yet confirmed`, url: appt };
    case "appointment_awaiting_confirmation": return { title: "A held consultation needs confirming", body: when, url: `/firm/appointments/${p.appointment_id ?? ""}` };
    case "document_requested": return { title: "A document is needed", body: String(p.title ?? ""), url: p.appointment_id ? `/app/appointments/${p.appointment_id}` : `${matter}?tab=documents` };
    case "appointment_reminder_24h": return { title: "Consultation tomorrow", body: when, url: appt };
    case "appointment_reminder_1h": return { title: "Consultation in 1 hour", body: when, url: appt };
    case "appointment_reminder_10m": return { title: "Consultation in 10 minutes", body: "Join the waiting room.", url: `${appt}/waiting-room` };
    case "appointment_reminder_now": return { title: "Your consultation is ready", body: "Join now.", url: `${appt}/waiting-room` };
    case "appointment_cancelled": return { title: "Consultation cancelled", body: `${p.reference ?? ""} · ${when}`, url: appt };
    case "appointment_rescheduled": return { title: "Consultation moved", body: `New time: ${when}`, url: appt };
    case "appointment_completed": return { title: "Consultation completed", body: "Your lawyer's summary is on the appointment page.", url: appt };
    case "invoice_issued": return { title: `Invoice ${p.invoice_number ?? ""}`, body: firmName, url: p.invoice_id ? `/app/payments/${p.invoice_id}` : "/app/payments" };
    case "payment_confirmed": return { title: "Payment received", body: `Invoice ${p.invoice_number ?? ""}`, url: "/app/payments" };
    case "matter_update": return { title: String(p.title ?? "Update on your matter"), body: firmName, url: `${matter}?tab=timeline` };
    case "court_date_t3": return { title: "Court date in 3 days", body: `${when}${p.purpose ? ` · ${p.purpose}` : ""}`, url: "/app/court-dates" };
    case "court_date_t1": return { title: "Court date tomorrow", body: `${when}${p.court_name ? ` · ${p.court_name}` : ""}`, url: "/app/court-dates" };
    case "deadline_due_t7": return { title: `${p.title ?? "A deadline"} in a week`, body: `Due ${p.due_on ?? ""}`, url: `/firm/matters/${p.matter_id ?? ""}?tab=deadlines` };
    case "deadline_due_t1": return { title: `${p.title ?? "A deadline"} tomorrow`, body: `Due ${p.due_on ?? ""}`, url: `/firm/matters/${p.matter_id ?? ""}?tab=deadlines` };
    case "deadline_due_t0": return { title: `${p.title ?? "A deadline"} today`, body: `Due ${p.due_on ?? ""}`, url: `/firm/matters/${p.matter_id ?? ""}?tab=deadlines` };
    case "new_message": return { title: `New message from ${firmName}`, body: "Open the thread.", url: p.matter_id ? `${matter}?tab=messages` : p.appointment_id ? `/app/messages/appointment/${p.appointment_id}` : "/app/messages" };
    default: return { title: event.replace(/_/g, " "), body: "", url: "/app" };
  }
}

export const PREFERENCE_EVENTS: Array<{ event: string; label: string }> = [
  { event: "appointment_confirmed", label: "Consultation confirmed" },
  { event: "appointment_held", label: "Booking held: what is still needed" },
  { event: "appointment_checkin_due", label: "Reminder: before your consultation" },
  { event: "appointment_reminder_24h", label: "Reminder: 24 hours before" },
  { event: "appointment_reminder_1h", label: "Reminder: 1 hour before" },
  { event: "appointment_reminder_10m", label: "Reminder: 10 minutes before" },
  { event: "appointment_rescheduled", label: "Consultation moved" },
  { event: "appointment_cancelled", label: "Consultation cancelled" },
  { event: "invoice_issued", label: "A new invoice" },
  { event: "payment_confirmed", label: "Payment received" },
  { event: "matter_update", label: "Updates on my matters" },
  { event: "court_date_t3", label: "Court date in 3 days" },
  { event: "court_date_t1", label: "Court date tomorrow" },
  { event: "new_message", label: "New message" },
];
export const PREFERENCE_CHANNELS: Array<{ channel: "push" | "email" | "sms"; label: string }> = [
  { channel: "push", label: "Push" },
  { channel: "email", label: "Email" },
  { channel: "sms", label: "SMS" },
];
