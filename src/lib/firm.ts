// Firm context for server components: the middleware stamps x-firm-slug /
// x-firm-id from the request host; these helpers read it back and load the
// public firm row.

import { headers } from "next/headers";
import { firmBySlug } from "@/lib/tenant";
import type { FirmPublic } from "@/lib/db/types";

export async function currentFirmSlug(): Promise<string | null> {
  const h = await headers();
  return h.get("x-firm-slug");
}

export async function currentFirmId(): Promise<string | null> {
  const h = await headers();
  return h.get("x-firm-id");
}

export async function currentFirm(): Promise<FirmPublic | null> {
  const slug = await currentFirmSlug();
  if (!slug) return null;
  return firmBySlug(slug);
}
