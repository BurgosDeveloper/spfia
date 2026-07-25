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
  fetchTeamSeasonStats,
  fetchTeamCornerStats,
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
  line: number;
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
 * Obtiene datos estadísticos REALES por equipo de ambas APIs.
 */
export async function analyzeLeagueForDate(
  dateStr: string,
  leagueCode: string
): Promise<CandidateResult[]> {
  const leagueInfo = SUPPORTED_LEAGUES[leagueCode];
  if (!leagueInfo) {
    throw new Error(`Liga no soportada: ${leagueCode}`);
  }

  // 1. Obtener partidos de la jornada
  const matches = await fetchMatchesForDateAndLeague(dateStr, leagueCode);
  if (!matches || matches.length === 0) return [];

  // 2. Obtener standings de football-data.org (puede estar vacío para ligas secundarias)
  const standings = await fetchStandingsRates(leagueCode);

  // 3. Promedios de córneres de la liga (baseline)
  const defaultCorners = getDefaultCornerStatsForLeague(leagueCode);

  const results: CandidateResult[] = [];

  for (const m of matches) {
    const fixtureId = `fd:${m.id}`;

    // --- PASO A: Obtener estadísticas REALES por equipo ---

    // A1. Intentar stats de API-Football por equipo
    const [homeApiStats, awayApiStats] = await Promise.all([
      fetchTeamSeasonStats(m.homeTeam.id, leagueCode),
      fetchTeamSeasonStats(m.awayTeam.id, leagueCode),
    ]);

    // A2. Stats de football-data.org standings (como fallback)
    const homeFdStats = standings[m.homeTeam.id];
    const awayFdStats = standings[m.awayTeam.id];

    // A3. Resolver goles por partido del LOCAL
    let homeGF: number, homeGA: number, homePlayed: number;
    if (homeApiStats && homeApiStats.played >= 3) {
      homeGF = homeApiStats.goalsForPerGame;
      homeGA = homeApiStats.goalsAgainstPerGame;
      homePlayed = homeApiStats.played;
    } else if (homeFdStats) {
      homeGF = homeFdStats.goalsForPerGame;
      homeGA = homeFdStats.goalsAgainstPerGame;
      homePlayed = 10; // Estimación
    } else {
      homeGF = 1.25;
      homeGA = 1.15;
      homePlayed = 0;
    }

    // A4. Resolver goles por partido del VISITANTE
    let awayGF: number, awayGA: number, awayPlayed: number;
    if (awayApiStats && awayApiStats.played >= 3) {
      awayGF = awayApiStats.goalsForPerGame;
      awayGA = awayApiStats.goalsAgainstPerGame;
      awayPlayed = awayApiStats.played;
    } else if (awayFdStats) {
      awayGF = awayFdStats.goalsForPerGame;
      awayGA = awayFdStats.goalsAgainstPerGame;
      awayPlayed = 10;
    } else {
      awayGF = 1.15;
      awayGA = 1.30;
      awayPlayed = 0;
    }

    // --- PASO B: Calcular Lambdas de GOLES por equipo ---
    const homeAdvantage = 1.06;
    const awayAdjustment = 0.94;

    // Lambda Home = promedio entre (ataque local + defensa visitante) / 2 * ventaja local
    const lambdaHomeGoals = Math.max(0.3, ((homeGF + awayGA) / 2.0) * homeAdvantage);
    // Lambda Away = promedio entre (ataque visitante + defensa local) / 2 * desventaja visitante
    const lambdaAwayGoals = Math.max(0.3, ((awayGF + homeGA) / 2.0) * awayAdjustment);
    const lambdaTotalGoals = lambdaHomeGoals + lambdaAwayGoals;

    // --- PASO C: Obtener estadísticas REALES de CÓRNERES por equipo ---
    const [homeCornerStats, awayCornerStats] = await Promise.all([
      fetchTeamCornerStats(m.homeTeam.id, leagueCode),
      fetchTeamCornerStats(m.awayTeam.id, leagueCode),
    ]);

    let lambdaCornersHome: number;
    let lambdaCornersAway: number;
    let cornerDataSource: string;

    if (homeCornerStats && awayCornerStats && homeCornerStats.matchCount >= 3 && awayCornerStats.matchCount >= 3) {
      // Datos REALES por equipo
      lambdaCornersHome = homeCornerStats.cornersFor * homeAdvantage;
      lambdaCornersAway = awayCornerStats.cornersFor * awayAdjustment;
      cornerDataSource = `REAL (Home: ${homeCornerStats.matchCount} matches, Away: ${awayCornerStats.matchCount} matches)`;
    } else if (homeCornerStats && homeCornerStats.matchCount >= 3) {
      lambdaCornersHome = homeCornerStats.cornersFor * homeAdvantage;
      lambdaCornersAway = defaultCorners.avgCornersAway * awayAdjustment;
      cornerDataSource = `MIXED (Home: REAL ${homeCornerStats.matchCount} matches, Away: BASELINE)`;
    } else if (awayCornerStats && awayCornerStats.matchCount >= 3) {
      lambdaCornersHome = defaultCorners.avgCornersHome * homeAdvantage;
      lambdaCornersAway = awayCornerStats.cornersFor * awayAdjustment;
      cornerDataSource = `MIXED (Home: BASELINE, Away: REAL ${awayCornerStats.matchCount} matches)`;
    } else {
      lambdaCornersHome = defaultCorners.avgCornersHome * homeAdvantage;
      lambdaCornersAway = defaultCorners.avgCornersAway * awayAdjustment;
      cornerDataSource = "BASELINE (promedios históricos de liga)";
    }

    // --- PASO D: Alineaciones ---
    const lineupsInfo = await fetchLineupsForMatch(dateStr, m.homeTeam.name, m.awayTeam.name);

    // --- PASO E: Estabilidad basada en partidos jugados ---
    const minPlayed = Math.min(homePlayed, awayPlayed);
    const stabilityFactor = minPlayed >= 15 ? 0.90
      : minPlayed >= 10 ? 0.80
      : minPlayed >= 5 ? 0.70
      : minPlayed >= 3 ? 0.60
      : 0.50;

    // --- PASO F: Risk Check anti-low-score ---
    const lowRisk = lowScoreRiskOver15(lambdaHomeGoals, lambdaAwayGoals);
    const passesLowScoreRisk = lowRisk.p00 <= 0.12 && lowRisk.pTotalLe1 <= 0.22;

    const picks: PickResult[] = [];

    // ========== EVALUACIÓN 1: GOLES OVER 1.5 Y OVER 2.5 ==========
    const pOver15Raw = probOverDixonColes(lambdaHomeGoals, lambdaAwayGoals, 1.5);
    const pOver25Raw = probOverDixonColes(lambdaHomeGoals, lambdaAwayGoals, 2.5);

    const pOver15Adj = 0.5 + (pOver15Raw - 0.5) * lineupsInfo.confidence;
    const pOver25Adj = 0.5 + (pOver25Raw - 0.5) * lineupsInfo.confidence;

    const { pLower: pOver15Lower } = calculateLowerBound(pOver15Adj, stabilityFactor, lineupsInfo.confidence);
    const { pLower: pOver25Lower } = calculateLowerBound(pOver25Adj, stabilityFactor, lineupsInfo.confidence);

    const thrGoals = 0.80;

    const goalsReasoning = {
      lambdaHome: Number(lambdaHomeGoals.toFixed(3)),
      lambdaAway: Number(lambdaAwayGoals.toFixed(3)),
      lambdaTotal: Number(lambdaTotalGoals.toFixed(3)),
      homeStats: homeApiStats
        ? `API-Football: ${homeApiStats.played}PJ, GF/PJ=${homeApiStats.goalsForPerGame.toFixed(2)}, GA/PJ=${homeApiStats.goalsAgainstPerGame.toFixed(2)}`
        : homeFdStats
        ? `football-data: GF/PJ=${homeFdStats.goalsForPerGame.toFixed(2)}, GA/PJ=${homeFdStats.goalsAgainstPerGame.toFixed(2)}`
        : "FALLBACK (sin datos reales)",
      awayStats: awayApiStats
        ? `API-Football: ${awayApiStats.played}PJ, GF/PJ=${awayApiStats.goalsForPerGame.toFixed(2)}, GA/PJ=${awayApiStats.goalsAgainstPerGame.toFixed(2)}`
        : awayFdStats
        ? `football-data: GF/PJ=${awayFdStats.goalsForPerGame.toFixed(2)}, GA/PJ=${awayFdStats.goalsAgainstPerGame.toFixed(2)}`
        : "FALLBACK (sin datos reales)",
      lineupsStatus: lineupsInfo.status,
      stability: stabilityFactor,
      lowRisk,
    };

    if (pOver25Lower >= thrGoals && passesLowScoreRisk) {
      picks.push({
        market: "GOALS_OU", selection: "OVER", line: 2.5,
        probability: Number(pOver25Adj.toFixed(4)),
        pLower: Number(pOver25Lower.toFixed(4)),
        decision: "BET", threshold: thrGoals, stability: stabilityFactor,
        reasoning: goalsReasoning,
      });
    } else if (pOver15Lower >= thrGoals && passesLowScoreRisk) {
      picks.push({
        market: "GOALS_OU", selection: "OVER", line: 1.5,
        probability: Number(pOver15Adj.toFixed(4)),
        pLower: Number(pOver15Lower.toFixed(4)),
        decision: "BET", threshold: thrGoals, stability: stabilityFactor,
        reasoning: goalsReasoning,
      });
    } else {
      picks.push({
        market: "GOALS_OU", selection: "OVER", line: 1.5,
        probability: Number(pOver15Adj.toFixed(4)),
        pLower: Number(pOver15Lower.toFixed(4)),
        decision: "NO_BET", threshold: thrGoals, stability: stabilityFactor,
        reasoning: {
          ...goalsReasoning,
          reason: !passesLowScoreRisk
            ? `Riesgo de marcador bajo: P(0-0)=${(lowRisk.p00 * 100).toFixed(1)}%, P(≤1 gol)=${(lowRisk.pTotalLe1 * 100).toFixed(1)}%`
            : `P_lower=${(pOver15Lower * 100).toFixed(1)}% < umbral ${thrGoals * 100}%`,
        },
      });
    }

    // ========== EVALUACIÓN 2: CÓRNERES OVER 6.5 Y OVER 7.5 ==========
    const { pOver: pCorners65Raw } = probOverCorners(lambdaCornersHome, lambdaCornersAway, 6.5);
    const { pOver: pCorners75Raw } = probOverCorners(lambdaCornersHome, lambdaCornersAway, 7.5);

    const pCorners65Adj = 0.5 + (pCorners65Raw - 0.5) * lineupsInfo.confidence;
    const pCorners75Adj = 0.5 + (pCorners75Raw - 0.5) * lineupsInfo.confidence;

    const { pLower: pCorners65Lower } = calculateLowerBound(pCorners65Adj, stabilityFactor, lineupsInfo.confidence);
    const { pLower: pCorners75Lower } = calculateLowerBound(pCorners75Adj, stabilityFactor, lineupsInfo.confidence);

    const thrCorners = 0.78;

    const cornersReasoning = {
      lambdaCornersHome: Number(lambdaCornersHome.toFixed(2)),
      lambdaCornersAway: Number(lambdaCornersAway.toFixed(2)),
      lambdaCornersTotal: Number((lambdaCornersHome + lambdaCornersAway).toFixed(2)),
      cornerDataSource,
      lineupsStatus: lineupsInfo.status,
      stability: stabilityFactor,
    };

    if (pCorners75Lower >= thrCorners) {
      picks.push({
        market: "CORNERS_OU", selection: "OVER", line: 7.5,
        probability: Number(pCorners75Adj.toFixed(4)),
        pLower: Number(pCorners75Lower.toFixed(4)),
        decision: "BET", threshold: thrCorners, stability: stabilityFactor,
        reasoning: cornersReasoning,
      });
    } else if (pCorners65Lower >= thrCorners) {
      picks.push({
        market: "CORNERS_OU", selection: "OVER", line: 6.5,
        probability: Number(pCorners65Adj.toFixed(4)),
        pLower: Number(pCorners65Lower.toFixed(4)),
        decision: "BET", threshold: thrCorners, stability: stabilityFactor,
        reasoning: cornersReasoning,
      });
    } else {
      picks.push({
        market: "CORNERS_OU", selection: "OVER", line: 6.5,
        probability: Number(pCorners65Adj.toFixed(4)),
        pLower: Number(pCorners65Lower.toFixed(4)),
        decision: "NO_BET", threshold: thrCorners, stability: stabilityFactor,
        reasoning: {
          ...cornersReasoning,
          reason: `P_lower=${(pCorners65Lower * 100).toFixed(1)}% < umbral ${thrCorners * 100}%`,
        },
      });
    }

    // Persistir candidato y picks en Neon DB
    let candRecord: any;
    try {
      const snapData = {
        lineupStatus: lineupsInfo,
        score: m.score,
        homeApiStats: homeApiStats ? { played: homeApiStats.played, gfPg: homeApiStats.goalsForPerGame, gaPg: homeApiStats.goalsAgainstPerGame } : null,
        awayApiStats: awayApiStats ? { played: awayApiStats.played, gfPg: awayApiStats.goalsForPerGame, gaPg: awayApiStats.goalsAgainstPerGame } : null,
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
