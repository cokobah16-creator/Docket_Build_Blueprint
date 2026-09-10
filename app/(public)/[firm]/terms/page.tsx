import type { Metadata } from "next";
import { PolicyPage } from "../_components/policy-page";

export const metadata: Metadata = { title: "Terms of service" };

export default async function TermsPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm } = await params;
  return <PolicyPage slug={firm} kind="terms" title="Terms of service" />;
}
