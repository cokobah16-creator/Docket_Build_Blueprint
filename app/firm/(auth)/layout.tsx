import type { ReactNode } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function StaffAuthLayout({ children }: { children: ReactNode }) {
  return <AuthFrame audience="staff">{children}</AuthFrame>;
}
