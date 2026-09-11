"use server";

// A practitioner's own public profile: what the firm's site and the booking page show, and
// whether they show it at all.
//
// Rules enforced here: the write is a plain update on lawyer_profiles under
// lawyer_profiles_write_upd — own row with staff_w(), or admin_w() — so the database decides,
// no service key is used, and a refusal is shown word for word. The enrolment number is not
// edited here: normalise_scn() owns it and its verification is the platform's. Publishing needs
// a slug; when none is set it is made from the person's name and reported back.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export interface PractitionerProfileInput {
  title: string;
  bio: string;
  practiceAreas: string[];
  category: string;
  isPublic: boolean;
  slug?: string | null;
}
export type PractitionerProfileResult = { error: string } | { ok: true; slug: string | null };

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export async function updatePractitionerProfile(firmId: string, userId: string, input: PractitionerProfileInput): Promise<PractitionerProfileResult> {
  if (!z.string().uuid().safeParse(firmId).success || !z.string().uuid().safeParse(userId).success) return { error: "That profile could not be read." };
  const schema = z.object({
    title: z.string().trim().max(120, "Keep the title to 120 characters."),
    bio: z.string().trim().max(4000, "Keep the bio to 4,000 characters."),
    practiceAreas: z.array(z.string().trim().min(1).max(60)).max(20, "Up to twenty practice areas."),
    category: z.string().trim().max(60, "Keep the category to 60 characters."),
    isPublic: z.boolean(),
    slug: z.string().trim().max(60).regex(/^[a-z0-9-]*$/, "A web name is lower-case letters, digits and hyphens.").nullish(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the profile and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  let slug = d.slug || null;
  if (d.isPublic && !slug) {
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    slug = slugify((prof as { full_name: string | null } | null)?.full_name ?? "") || null;
    if (!slug) return { error: "A public profile needs a web name, and yours could not be made from your name — give one." };
  }
  const { error, count } = await supabase
    .from("lawyer_profiles")
    .update({ title: d.title || null, bio: d.bio || null, practice_areas: d.practiceAreas, category: d.category || null, is_public: d.isPublic, slug }, { count: "exact" })
    .eq("firm_id", firmId)
    .eq("user_id", userId);
  if (error && error.code === "23505") return { error: `The web name "${slug}" is already used by a colleague at this firm — choose another.` };
  if (error) return { error: error.message };
  if (count === 0) return { error: "Nothing was changed: this is not your profile, or your session has no second factor." };
  revalidatePath("/firm/me");
  revalidatePath("/firm/admin");
  revalidatePath("/firm/admin/services");
  return { ok: true, slug };
}
