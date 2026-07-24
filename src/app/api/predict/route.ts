import { NextResponse } from "next/server";
import { analyzeLeagueForDate } from "@/lib/predictorEngine";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { date, league } = body;

    if (!date || !league) {
      return NextResponse.json(
        { ok: false, error: "Parámetros 'date' (YYYY-MM-DD) y 'league' son requeridos" },
        { status: 400 }
      );
    }

    const candidates = await analyzeLeagueForDate(date, league);

    return NextResponse.json({
      ok: true,
      date,
      league,
      count: candidates.length,
      candidates,
    });
  } catch (err: any) {
    console.error("Error en API /api/predict:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Error analizando liga" },
      { status: 500 }
    );
  }
}
