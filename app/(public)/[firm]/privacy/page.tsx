import type { Metadata } from "next";
import { PolicyPage } from "../_components/policy-page";

export const metadata: Metadata = { title: "Privacy notice" };

export default async function PrivacyPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm } = await params;
  return <PolicyPage slug={firm} kind="privacy" title="Privacy notice" />;
}
