import { getCachedData, setCachedData } from "../cache/persistentCache";
import { MatchFixture, SUPPORTED_LEAGUES } from "./footballData";

export interface LineupStatus {
  status: "CONFIRMED" | "AVAILABLE_PARTIAL" | "NOT_AVAILABLE";
  confidence: number;
  homeStartXiCount: number;
  awayStartXiCount: number;
}

export interface TeamSeasonStats {
  teamId: number;
  teamName: string;
  played: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  homePlayed: number;
  homeGoalsForPerGame: number;
  homeGoalsAgainstPerGame: number;
  awayPlayed: number;
  awayGoalsForPerGame: number;
  awayGoalsAgainstPerGame: number;
}

const API_KEY = process.env.API_FOOTBALL_DATA_TOKEN || "f10f4374d9c89e9218f7e716912251af";
const BASE_URL = "https://v3.football.api-sports.io";

export const API_FOOTBALL_LEAGUE_IDS: Record<string, number> = {
  PD: 140,  // LaLiga Primera España
  SD: 141,  // LaLiga Segunda Hypermotion España
  PL: 39,   // Premier League Inglaterra
  ELC: 40,  // Championship Inglaterra
  FL1: 61,  // Ligue 1 Francia
  SA: 135,  // Serie A Italia
  BL1: 78,  // Bundesliga Alemania
  BSA: 71,  // Brasileirao Serie A Brasil
  LPF: 128, // Liga Profesional Primera División Argentina
  PPL: 94,  // Primeira Liga Portugal
  DED: 91,  // Eredivisie Países Bajos
};

const LEAGUE_CORNER_BASELINES: Record<string, { avgHome: number; avgAway: number }> = {
  PL:  { avgHome: 5.6, avgAway: 4.8 },
  PD:  { avgHome: 5.1, avgAway: 4.5 },
  SD:  { avgHome: 5.3, avgAway: 4.5 },
  BL1: { avgHome: 5.4, avgAway: 4.7 },
  SA:  { avgHome: 5.2, avgAway: 4.6 },
  FL1: { avgHome: 5.0, avgAway: 4.5 },
  ELC: { avgHome: 5.7, avgAway: 4.8 },
  BSA: { avgHome: 5.5, avgAway: 4.7 },
  LPF: { avgHome: 5.0, avgAway: 4.4 },
  PPL: { avgHome: 5.5, avgAway: 4.6 },
  DED: { avgHome: 5.7, avgAway: 4.8 },
};

function getHeaders() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json",
  };
}

export function normTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(fc|cf|cd|ud|sd|sc|ac|afc|club|deportivo|real)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Obtiene la tabla de clasificaciones completa con estadísticas por equipo en 1 sola llamada HTTP.
 * Mantiene la cuota diaria intacta y evita errores de Rate Limiting (429).
 */
export async function fetchApiFootballStandings(
  leagueCode: string
): Promise<Record<string, TeamSeasonStats>> {
  const leagueId = API_FOOTBALL_LEAGUE_IDS[leagueCode];
  if (!leagueId || !API_KEY) return {};

  const cacheKey = `apif:standings:v3:${leagueCode}:${leagueId}`;
  const cached = await getCachedData<Record<string, TeamSeasonStats>>(cacheKey);
  if (cached) return cached;

  const seasonsToTry = [2024, 2023, 2022];

  for (const season of seasonsToTry) {
    try {
      const url = `${BASE_URL}/standings?league=${leagueId}&season=${season}`;
      const res = await fetch(url, { headers: getHeaders(), cache: "no-store" });
      if (!res.ok) continue;

      const data = await res.json();
      if (data.errors && Object.keys(data.errors).length > 0) continue;

      const standingsList = data.response?.[0]?.league?.standings?.[0] || [];
      if (standingsList.length === 0) continue;

      const result: Record<string, TeamSeasonStats> = {};

      for (const row of standingsList) {
        const teamId = row.team?.id;
        const teamName = row.team?.name || "";
        const normName = normTeamName(teamName);
        const played = Math.max(1, row.all?.played || 1);
        const goalsFor = row.all?.goals?.for || 0;
        const goalsAgainst = row.all?.goals?.against || 0;

        const homePlayed = Math.max(1, row.home?.played || 1);
        const homeGoalsFor = row.home?.goals?.for || 0;
        const homeGoalsAgainst = row.home?.goals?.against || 0;

        const awayPlayed = Math.max(1, row.away?.played || 1);
        const awayGoalsFor = row.away?.goals?.for || 0;
        const awayGoalsAgainst = row.away?.goals?.against || 0;

        const stats: TeamSeasonStats = {
          teamId,
          teamName,
          played,
          goalsForPerGame: goalsFor / played,
          goalsAgainstPerGame: goalsAgainst / played,
          homePlayed,
          homeGoalsForPerGame: homeGoalsFor / homePlayed,
          homeGoalsAgainstPerGame: homeGoalsAgainst / homePlayed,
          awayPlayed,
          awayGoalsForPerGame: awayGoalsFor / awayPlayed,
          awayGoalsAgainstPerGame: awayGoalsAgainst / awayPlayed,
        };

        // Guardar por ID numérico y por nombre normalizado para garantizar matching 100%
        result[String(teamId)] = stats;
        result[normName] = stats;
      }

      await setCachedData(cacheKey, result, 86400); // Caché 24 horas
      return result;
    } catch (err) {
      console.error(`Error obteniendo clasificaciones para ${leagueCode}:`, err);
    }
  }

  return {};
}

/**
 * Obtiene promedios de córneres por liga (baseline usado si las stats por equipo no están disponibles).
 */
export function getDefaultCornerStatsForLeague(leagueCode: string): {
  avgCornersHome: number;
  avgCornersAway: number;
} {
  const baseline = LEAGUE_CORNER_BASELINES[leagueCode];
  return baseline
    ? { avgCornersHome: baseline.avgHome, avgCornersAway: baseline.avgAway }
    : { avgCornersHome: 5.2, avgCornersAway: 4.5 };
}

/**
 * Consulta de partidos desde API-Football (api-sports.io).
 * Aplica Ventana de Tiempo por Jornada Local.
 */
export async function fetchMatchesFromApiFootball(
  dateStr: string,
  leagueCode: string
): Promise<MatchFixture[]> {
  const cacheKey = `apif:v4:matchday:${dateStr}:${leagueCode}`;
  const cached = await getCachedData<MatchFixture[]>(cacheKey);
  if (cached) return cached;

  if (!API_KEY) return [];

  const targetLeagueId = API_FOOTBALL_LEAGUE_IDS[leagueCode];
  const leagueInfo = SUPPORTED_LEAGUES[leagueCode];
  const targetCode = leagueCode.toUpperCase();

  const currDateObj = new Date(dateStr + "T00:00:00Z");
  const nextDateObj = new Date(currDateObj.getTime() + 86400000);
  const nextDateStr = nextDateObj.toISOString().split("T")[0];

  const windowStart = new Date(dateStr + "T05:00:00Z").getTime();
  const windowEnd = new Date(nextDateStr + "T04:59:59Z").getTime();

  try {
    const [resCurr, resNext] = await Promise.all([
      fetch(`${BASE_URL}/fixtures?date=${dateStr}`, { headers: getHeaders(), cache: "no-store" }),
      fetch(`${BASE_URL}/fixtures?date=${nextDateStr}`, { headers: getHeaders(), cache: "no-store" }),
    ]);

    let responseList: any[] = [];
    if (resCurr.ok) {
      const dCurr = await resCurr.json();
      responseList = responseList.concat(dCurr.response || []);
    }
    if (resNext.ok) {
      const dNext = await resNext.json();
      responseList = responseList.concat(dNext.response || []);
    }

    const matchesMap = new Map<number, MatchFixture>();

    for (const item of responseList) {
      const fLeague = item.league || {};
      const fLeagueId = fLeague.id;
      const fName = (fLeague.name || "").toLowerCase();
      const fCountry = (fLeague.country || "").toLowerCase();
      const fDate = item.fixture?.date || "";

      if (fName.includes("reserve") || fName.includes("u20") || fName.includes("u21") || fName.includes("u19")) continue;

      const fixtureTime = new Date(fDate).getTime();
      if (fixtureTime < windowStart || fixtureTime > windowEnd) continue;

      let isMatch = false;
      if (fLeagueId && targetLeagueId) {
        // Validación estricta por ID oficial de liga (ej. 128 para LPF Liga Profesional Argentina)
        isMatch = fLeagueId === targetLeagueId;
      } else if (!fLeagueId && targetCode === "LPF" && fCountry === "argentina") {
        // Fallback únicamente cuando la API no devuelve ID de liga
        const isExcluded =
          fName.includes("primera b") ||
          fName.includes("primera c") ||
          fName.includes("primera d") ||
          fName.includes("nacional") ||
          fName.includes("metropolitana") ||
          fName.includes("federal") ||
          fName.includes("copa") ||
          fName.includes("reserve") ||
          fName.includes("women") ||
          fName.includes("femenino");
        if (!isExcluded && (fName === "liga profesional argentina" || fName === "primera división" || fName.includes("liga profesional"))) {
          isMatch = true;
        }
      } else if (!fLeagueId) {
        if (targetCode === "SD" && fCountry === "spain" && (fName.includes("segunda") || fName.includes("hypermotion"))) isMatch = true;
        else if (targetCode === "PD" && fCountry === "spain" && (fName.includes("primera") || fName.includes("la liga"))) isMatch = true;
        else if (targetCode === "PL" && fCountry === "england" && fName.includes("premier")) isMatch = true;
        else if (targetCode === "ELC" && fCountry === "england" && fName.includes("championship")) isMatch = true;
        else if (targetCode === "FL1" && fCountry === "france" && fName.includes("ligue 1")) isMatch = true;
        else if (targetCode === "SA" && fCountry === "italy" && fName.includes("serie a")) isMatch = true;
        else if (targetCode === "BL1" && fCountry === "germany" && fName.includes("bundesliga")) isMatch = true;
        else if (targetCode === "BSA" && fCountry === "brazil" && fName.includes("serie a")) isMatch = true;
      }

      if (isMatch && !matchesMap.has(item.fixture.id)) {
        matchesMap.set(item.fixture.id, {
          id: item.fixture.id,
          utcDate: item.fixture.date,
          status: item.fixture.status?.short || "NS",
          matchday: fLeague.round ? parseInt(fLeague.round.replace(/\D/g, "") || "1", 10) : 1,
          leagueCode: leagueCode,
          leagueName: leagueInfo?.name || fLeague.name,
          homeTeam: { id: item.teams.home.id, name: item.teams.home.name },
          awayTeam: { id: item.teams.away.id, name: item.teams.away.name },
          score: {
            fullTime: { home: item.goals.home, away: item.goals.away },
          },
        });
      }
    }

    const matches = Array.from(matchesMap.values());
    await setCachedData(cacheKey, matches, 21600);
    return matches;
  } catch (err) {
    console.error(`Error en API-Football para ${leagueCode}:`, err);
    return [];
  }
}

/**
 * Consulta alineaciones pre-partido.
 */
export async function fetchLineupsForMatch(
  dateStr: string,
  homeTeam: string,
  awayTeam: string
): Promise<LineupStatus> {
  const normHome = normTeamName(homeTeam);
  const normAway = normTeamName(awayTeam);
  const cacheKey = `apif:lineups:${dateStr}:${normHome}:${normAway}`;

  const cached = await getCachedData<LineupStatus>(cacheKey);
  if (cached) return cached;

  if (!API_KEY) {
    return { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
  }

  try {
    const searchUrl = `${BASE_URL}/fixtures?date=${dateStr}&search=${encodeURIComponent(homeTeam.split(" ")[0])}`;
    const resSearch = await fetch(searchUrl, { headers: getHeaders(), cache: "no-store" });
    if (!resSearch.ok) return { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };

    const searchData = await resSearch.json();
    const fixtures = searchData.response || [];

    const matchedFixture = fixtures.find((f: any) => {
      const fHome = normTeamName(f.teams?.home?.name || "");
      const fAway = normTeamName(f.teams?.away?.name || "");
      return fHome.includes(normHome) || normHome.includes(fHome) || fAway.includes(normAway);
    });

    if (!matchedFixture) {
      const fallback: LineupStatus = { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
      await setCachedData(cacheKey, fallback, 3600);
      return fallback;
    }

    const fixtureId = matchedFixture.fixture?.id;
    if (!fixtureId) {
      const fallback: LineupStatus = { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
      await setCachedData(cacheKey, fallback, 3600);
      return fallback;
    }

    const lineupsUrl = `${BASE_URL}/fixtures/lineups?fixture=${fixtureId}`;
    const resLineups = await fetch(lineupsUrl, { headers: getHeaders(), cache: "no-store" });
    if (!resLineups.ok) {
      const fallback: LineupStatus = { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
      await setCachedData(cacheKey, fallback, 3600);
      return fallback;
    }

    const lineupsData = await resLineups.json();
    const lineupList = lineupsData.response || [];

    let homeXi = 0;
    let awayXi = 0;
    if (lineupList.length >= 2) {
      homeXi = lineupList[0]?.startXI?.length || 0;
      awayXi = lineupList[1]?.startXI?.length || 0;
    }

    let status: "CONFIRMED" | "AVAILABLE_PARTIAL" | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    let confidence = 0.92;
    if (homeXi === 11 && awayXi === 11) { status = "CONFIRMED"; confidence = 1.0; }
    else if (homeXi > 0 || awayXi > 0) { status = "AVAILABLE_PARTIAL"; confidence = 0.96; }

    const result: LineupStatus = { status, confidence, homeStartXiCount: homeXi, awayStartXiCount: awayXi };
    await setCachedData(cacheKey, result, status === "CONFIRMED" ? 86400 : 900);
    return result;
  } catch (err) {
    console.error("Error consultando alineaciones en API-Football:", err);
    return { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
  }
}
