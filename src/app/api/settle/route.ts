import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchLeagueHistory,
  findFinishedUkMatch,
  HistoricalMatchRow,
  resolveUkLeagueCode,
} from "@/lib/providers/footballDataUk";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const pendingPicks = await prisma.pick.findMany({
      where: {
        decision: "BET",
        outcome: "",
      },
      include: {
        candidate: true,
      },
    });

    if (pendingPicks.length === 0) {
      return NextResponse.json({
        ok: true,
        settledCount: 0,
        pendingCount: 0,
        message: "No hay picks pendientes por liquidar.",
      });
    }

    const uniqueLeagues = Array.from(
      new Set(pendingPicks.map((p) => resolveUkLeagueCode(p.candidate.league)))
    );

    const historyMap = new Map<string, HistoricalMatchRow[]>();
    await Promise.all(
      uniqueLeagues.map(async (lg) => {
        historyMap.set(lg, await fetchLeagueHistory(lg));
      })
    );

    let settledCount = 0;
    let stillPendingCount = 0;
    const settledItems: any[] = [];

    for (const pick of pendingPicks) {
      const lgCode = resolveUkLeagueCode(pick.candidate.league);
      const history = historyMap.get(lgCode) || [];
      const match = findFinishedUkMatch(
        history,
        pick.candidate.date,
        pick.candidate.homeTeam,
        pick.candidate.awayTeam
      );

      if (!match) {
        stillPendingCount++;
        continue;
      }

      const totGoals = match.fthg + match.ftag;
      const totCorners =
        match.hc !== null && match.ac !== null ? match.hc + match.ac : null;

      let won: boolean | null = null;
      if (pick.market === "GOALS_O15" || pick.market === "GOALS_OU") {
        won = pick.selection === "UNDER" ? totGoals < pick.line : totGoals > pick.line;
      } else if (pick.market === "GOALS_OU25") {
        won = pick.selection === "UNDER" ? totGoals < 2.5 : totGoals > 2.5;
      } else if (pick.market === "CORNERS_OU") {
        if (totCorners !== null) {
          won = totCorners > pick.line;
        }
      } else if (pick.market === "DOUBLE_CHANCE") {
        if (pick.selection === "1X") won = match.fthg >= match.ftag;
        else if (pick.selection === "X2") won = match.ftag >= match.fthg;
      }

      if (won === null) {
        stillPendingCount++;
        continue;
      }

      const stake = Number((pick.reasoning as any)?.stakeUnits ?? 1.0) || 1.0;
      const hasRealOdds = pick.odds > 1.01;
      const profitUnits = hasRealOdds
        ? Number((won ? stake * (pick.odds - 1.0) : -stake).toFixed(3))
        : 0;
      const outcome = won ? "WON" : "LOST";

      await prisma.pick.update({
        where: { id: pick.id },
        data: {
          outcome,
          profitUnits,
          settledAtUtc: new Date(),
        },
      });

      settledCount++;
      settledItems.push({
        id: pick.id,
        match: `${pick.candidate.homeTeam} vs ${pick.candidate.awayTeam}`,
        market: pick.market,
        selection: pick.selection,
        line: pick.line,
        score: `${match.fthg}-${match.ftag}`,
        corners: totCorners,
        outcome,
        profitUnits,
      });
    }

    return NextResponse.json({
      ok: true,
      settledCount,
      pendingCount: stillPendingCount,
      settledItems,
    });
  } catch (err: any) {
    console.error("Error en /api/settle:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Error liquidando resultados" },
      { status: 500 }
    );
  }
}
