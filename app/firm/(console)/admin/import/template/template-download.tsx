"use client";

import { toCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";

export function TemplateDownload({ columns }: { columns: string[] }) {
  function download() {
    const csv = toCsv(columns, [["Okonkwo land dispute", "Okonkwo v Eze & 2 Ors", "litigation", "in_progress", "High Court of Lagos State", "LD/123/2024", "Ikeja", "you@yourfirm.com", "", "2024-03-12", "", "F-2024-001", "Chukwuemeka Okonkwo", "0803 000 0000", "", "Emeka Eze; Eze & Sons Ltd", "Land at Asaba", "File reply"]]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "docket-import-template.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Button type="button" size="sm" variant="ghost" onClick={download}>Download the template</Button>;
}
