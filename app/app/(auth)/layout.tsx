import type { ReactNode } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function ClientAuthLayout({ children }: { children: ReactNode }) {
  return <AuthFrame audience="client">{children}</AuthFrame>;
}
