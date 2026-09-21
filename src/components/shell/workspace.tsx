import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

/** The command bar uses real destinations and keeps the selected firm explicit. */
export function WorkspaceBar({ firmName, firmId, client = false }: {
  firmName: string; firmId?: string; client?: boolean;
}) {
  const root = client ? "/app" : "/firm";
  const context = firmId ? `?firm=${encodeURIComponent(firmId)}` : "";
  return (
    <header className={`workspace-bar ${client ? "workspace-bar-client" : ""}`}>
      <Link href={`${root}${context}`} className="workspace-wordmark">Docket<span className="sr-only"> home</span></Link>
      <form action={`${root}/${client ? "search" : "matters"}`} role="search" className="workspace-search">
        <Icon name="search" size={18} />
        <label className="sr-only" htmlFor="workspace-search">{client ? "Search your records" : "Search matters, suit numbers or clients"}</label>
        <input id="workspace-search" name="q" type="search" placeholder={client ? "Search your records" : "Search matters, suit numbers or clients"} />
        {firmId && <input type="hidden" name="firm" value={firmId} />}
      </form>
      <span className="workspace-firm" title={firmName}>{firmName}</span>
      <Link className="workspace-bar-action" href={`${root}/${client ? "messages" : "matters/new"}${context}`}>
        <Icon name={client ? "mail" : "folder"} size={18} />
        <span>{client ? "Messages" : "New matter"}</span>
      </Link>
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
