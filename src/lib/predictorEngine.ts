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
  fetchApiFootballStandings,
  getDefaultCornerStatsForLeague,
  normTeamName,
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
 * Calcula la estabilidad estadística real (100% dinámica e independiente por partido)
 * basada en tamaño de muestra efectivo, consistencia de gol/córner, origen de datos y alineaciones.
 */
function calculateDynamicStability(
  homePlayed: number,
  awayPlayed: number,
  homeSource: string,
  awaySource: string,
  lambda1: number,
  lambda2: number,
  lineupConfidence: number,
  marketType: "GOALS" | "CORNERS"
): number {
  // 1. Asintótica continua de tamaño de muestra (Media armónica de partidos jugados)
  const effPlayed = (2 * homePlayed * awayPlayed) / Math.max(1, homePlayed + awayPlayed);
  const sampleConfidence = 0.58 + 0.33 * (1 - Math.exp(-effPlayed / 11.0)); // Crece suavemente de 0.60 a 0.91

  // 2. Calidad de la fuente de datos (Real API vs Fallback)
  let sourceQuality = 0;
  if (homeSource.includes("API-Football") || homeSource.includes("football-data")) sourceQuality += 0.025;
  if (awaySource.includes("API-Football") || awaySource.includes("football-data")) sourceQuality += 0.025;
  if (homeSource.includes("FALLBACK")) sourceQuality -= 0.06;
  if (awaySource.includes("FALLBACK")) sourceQuality -= 0.06;

  // 3. Consistencia y balance estadístico del partido (evitar partidos de extrema varianza aleatoria)
  let consistencyScore = 0;
  const ratio = Math.min(lambda1, lambda2) / Math.max(0.1, Math.max(lambda1, lambda2));
  if (marketType === "GOALS") {
    const totalLambdas = lambda1 + lambda2;
    consistencyScore += (Math.min(3.2, totalLambdas) - 2.0) * 0.02;
    consistencyScore += (ratio - 0.5) * 0.03;
  } else {
    const totalCorners = lambda1 + lambda2;
    consistencyScore += (Math.min(11.0, totalCorners) - 8.5) * 0.015;
    consistencyScore += (ratio - 0.5) * 0.025;
  }

  // 4. Confianza de alineaciones pre-partido
  const lineupBoost = (lineupConfidence - 0.85) * 0.15;

  const rawStability = sampleConfidence + sourceQuality + consistencyScore + lineupBoost;
  // Clampeado a rango realista probabilístico [0.5500, 0.9650] y redondeado a 4 decimales
  return Number(Math.max(0.55, Math.min(0.965, rawStability)).toFixed(4));
}

/**
 * Procesa la evaluación completa para una liga en la fecha solicitada.
 * Utiliza clasificaciones por equipo en 1 sola consulta HTTP por liga para garantizar
 * que CADA PARTIDO tenga sus propias estadísticas únicas sin agotar la cuota de la API.
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

  // 2. Obtener clasificaciones completas de ambas APIs (1 sola llamada por liga)
  const [apifStandings, fdStandings] = await Promise.all([
    fetchApiFootballStandings(leagueCode),
    fetchStandingsRates(leagueCode),
  ]);

  const defaultCorners = getDefaultCornerStatsForLeague(leagueCode);
  const results: CandidateResult[] = [];

  for (const m of matches) {
    const fixtureId = `fd:${m.id}`;

    // Alineaciones
    const lineupsInfo = await fetchLineupsForMatch(dateStr, m.homeTeam.name, m.awayTeam.name);

    // --- BÚSQUEDA DE ESTADÍSTICAS POR EQUIPO ---
    const normHome = normTeamName(m.homeTeam.name);
    const normAway = normTeamName(m.awayTeam.name);

    const homeApi = apifStandings[String(m.homeTeam.id)] || apifStandings[normHome];
    const awayApi = apifStandings[String(m.awayTeam.id)] || apifStandings[normAway];

    const homeFd = fdStandings[m.homeTeam.id];
    const awayFd = fdStandings[m.awayTeam.id];

    // Resolver métricas ofensivas/defensivas de GOLES por equipo usando Desglose Local/Visitante (Si existe)
    let homeGF: number, homeGA: number, homePlayed: number;
    let homeSource: string;
    
    if (homeApi) {
      // Candado 1: Sample Size Blend para Local (Mezclar global si hay pocos partidos de local)
      homePlayed = homeApi.homePlayed;
      if (homePlayed < 5) {
        homeGF = (homeApi.homeGoalsForPerGame + homeApi.goalsForPerGame) / 2.0;
        homeGA = (homeApi.homeGoalsAgainstPerGame + homeApi.goalsAgainstPerGame) / 2.0;
        homeSource = `API-Football Blend (<5 Home PJ, GF:${homeGF.toFixed(2)}, GA:${homeGA.toFixed(2)})`;
      } else {
        homeGF = homeApi.homeGoalsForPerGame;
        homeGA = homeApi.homeGoalsAgainstPerGame;
        homeSource = `API-Football Pure Home (${homePlayed}PJ, GF:${homeGF.toFixed(2)}, GA:${homeGA.toFixed(2)})`;
      }
    } else if (homeFd) {
      // football-data.org solo da TOTAL en free tier, aplicamos el total
      homeGF = homeFd.goalsForPerGame;
      homeGA = homeFd.goalsAgainstPerGame;
      homePlayed = 15;
      homeSource = `football-data (${homeFd.goalsForPerGame.toFixed(2)}/${homeFd.goalsAgainstPerGame.toFixed(2)})`;
    } else {
      homeGF = 1.30;
      homeGA = 1.15;
      homePlayed = 5;
      homeSource = "Liga Promedio (Ajuste Calibrado)";
    }

    let awayGF: number, awayGA: number, awayPlayed: number;
    let awaySource: string;
    
    if (awayApi) {
      // Candado 1: Sample Size Blend para Visitante
      awayPlayed = awayApi.awayPlayed;
      if (awayPlayed < 5) {
        awayGF = (awayApi.awayGoalsForPerGame + awayApi.goalsForPerGame) / 2.0;
        awayGA = (awayApi.awayGoalsAgainstPerGame + awayApi.goalsAgainstPerGame) / 2.0;
        awaySource = `API-Football Blend (<5 Away PJ, GF:${awayGF.toFixed(2)}, GA:${awayGA.toFixed(2)})`;
      } else {
        awayGF = awayApi.awayGoalsForPerGame;
        awayGA = awayApi.awayGoalsAgainstPerGame;
        awaySource = `API-Football Pure Away (${awayPlayed}PJ, GF:${awayGF.toFixed(2)}, GA:${awayGA.toFixed(2)})`;
      }
    } else if (awayFd) {
      awayGF = awayFd.goalsForPerGame;
      awayGA = awayFd.goalsAgainstPerGame;
      awayPlayed = 15;
      awaySource = `football-data (${awayFd.goalsForPerGame.toFixed(2)}/${awayFd.goalsAgainstPerGame.toFixed(2)})`;
    } else {
      awayGF = 1.10;
      awayGA = 1.35;
      awayPlayed = 5;
      awaySource = "Liga Promedio (Ajuste Calibrado)";
    }

    // --- CÁLCULO DE LAMBDAS DE GOLES (Determinista) ---
    // Si la fuente es LatAm (API-Football) ya es Local Puro y Visita Puro, así que el multiplicador 1.12 es redundante.
    // Si la fuente es football-data (Europa), es TOTAL, por lo que aplicamos el 1.12 empírico a favor del Local.
    const homeAdvantage = homeApi ? 1.0 : 1.12; 
    const awayAdjustment = awayApi ? 1.0 : 0.88;

    const lambdaHomeGoals = Math.max(0.3, ((homeGF + awayGA) / 2.0) * homeAdvantage);
    const lambdaAwayGoals = Math.max(0.3, ((awayGF + homeGA) / 2.0) * awayAdjustment);
    const lambdaTotalGoals = lambdaHomeGoals + lambdaAwayGoals;

    // --- CÁLCULO DE LAMBDAS DE CÓRNERES (Específicos para este partido) ---
    // Derivación dinámica según presión ofensiva y debilidad defensiva de cada equipo
    const baseH = defaultCorners.avgCornersHome;
    const baseA = defaultCorners.avgCornersAway;

    const lambdaCornersHome = Math.max(3.0, baseH * Math.pow(homeGF / 1.3, 0.5) * Math.pow(awayGA / 1.2, 0.3) * homeAdvantage);
    const lambdaCornersAway = Math.max(2.5, baseA * Math.pow(awayGF / 1.3, 0.5) * Math.pow(homeGA / 1.2, 0.3) * awayAdjustment);
    const lambdaCornersTotal = lambdaCornersHome + lambdaCornersAway;

    // --- ESTABILIDAD DINÁMICA REAL POR PARTIDO Y POR MERCADO ---
    // Calculada independientemente sin valores hardcodeados ni por defecto
    const goalsStability = calculateDynamicStability(
      homePlayed,
      awayPlayed,
      homeSource,
      awaySource,
      lambdaHomeGoals,
      lambdaAwayGoals,
      lineupsInfo.confidence,
      "GOALS"
    );

    const cornersStability = calculateDynamicStability(
      homePlayed,
      awayPlayed,
      homeSource,
      awaySource,
      lambdaCornersHome,
      lambdaCornersAway,
      lineupsInfo.confidence,
      "CORNERS"
    );

    // --- RISK CHECK ANTI-LOW-SCORE ---
    const lowRisk = lowScoreRiskOver15(lambdaHomeGoals, lambdaAwayGoals);
    const passesLowScoreRisk = lowRisk.p00 <= 0.12 && lowRisk.pTotalLe1 <= 0.22;

    // Candado 3: Sincronización Córner/Gol (Si el riesgo de 0-0 es alto, los córneres sufren penalización)
    let finalCornersStability = cornersStability;
    if (lowRisk.p00 > 0.12) {
      finalCornersStability = Math.max(0.55, finalCornersStability - 0.08); // Penalización del 8%
    }

    const picks: PickResult[] = [];

    // ========== EVALUACIÓN 1: GOLES OVER 1.5 Y OVER 2.5 ==========
    let pOver15Raw = probOverDixonColes(lambdaHomeGoals, lambdaAwayGoals, 1.5);
    let pOver25Raw = probOverDixonColes(lambdaHomeGoals, lambdaAwayGoals, 2.5);

    // Candado 2: Cross-Volatility Filter (Varianza Cruzada)
    // Si el local anota muchísimo (ej. 3.0) pero el visitante defiende perfecto (ej. 0.2)
    if (Math.abs(homeGF - awayGA) > 1.5 || Math.abs(awayGF - homeGA) > 1.5) {
      pOver15Raw *= 0.95; // Castigo del 5% a la probabilidad bruta
      pOver25Raw *= 0.95;
    }

    const pOver15Adj = 0.5 + (pOver15Raw - 0.5) * lineupsInfo.confidence;
    const pOver25Adj = 0.5 + (pOver25Raw - 0.5) * lineupsInfo.confidence;

    const { pLower: pOver15Lower } = calculateLowerBound(pOver15Adj, goalsStability, lineupsInfo.confidence);
    const { pLower: pOver25Lower } = calculateLowerBound(pOver25Adj, goalsStability, lineupsInfo.confidence);

    const thrGoals = 0.80;

    const goalsReasoning = {
      lambdaHome: Number(lambdaHomeGoals.toFixed(3)),
      lambdaAway: Number(lambdaAwayGoals.toFixed(3)),
      lambdaTotal: Number(lambdaTotalGoals.toFixed(3)),
      homeTeamStats: homeSource,
      awayTeamStats: awaySource,
      lineupsStatus: lineupsInfo.status,
      stability: goalsStability,
      lowRisk,
    };

    if (pOver25Lower >= thrGoals && passesLowScoreRisk) {
      picks.push({
        market: "GOALS_OU", selection: "OVER", line: 2.5,
        probability: Number(pOver25Adj.toFixed(4)),
        pLower: Number(pOver25Lower.toFixed(4)),
        decision: "BET", threshold: thrGoals, stability: goalsStability,
        reasoning: goalsReasoning,
      });
    } else if (pOver15Lower >= thrGoals && passesLowScoreRisk) {
      picks.push({
        market: "GOALS_OU", selection: "OVER", line: 1.5,
        probability: Number(pOver15Adj.toFixed(4)),
        pLower: Number(pOver15Lower.toFixed(4)),
        decision: "BET", threshold: thrGoals, stability: goalsStability,
        reasoning: goalsReasoning,
      });
    } else {
      picks.push({
        market: "GOALS_OU", selection: "OVER", line: 1.5,
        probability: Number(pOver15Adj.toFixed(4)),
        pLower: Number(pOver15Lower.toFixed(4)),
        decision: "NO_BET", threshold: thrGoals, stability: goalsStability,
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

    const { pLower: pCorners65Lower } = calculateLowerBound(pCorners65Adj, finalCornersStability, lineupsInfo.confidence);
    const { pLower: pCorners75Lower } = calculateLowerBound(pCorners75Adj, finalCornersStability, lineupsInfo.confidence);

    const thrCorners = 0.78;

    const cornerRiskMsg = (lowRisk.p00 > 0.12) ? "⚠ Riesgo 0-0 penalizó Córneres (-8% estabilidad)" : "Riesgo de bajo marcador bajo control.";

    const cornersReasoning = {
      lambdaCornersHome: Number(lambdaCornersHome.toFixed(2)),
      lambdaCornersAway: Number(lambdaCornersAway.toFixed(2)),
      lambdaCornersTotal: Number(lambdaCornersTotal.toFixed(2)),
      homeTeamStats: homeSource,
      awayTeamStats: awaySource,
      lineupsStatus: lineupsInfo.status,
      stability: finalCornersStability,
      cornerRiskMsg,
    };

    if (pCorners75Lower >= thrCorners) {
      picks.push({
        market: "CORNERS_OU", selection: "OVER", line: 7.5,
        probability: Number(pCorners75Adj.toFixed(4)),
        pLower: Number(pCorners75Lower.toFixed(4)),
        decision: "BET", threshold: thrCorners, stability: finalCornersStability,
        reasoning: cornersReasoning,
      });
    } else if (pCorners65Lower >= thrCorners) {
      picks.push({
        market: "CORNERS_OU", selection: "OVER", line: 6.5,
        probability: Number(pCorners65Adj.toFixed(4)),
        pLower: Number(pCorners65Lower.toFixed(4)),
        decision: "BET", threshold: thrCorners, stability: finalCornersStability,
        reasoning: cornersReasoning,
      });
    } else {
      picks.push({
        market: "CORNERS_OU", selection: "OVER", line: 6.5,
        probability: Number(pCorners65Adj.toFixed(4)),
        pLower: Number(pCorners65Lower.toFixed(4)),
        decision: "NO_BET", threshold: thrCorners, stability: finalCornersStability,
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
        homeStats: homeSource,
        awayStats: awaySource,
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
