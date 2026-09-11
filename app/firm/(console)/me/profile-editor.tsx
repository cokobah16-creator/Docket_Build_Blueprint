"use client";

// The practitioner's own profile, and the one switch the booking page depends on: public or not.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePractitionerProfile } from "@/lib/actions/practitioner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export interface PractitionerProfile {
  title: string | null;
  bio: string | null;
  practice_areas: string[];
  category: string | null;
  is_public: boolean;
  slug: string | null;
}

export function ProfileEditor({ firmId, userId, firmSlug, profile, categories }: { firmId: string; userId: string; firmSlug: string; profile: PractitionerProfile; categories: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(profile.title ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [areas, setAreas] = useState(profile.practice_areas.join(", "));
  const [category, setCategory] = useState(profile.category ?? "");
  const [isPublic, setIsPublic] = useState(profile.is_public);
  const [slug, setSlug] = useState(profile.slug ?? "");
  const [result, setResult] = useState<{ error?: string; ok?: boolean; slug?: string | null } | null>(null);

  return (
    <form
      className="space-y-3 px-[15px] py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        start(async () => {
          const r = await updatePractitionerProfile(firmId, userId, {
            title, bio, category, isPublic, slug: slug || null,
            practiceAreas: areas.split(",").map((a) => a.trim()).filter(Boolean),
          });
          setResult(r);
          if (!("error" in r)) { if (r.slug) setSlug(r.slug); router.refresh(); }
        });
      }}
    >
      {result?.error && <Alert kind="error">{result.error}</Alert>}
      {result?.ok && <Alert kind="success">Saved. {isPublic ? `Your profile is public at /${firmSlug}, and the booking page can offer you.` : "Your profile is private: the booking page does not list you."}</Alert>}
      <div>
        <label htmlFor="pp-title" className="text-sm font-medium text-gray-900">Title</label>
        <p className="text-xs text-gray-500">As it should read on the firm's site: Partner, Associate, Head of Chambers.</p>
        <input id="pp-title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="pp-category" className="text-sm font-medium text-gray-900">Category</label>
        <p className="text-xs text-gray-500">The word a service uses to pick its lawyers{categories.length ? ` — this firm uses: ${categories.join(", ")}` : ""}.</p>
        <input id="pp-category" type="text" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} className={field} list="pp-categories" />
        <datalist id="pp-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div>
        <label htmlFor="pp-areas" className="text-sm font-medium text-gray-900">Practice areas</label>
        <p className="text-xs text-gray-500">Separated by commas.</p>
        <input id="pp-areas" type="text" maxLength={1000} value={areas} onChange={(e) => setAreas(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="pp-bio" className="text-sm font-medium text-gray-900">About you</label>
        <textarea id="pp-bio" rows={4} maxLength={4000} value={bio} onChange={(e) => setBio(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="pp-slug" className="text-sm font-medium text-gray-900">Web name</label>
        <p className="text-xs text-gray-500">Lower-case letters, digits and hyphens. Made from your name if left empty when you publish.</p>
        <input id="pp-slug" type="text" maxLength={60} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className={field} />
      </div>
      <label className="flex min-h-[44px] items-start gap-3 rounded-lg border border-gray-200 px-3.5 py-3">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
        <span className="text-sm text-gray-800">
          <span className="font-medium">Show my profile on the firm's site and let clients book me.</span>
          <span className="mt-1 block text-gray-600">Off, nobody can book you and your name is not on the site. Your enrolment number is never shown either way.</span>
        </span>
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save my profile"}</Button>
    </form>
  );
}
