import {
  lowScoreRiskOver15,
  probOverCorners,
  probOverDixonColes,
} from "./math/poisson";
import {
  fetchMatchesForDateAndLeague,
  fetchStandingsRates,
  SUPPORTED_LEAGUES,
} from "./providers/footballData";
import {
  fetchLineupsForMatch,
  getDefaultCornerStatsForLeague,
  LineupStatus,
} from "./providers/apiFootball";
import { prisma } from "./prisma";

export interface CandidateResult {
  id: string;
  date: string;
  league: string;
  leagueName: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  status: string;
  lineupStatus: LineupStatus;
  picks: PickResult[];
}

export interface PickResult {
  id?: string;
  market: "GOALS_OU" | "CORNERS_OU";
  selection: "OVER";
  line: number; // 1.5, 2.5 para goles; 6.5, 7.5 para córneres
  probability: number;
  pLower: number;
  decision: "BET" | "NO_BET";
  threshold: number;
  stability: number;
  reasoning: Record<string, any>;
}

/**
 * Calculo del margen de seguridad para el límite inferior (P_lower).
 */
function calculateLowerBound(
  p: number,
  stabilityFactor: number,
  lineupConfidence: number
): { pLower: number; margin: number } {
  let margin = 0.01;
  margin += 0.06 * (1.0 - Math.min(1.0, Math.max(0.0, stabilityFactor)));
  margin += 0.06 * (1.0 - Math.min(1.0, Math.max(0.0, lineupConfidence)));
  margin = Math.min(0.12, Math.max(0.0, margin));

  const pLower = Math.min(1.0, Math.max(0.0, p - margin));
  return { pLower, margin };
}

/**
 * Procesa la evaluación completa para una liga en la fecha solicitada.
 */
export async function analyzeLeagueForDate(
  dateStr: string,
  leagueCode: string
): Promise<CandidateResult[]> {
  const leagueInfo = SUPPORTED_LEAGUES[leagueCode];
  if (!leagueInfo) {
    throw new Error(`Liga no soportada: ${leagueCode}`);
  }

  // 1. Obtener partidos y clasificaciones
  const matches = await fetchMatchesForDateAndLeague(dateStr, leagueCode);
  if (!matches || matches.length === 0) return [];

  const standings = await fetchStandingsRates(leagueCode);
  const defaultCorners = getDefaultCornerStatsForLeague(leagueCode);

  const results: CandidateResult[] = [];

  for (const m of matches) {
    const fixtureId = `fd:${m.id}`;

    // Obtener alineaciones
    const lineupsInfo = await fetchLineupsForMatch(dateStr, m.homeTeam.name, m.awayTeam.name);

    // Calcular lambdas de goles (Home vs Away venue split)
    const homeRates = standings[m.homeTeam.id] || { goalsForPerGame: 1.35, goalsAgainstPerGame: 1.25 };
    const awayRates = standings[m.awayTeam.id] || { goalsForPerGame: 1.25, goalsAgainstPerGame: 1.45 };

    const homeAdvantage = 1.05;
    const awayAdjustment = 0.95;

    const lambdaHomeGoals = Math.max(0.2, ((homeRates.goalsForPerGame + awayRates.goalsAgainstPerGame) / 2.0) * homeAdvantage);
    const lambdaAwayGoals = Math.max(0.2, ((awayRates.goalsForPerGame + homeRates.goalsAgainstPerGame) / 2.0) * awayAdjustment);
    const lambdaTotalGoals = lambdaHomeGoals + lambdaAwayGoals;

    // Estabilidad histórica
    const stabilityFactor = 0.75; // Factor estandarizado de forma reciente

    // Risk Check anti-low-score
    const lowRisk = lowScoreRiskOver15(lambdaHomeGoals, lambdaAwayGoals);
    const passesLowScoreRisk = lowRisk.p00 <= 0.12 && lowRisk.pTotalLe1 <= 0.22;

    const picks: PickResult[] = [];

    // --- EVALUACIÓN 1: GOLES OVER 1.5 Y OVER 2.5 ---
    const pOver15Raw = probOverDixonColes(lambdaHomeGoals, lambdaAwayGoals, 1.5);
    const pOver25Raw = probOverDixonColes(lambdaHomeGoals, lambdaAwayGoals, 2.5);

    // Ajustar probabilidad con factor de alineaciones
    const pOver15Adj = 0.5 + (pOver15Raw - 0.5) * lineupsInfo.confidence;
    const pOver25Adj = 0.5 + (pOver25Raw - 0.5) * lineupsInfo.confidence;

    const { pLower: pOver15Lower } = calculateLowerBound(pOver15Adj, stabilityFactor, lineupsInfo.confidence);
    const { pLower: pOver25Lower } = calculateLowerBound(pOver25Adj, stabilityFactor, lineupsInfo.confidence);

    const thrGoals = 0.80; // Umbral mínimo 80%

    // Selección de la mejor línea de Goles
    if (pOver25Lower >= thrGoals && passesLowScoreRisk) {
      picks.push({
        market: "GOALS_OU",
        selection: "OVER",
        line: 2.5,
        probability: Number(pOver25Adj.toFixed(4)),
        pLower: Number(pOver25Lower.toFixed(4)),
        decision: "BET",
        threshold: thrGoals,
        stability: stabilityFactor,
        reasoning: {
          lambdaHome: Number(lambdaHomeGoals.toFixed(3)),
          lambdaAway: Number(lambdaAwayGoals.toFixed(3)),
          lambdaTotal: Number(lambdaTotalGoals.toFixed(3)),
          lineupsStatus: lineupsInfo.status,
          lowRisk,
        },
      });
    } else if (pOver15Lower >= thrGoals && passesLowScoreRisk) {
      picks.push({
        market: "GOALS_OU",
        selection: "OVER",
        line: 1.5,
        probability: Number(pOver15Adj.toFixed(4)),
        pLower: Number(pOver15Lower.toFixed(4)),
        decision: "BET",
        threshold: thrGoals,
        stability: stabilityFactor,
        reasoning: {
          lambdaHome: Number(lambdaHomeGoals.toFixed(3)),
          lambdaAway: Number(lambdaAwayGoals.toFixed(3)),
          lambdaTotal: Number(lambdaTotalGoals.toFixed(3)),
          lineupsStatus: lineupsInfo.status,
          lowRisk,
        },
      });
    } else {
      // Diagnóstico NO_BET
      picks.push({
        market: "GOALS_OU",
        selection: "OVER",
        line: 1.5,
        probability: Number(pOver15Adj.toFixed(4)),
        pLower: Number(pOver15Lower.toFixed(4)),
        decision: "NO_BET",
        threshold: thrGoals,
        stability: stabilityFactor,
        reasoning: {
          lambdaHome: Number(lambdaHomeGoals.toFixed(3)),
          lambdaAway: Number(lambdaAwayGoals.toFixed(3)),
          lambdaTotal: Number(lambdaTotalGoals.toFixed(3)),
          lineupsStatus: lineupsInfo.status,
          lowRisk,
          reason: "No superó el límite inferior de seguridad 80% o riesgo bajo gol",
        },
      });
    }

    // --- EVALUACIÓN 2: CÓRNERES OVER 6.5 Y OVER 7.5 ---
    const lambdaCornersHome = defaultCorners.avgCornersHome * 1.05;
    const lambdaCornersAway = defaultCorners.avgCornersAway * 0.95;

    const { pOver: pCorners65Raw } = probOverCorners(lambdaCornersHome, lambdaCornersAway, 6.5);
    const { pOver: pCorners75Raw } = probOverCorners(lambdaCornersHome, lambdaCornersAway, 7.5);

    const pCorners65Adj = 0.5 + (pCorners65Raw - 0.5) * lineupsInfo.confidence;
    const pCorners75Adj = 0.5 + (pCorners75Raw - 0.5) * lineupsInfo.confidence;

    const { pLower: pCorners65Lower } = calculateLowerBound(pCorners65Adj, stabilityFactor, lineupsInfo.confidence);
    const { pLower: pCorners75Lower } = calculateLowerBound(pCorners75Adj, stabilityFactor, lineupsInfo.confidence);

    const thrCorners = 0.78; // Umbral mínimo 78%

    if (pCorners75Lower >= thrCorners) {
      picks.push({
        market: "CORNERS_OU",
        selection: "OVER",
        line: 7.5,
        probability: Number(pCorners75Adj.toFixed(4)),
        pLower: Number(pCorners75Lower.toFixed(4)),
        decision: "BET",
        threshold: thrCorners,
        stability: stabilityFactor,
        reasoning: {
          lambdaCornersHome: Number(lambdaCornersHome.toFixed(2)),
          lambdaCornersAway: Number(lambdaCornersAway.toFixed(2)),
          lambdaCornersTotal: Number((lambdaCornersHome + lambdaCornersAway).toFixed(2)),
          lineupsStatus: lineupsInfo.status,
        },
      });
    } else if (pCorners65Lower >= thrCorners) {
      picks.push({
        market: "CORNERS_OU",
        selection: "OVER",
        line: 6.5,
        probability: Number(pCorners65Adj.toFixed(4)),
        pLower: Number(pCorners65Lower.toFixed(4)),
        decision: "BET",
        threshold: thrCorners,
        stability: stabilityFactor,
        reasoning: {
          lambdaCornersHome: Number(lambdaCornersHome.toFixed(2)),
          lambdaCornersAway: Number(lambdaCornersAway.toFixed(2)),
          lambdaCornersTotal: Number((lambdaCornersHome + lambdaCornersAway).toFixed(2)),
          lineupsStatus: lineupsInfo.status,
        },
      });
    } else {
      picks.push({
        market: "CORNERS_OU",
        selection: "OVER",
        line: 6.5,
        probability: Number(pCorners65Adj.toFixed(4)),
        pLower: Number(pCorners65Lower.toFixed(4)),
        decision: "NO_BET",
        threshold: thrCorners,
        stability: stabilityFactor,
        reasoning: {
          lambdaCornersHome: Number(lambdaCornersHome.toFixed(2)),
          lambdaCornersAway: Number(lambdaCornersAway.toFixed(2)),
          lambdaCornersTotal: Number((lambdaCornersHome + lambdaCornersAway).toFixed(2)),
          lineupsStatus: lineupsInfo.status,
          reason: "No superó el límite inferior de seguridad 78%",
        },
      });
    }

    // Persistir candidato y picks en Neon DB
    let candRecord: any;
    try {
      const snapData = {
        lineupStatus: lineupsInfo,
        score: m.score,
      };

      candRecord = await prisma.candidate.upsert({
        where: { fixtureId },
        create: {
          date: dateStr,
          league: leagueCode,
          fixtureId,
          homeTeam: m.homeTeam.name,
          awayTeam: m.awayTeam.name,
          kickoffUtc: new Date(m.utcDate),
          executeAtUtc: new Date(m.utcDate),
          status: picks.some((p) => p.decision === "BET") ? "CANDIDATE" : "NO_BET",
          snapshot: snapData as any,
        },
        update: {
          status: picks.some((p) => p.decision === "BET") ? "CANDIDATE" : "NO_BET",
          snapshot: snapData as any,
        },
      });

      // Crear o actualizar picks en DB
      for (const pk of picks) {
        await prisma.pick.create({
          data: {
            candidateId: candRecord.id,
            decision: pk.decision,
            market: pk.market,
            selection: pk.selection,
            line: pk.line,
            probability: pk.probability,
            pLower: pk.pLower,
            reasoning: pk.reasoning as any,
          },
        });
      }
    } catch (err) {
      console.error(`Error guardando candidato ${fixtureId} en Neon DB:`, err);
    }

    results.push({
      id: candRecord?.id || fixtureId,
      date: dateStr,
      league: leagueCode,
      leagueName: leagueInfo.name,
      fixtureId,
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      kickoffUtc: m.utcDate,
      status: m.status,
      lineupStatus: lineupsInfo,
      picks,
    });
  }

  return results;
}
