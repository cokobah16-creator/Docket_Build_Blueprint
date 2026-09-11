"use client";

// The one search on the console: cause title, suit number, reference or
// client. It does not search here — it hands the query to the matters list,
// which already knows how to filter — so there is one answer to "where did I
// see that case", not two.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";

export function MatterSearch({
  placeholder = "Cause title, suit number or client",
  action = "/firm/matters",
}: {
  placeholder?: string;
  action?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        router.push(query ? `${action}?q=${encodeURIComponent(query)}` : action);
      }}
      className="flex min-h-[46px] items-center gap-2.5 rounded-[10px] border border-[#DDD9D2] bg-white px-3.5"
    >
      <Icon name="search" size={17} strokeWidth={1.8} className="shrink-0 text-[#57534E]" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        // 16px so iOS Safari does not zoom the page when the field takes focus.
        className="w-full min-w-0 border-0 bg-transparent py-2 text-base text-[#141414] placeholder:text-gray-500 focus:outline-none"
      />
    </form>
  );
}
