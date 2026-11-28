import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EspnFinishedMatch,
  fetchEspnFinishedMatchesForDate,
  fetchLeagueHistory,
  findFinishedUkMatch,
  HistoricalMatchRow,
  resolveUkLeagueCode,
  teamsMatch,
} from "@/lib/providers/footballDataUk";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const pendingPicks = await prisma.pick.findMany({
      where: {
        decision: "BET",
        outcome: "",
        runTag: { in: ["TIER_S", "TIER_A"] },
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

    // Identificar picks aún no publicados en los CSV semanales para consultar ESPN en tiempo real
    const espnNeedMap = new Map<
      string,
      { lgCode: string; dateIso: string; cornerTargets: Array<{ homeTeam: string; awayTeam: string }> }
    >();

    for (const pick of pendingPicks) {
      const lgCode = resolveUkLeagueCode(pick.candidate.league);
      const history = historyMap.get(lgCode) || [];
      const ukMatch = findFinishedUkMatch(
        history,
        pick.candidate.date,
        pick.candidate.homeTeam,
        pick.candidate.awayTeam
      );

      if (
        !ukMatch ||
        ((pick.market === "CORNERS_OU" || pick.market === "CORNERS_O85") &&
          (ukMatch.hc === null || ukMatch.ac === null))
      ) {
        const key = `${lgCode}:${pick.candidate.date}`;
        if (!espnNeedMap.has(key)) {
          espnNeedMap.set(key, {
            lgCode,
            dateIso: pick.candidate.date,
            cornerTargets: [],
          });
        }
        if (pick.market === "CORNERS_OU" || pick.market === "CORNERS_O85") {
          espnNeedMap.get(key)!.cornerTargets.push({
            homeTeam: pick.candidate.homeTeam,
            awayTeam: pick.candidate.awayTeam,
          });
        }
      }
    }

    const espnMap = new Map<string, EspnFinishedMatch[]>();
    await Promise.all(
      Array.from(espnNeedMap.entries()).map(async ([key, reqInfo]) => {
        const matches = await fetchEspnFinishedMatchesForDate(
          reqInfo.lgCode,
          reqInfo.dateIso,
          reqInfo.cornerTargets
        );
        espnMap.set(key, matches);
      })
    );

    let settledCount = 0;
    let stillPendingCount = 0;
    const settledItems: any[] = [];

    for (const pick of pendingPicks) {
      const lgCode = resolveUkLeagueCode(pick.candidate.league);
      const history = historyMap.get(lgCode) || [];
      const ukMatch = findFinishedUkMatch(
        history,
        pick.candidate.date,
        pick.candidate.homeTeam,
        pick.candidate.awayTeam
      );

      let fthg: number | null = ukMatch ? ukMatch.fthg : null;
      let ftag: number | null = ukMatch ? ukMatch.ftag : null;
      let hc: number | null = ukMatch ? ukMatch.hc : null;
      let ac: number | null = ukMatch ? ukMatch.ac : null;
      let settledSource = ukMatch ? "FDUK" : "";

      if (
        !ukMatch ||
        ((pick.market === "CORNERS_OU" || pick.market === "CORNERS_O85") &&
          (hc === null || ac === null))
      ) {
        const espnList = espnMap.get(`${lgCode}:${pick.candidate.date}`) || [];
        const espnMatch = espnList.find(
          (m) =>
            teamsMatch(m.homeTeam, pick.candidate.homeTeam) &&
            teamsMatch(m.awayTeam, pick.candidate.awayTeam)
        );
        if (espnMatch) {
          if (fthg === null || ftag === null) {
            fthg = espnMatch.fthg;
            ftag = espnMatch.ftag;
            settledSource = "ESPN";
          }
          if (hc === null || ac === null) {
            hc = espnMatch.hc;
            ac = espnMatch.ac;
            if (!settledSource) settledSource = "ESPN";
          }
        }
      }

      if (fthg === null || ftag === null) {
        stillPendingCount++;
        continue;
      }

      const totGoals = fthg + ftag;
      const totCorners = hc !== null && ac !== null ? hc + ac : null;

      let won: boolean | null = null;
      if (pick.market === "GOALS_O15" || pick.market === "GOALS_OU") {
        won = pick.selection === "UNDER" ? totGoals < pick.line : totGoals > pick.line;
      } else if (pick.market === "GOALS_OU25") {
        won = pick.selection === "UNDER" ? totGoals < 2.5 : totGoals > 2.5;
      } else if (pick.market === "CORNERS_OU" || pick.market === "CORNERS_O85") {
        if (totCorners !== null) {
          won = totCorners > pick.line;
        }
      } else if (pick.market === "DOUBLE_CHANCE") {
        if (pick.selection === "1X") won = fthg >= ftag;
        else if (pick.selection === "X2") won = ftag >= fthg;
      } else if (pick.market === "COMBO_DC_O15") {
        if (pick.selection === "1X_O15") won = fthg >= ftag && totGoals >= 2;
        else if (pick.selection === "X2_O15") won = ftag >= fthg && totGoals >= 2;
      } else if (pick.market === "TEAM_O15") {
        if (pick.selection === "HOME_OVER") won = fthg >= 2;
        else if (pick.selection === "AWAY_OVER") won = ftag >= 2;
      } else if (pick.market === "HOME_WIN") {
        won = fthg > ftag;
      } else if (pick.market === "HT_O05") {
        if (ukMatch?.hthg !== null && ukMatch?.hthg !== undefined && ukMatch?.htag !== null && ukMatch?.htag !== undefined) {
          won = ukMatch.hthg + ukMatch.htag >= 1;
        } else if (fthg === 0 && ftag === 0) {
          won = false;
        }
      }

      if (won === null) {
        stillPendingCount++;
        continue;
      }

      const prevReasoning = (pick.reasoning as Record<string, any>) || {};
      const stake = Number(prevReasoning.stakeUnits ?? 1.0) || 1.0;
      const hasRealOdds = pick.odds > 1.01;
      const profitUnits = hasRealOdds
        ? Number((won ? stake * (pick.odds - 1.0) : -stake).toFixed(3))
        : 0;
      const outcome = won ? "WON" : "LOST";
      const settledScore = `${fthg}-${ftag}`;

      await prisma.pick.update({
        where: { id: pick.id },
        data: {
          outcome,
          profitUnits,
          settledAtUtc: new Date(),
          reasoning: {
            ...prevReasoning,
            settledScore,
            settledCorners: totCorners,
            settledSource,
          } as any,
        },
      });

      settledCount++;
      settledItems.push({
        id: pick.id,
        match: `${pick.candidate.homeTeam} vs ${pick.candidate.awayTeam}`,
        market: pick.market,
        selection: pick.selection,
        line: pick.line,
        score: settledScore,
        corners: totCorners,
        source: settledSource,
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
