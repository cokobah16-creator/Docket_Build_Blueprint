import { brandIcon } from "@/lib/brand-icon";
export const dynamic = "force-dynamic";
export async function GET() { return brandIcon(192); }
