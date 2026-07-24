import { NextResponse } from "next/server";
import { SUPPORTED_LEAGUES } from "@/lib/providers/footballData";

export async function GET() {
  const list = Object.values(SUPPORTED_LEAGUES);
  return NextResponse.json({ ok: true, leagues: list });
}
