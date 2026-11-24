import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CALIBRATED_MODEL } from "@/lib/model/inference";
import { calculateKellyStake } from "@/lib/math/poisson";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const decision = searchParams.get("decision") || "BET";
    const league = searchParams.get("league") || undefined;
    const date = searchParams.get("date") || undefined;

    const where: any = {};
    if (decision && decision !== "ALL") where.decision = decision;
    if (league && league !== "ALL") where.candidate = { league };
    if (date) where.candidate = { ...(where.candidate || {}), date };

    let picks: any[] = [];
    let dbConnected = true;
    try {
      picks = await prisma.pick.findMany({
        where,
        include: {
          candidate: true,
        },
        orderBy: [{ candidate: { kickoffUtc: "desc" } }, { createdAt: "desc" }],
        take: 150,
      });
    } catch (dbErr) {
      console.warn("DB no disponible en /api/picks, devolviendo backtest:", dbErr);
      dbConnected = false;
    }

    const betPicks = picks.filter((p) => p.decision === "BET");
    const settled = betPicks.filter((p) => p.outcome === "WON" || p.outcome === "LOST");
    const won = settled.filter((p) => p.outcome === "WON").length;
    const lost = settled.filter((p) => p.outcome === "LOST").length;
    const pending = betPicks.filter((p) => p.outcome === "").length;

    let totalStakedWithOdds = 0;
    let totalProfitWithOdds = 0;
    let settledWithOdds = 0;

    const byMarket: Record<
      string,
      { total: number; won: number; lost: number; pending: number; profit: number; staked: number }
    > = {};

    for (const p of betPicks) {
      const mKey = p.market;
      if (!byMarket[mKey]) {
        byMarket[mKey] = { total: 0, won: 0, lost: 0, pending: 0, profit: 0, staked: 0 };
      }
      byMarket[mKey].total++;
      if (p.outcome === "WON") byMarket[mKey].won++;
      else if (p.outcome === "LOST") byMarket[mKey].lost++;
      else byMarket[mKey].pending++;

      if ((p.outcome === "WON" || p.outcome === "LOST") && p.odds > 1.01) {
        const stake = Number((p.reasoning as any)?.stakeUnits ?? 1.0) || 1.0;
        settledWithOdds++;
        totalStakedWithOdds += stake;
        totalProfitWithOdds += p.profitUnits;
        byMarket[mKey].staked += stake;
        byMarket[mKey].profit += p.profitUnits;
      }
    }

    return NextResponse.json({
      ok: true,
      dbConnected,
      count: picks.length,
      picks,
      kpis: {
        totalBets: betPicks.length,
        won,
        lost,
        pending,
        hitRate: settled.length > 0 ? Number((won / settled.length).toFixed(4)) : 0,
        settledWithOdds,
        totalStakedWithOdds: Number(totalStakedWithOdds.toFixed(2)),
        totalProfitWithOdds: Number(totalProfitWithOdds.toFixed(2)),
        roi:
          totalStakedWithOdds > 0
            ? Number((totalProfitWithOdds / totalStakedWithOdds).toFixed(4))
            : 0,
        byMarket,
      },
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
    console.error("Error consultando picks:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Error consultando historial" },
      { status: 500 }
    );
  }
}

/**
 * Permite guardar la cuota real obtenida en la casa de apuestas (útil para Over 1.5 y Córneres)
 * y recalcular automáticamente EV, Stake Kelly y profitUnits si ya fue liquidado.
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { pickId, odds } = body;
    const numOdds = Number(odds);

    if (!pickId || !Number.isFinite(numOdds) || numOdds <= 1.01 || numOdds > 100) {
      return NextResponse.json(
        { ok: false, error: "Se requiere 'pickId' y 'odds' válidas (> 1.01)." },
        { status: 400 }
      );
    }

    const existing = await prisma.pick.findUnique({ where: { id: pickId } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Pick no encontrado" }, { status: 404 });
    }

    const kelly = calculateKellyStake(existing.probability, numOdds, 0.25, 0.025);
    const prevReasoning = (existing.reasoning as Record<string, any>) || {};
    const stake = kelly.stakeUnits > 0 ? kelly.stakeUnits : Number(prevReasoning.stakeUnits ?? 1.0) || 1.0;

    let profitUnits = existing.profitUnits;
    if (existing.outcome === "WON") {
      profitUnits = Number((stake * (numOdds - 1.0)).toFixed(3));
    } else if (existing.outcome === "LOST") {
      profitUnits = Number((-stake).toFixed(3));
    }

    const updated = await prisma.pick.update({
      where: { id: pickId },
      data: {
        odds: Number(numOdds.toFixed(2)),
        ev: kelly.ev,
        profitUnits,
        reasoning: {
          ...prevReasoning,
          stakeUnits: stake,
          userOddsEntered: Number(numOdds.toFixed(2)),
        },
      },
    });

    return NextResponse.json({ ok: true, pick: updated, kelly });
  } catch (err: any) {
    console.error("Error actualizando cuota del pick:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Error actualizando cuota" },
      { status: 500 }
    );
  }
}
