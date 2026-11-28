import { NextResponse } from "next/server";
import { analyzeSlate } from "@/lib/predictorEngine";
import { CALIBRATED_MODEL } from "@/lib/model/inference";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const league = typeof body.league === "string" && body.league.trim() ? body.league.trim() : "ALL";
    const mode = body.mode === "DATE" ? "DATE" : "UPCOMING";
    const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : undefined;
    const clientToday =
      typeof body.clientToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.clientToday.trim())
        ? body.clientToday.trim()
        : undefined;

    if (mode === "DATE" && !date) {
      return NextResponse.json(
        { ok: false, error: "Debes seleccionar una fecha (YYYY-MM-DD) en el modo por fecha." },
        { status: 400 }
      );
    }

    const result = await analyzeSlate({ league, date, mode, clientToday, persist: true });

    return NextResponse.json({
      ok: true,
      mode,
      league,
      date: date || null,
      count: result.candidates.length,
      candidates: result.candidates,
      parlay: result.parlay,
      valueParlay: result.valueParlay,
      valueParlays: result.valueParlays,
      sourceInfo: result.sourceInfo,
      nextAvailableDate: result.nextAvailableDate,
      generatedAt: result.generatedAt,
      modelInfo: {
        version: CALIBRATED_MODEL.version,
        trainedAt: CALIBRATED_MODEL.trainedAt,
        totalMatchesTrained: CALIBRATED_MODEL.totalMatchesTrained,
        totalMatchesTested: CALIBRATED_MODEL.totalMatchesTested,
      },
      backtestSummary: CALIBRATED_MODEL.backtestSummary,
      evSummary: CALIBRATED_MODEL.evSummary,
    });
  } catch (err: any) {
    console.error("Error en API /api/predict:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Error analizando partidos" },
      { status: 500 }
    );
  }
}
