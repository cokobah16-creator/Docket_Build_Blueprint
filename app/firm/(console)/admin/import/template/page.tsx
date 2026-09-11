// The columns an import understands, and a template to fill in. Nothing here reads data.

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TemplateDownload } from "./template-download";

export const metadata = { title: "Import template" };

const COLUMNS: Array<[string, string]> = [
  ["title", "Working title — what the firm calls the file. Required."],
  ["cause_title", "The caption on the process: Okonkwo v Eze & 2 Ors."],
  ["type", "litigation, property, corporate, estate, family, employment, debt_recovery, ip, regulatory, immigration, advisory or other. Blank means other."],
  ["status", "One of your firm's status keys or labels (new_inquiry, in_progress, filed, hearing, closed …). Blank means new inquiry. An unknown status refuses the row."],
  ["court", "The court's name. Matched to the directory exactly; otherwise kept as text on the matter."],
  ["suit_number", "As the registry assigned it."],
  ["judicial_division", "Division or district."],
  ["handling_lawyer", "The lawyer with conduct: their Docket email or exact name. Blank means whoever imports."],
  ["originating_lawyer", "Who brought the client in: email or exact name."],
  ["opened_on", "YYYY-MM-DD or DD/MM/YYYY. A calendar day. Blank means today."],
  ["closed_on", "Same form. Only for closed files; must not be before opened_on."],
  ["legacy_reference", "Your old file number. Kept beside the Docket reference, and the same number is never imported twice."],
  ["client_name", "For you to recognise the row. A client joins only by phone or email."],
  ["client_phone", "0803 000 0000 or +234…; becomes their invitation, unless your firm already deals with them on Docket."],
  ["client_email", "Alternative to the phone."],
  ["opposing_party", "The other side, several names separated by semicolons. Goes onto the register conflict checks search."],
  ["description", "What the matter is about. The client can read it once they join."],
  ["next_action", "The next thing to do on the file."],
];

export default function ImportTemplatePage() {
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/firm/admin/import" className="text-brand underline">← Import</Link></p>
      <Card>
        <CardHeader title="The columns an import understands" action={<TemplateDownload columns={COLUMNS.map((c) => c[0])} />} />
        <CardBody>
          <p className="text-sm text-gray-600">Column names can be anything — you say what each means when you upload. These are the meanings. Only <strong>title</strong> is required.</p>
          <dl className="mt-3 divide-y divide-gray-100">
            {COLUMNS.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-2 sm:grid-cols-[180px_1fr]">
                <dt className="font-mono text-xs text-gray-900">{k}</dt>
                <dd className="text-sm text-gray-700">{v}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
