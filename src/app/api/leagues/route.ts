import { NextResponse } from "next/server";
import { VERIFIED_LEAGUES } from "@/lib/providers/footballDataUk";
import { CALIBRATED_MODEL } from "@/lib/model/inference";

export async function GET() {
  return NextResponse.json({
    ok: true,
    leagues: VERIFIED_LEAGUES,
    modelVersion: CALIBRATED_MODEL.version,
    backtestSummary: CALIBRATED_MODEL.backtestSummary,
    evSummary: CALIBRATED_MODEL.evSummary,
  });
}
