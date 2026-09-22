import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { QuickActions, type QuickAction } from "@/components/shell/quick-actions";

/**
 * The command bar: the workspace's one search box and its one "New" control.
 *
 * Search goes to the global search screen (search_docket(), which runs under
 * the reader's own RLS) rather than to a single list, so a lawyer typing a
 * client's name, a suit number or a phrase from a document lands on every kind
 * of record at once, each labelled with what it is.
 */
export function WorkspaceBar({ firmName, firmId, client = false }: {
  firmName: string; firmId?: string; client?: boolean;
}) {
  const root = client ? "/app" : "/firm";
  const context = firmId ? `?firm=${encodeURIComponent(firmId)}` : "";
  const placeholder = client ? "Search your matters, documents and messages" : "Search matters, suit numbers, clients, documents";
  const actions: QuickAction[] = [
    { href: `/firm/matters/new${context}`, label: "New matter", hint: "Open a file, run the conflict check, invite the client", icon: "folder" },
    { href: `/firm/sittings${context}`, label: "Record a court update", hint: "Report what happened at a sitting and fix the next date", icon: "scale" },
    { href: `/firm/invoices/new${context}`, label: "Raise an invoice", hint: "Bill a client against a matter", icon: "card" },
    { href: `/firm/uploads${context}`, label: "Review client uploads", hint: "Documents clients have sent in", icon: "upload" },
    { href: `/firm/availability${context}`, label: "Set consultation hours", hint: "When clients may book you", icon: "clock" },
  ];
  return (
    <header className={`workspace-bar ${client ? "workspace-bar-client" : ""}`}>
      <Link href={`${root}${context}`} className="workspace-wordmark">Docket<span className="sr-only"> home</span></Link>
      <form action={`${root}/search`} role="search" className="workspace-search">
        <Icon name="search" size={17} />
        <label className="sr-only" htmlFor="workspace-search">{placeholder}</label>
        <input id="workspace-search" name="q" type="search" placeholder={placeholder} autoComplete="off" />
        {firmId && <input type="hidden" name="firm" value={firmId} />}
      </form>
      <span className="workspace-firm" title={firmName}>{firmName}</span>
      {client ? (
        <Link className="workspace-bar-action" href={`${root}/messages${context}`}>
          <Icon name="mail" size={17} />
          <span>Messages</span>
        </Link>
      ) : (
        <QuickActions actions={actions} />
      )}
    </header>
  );
}

export function LedgerPanel({ title, href, action = "View all", children }: {
  title: string; href?: string; action?: string; children: ReactNode;
}) {
  return (
    <section className="ledger-panel">
      <header className="ledger-panel-header">
        <h2>{title}</h2>
        {href && <Link href={href}>{action}<Icon name="chevron-right" size={15} /></Link>}
      </header>
      {children}
    </section>
  );
}

export function LedgerRow({ href, title, detail, trailing }: {
  href: string; title: string; detail?: ReactNode; trailing?: ReactNode;
}) {
  return (
    <Link href={href} className="ledger-row">
      <span className="min-w-0"><span className="ledger-row-title">{title}</span>{detail && <span className="ledger-row-detail">{detail}</span>}</span>
      {trailing && <span className="ledger-row-trailing">{trailing}</span>}
    </Link>
  );
}
