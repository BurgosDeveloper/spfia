import { getCachedData, setCachedData } from "../cache/persistentCache";
import { fetchMatchesFromApiFootball } from "./apiFootball";

export interface MatchFixture {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number;
  leagueCode: string;
  leagueName: string;
  homeTeam: { id: number; name: string; shortName?: string };
  awayTeam: { id: number; name: string; shortName?: string };
  score?: {
    fullTime?: { home: number | null; away: number | null };
  };
}

export interface TeamStandingRate {
  teamId: number;
  teamName: string;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
}

export const SUPPORTED_LEAGUES: Record<string, { code: string; name: string; country: string }> = {
  PD: { code: "PD", name: "LaLiga Primera", country: "España" },
  SD: { code: "SD", name: "LaLiga Segunda Hypermotion", country: "España" },
  PL: { code: "PL", name: "Premier League", country: "Inglaterra" },
  ELC: { code: "ELC", name: "Championship", country: "Inglaterra" },
  FL1: { code: "FL1", name: "Ligue 1", country: "Francia" },
  SA: { code: "SA", name: "Serie A", country: "Italia" },
  BL1: { code: "BL1", name: "Bundesliga", country: "Alemania" },
  BSA: { code: "BSA", name: "Brasileirao Serie A", country: "Brasil" },
  LPF: { code: "LPF", name: "Primera División Argentina", country: "Argentina" },
};

const BASE_URL = "https://api.football-data.org/v4";

function getHeaders() {
  const token = process.env.FOOTBALL_DATA_TOKEN || "946f807431bf460f868d279d49cfddd0";
  return {
    "X-Auth-Token": token,
    "Accept": "application/json",
  };
}

/**
 * Obtiene los partidos programados para una fecha específica y liga seleccionada.
 * Si football-data.org no incluye la liga o devuelve vacío/403, intenta automáticamente con API-Football.
 */
export async function fetchMatchesForDateAndLeague(
  dateStr: string,
  leagueCode: string
): Promise<MatchFixture[]> {
  const cacheKey = `fd:matches:${dateStr}:${leagueCode}`;
  const cached = await getCachedData<MatchFixture[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/competitions/${leagueCode}/matches?dateFrom=${dateStr}&dateTo=${dateStr}`;

  try {
    const res = await fetch(url, { headers: getHeaders(), cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const rawMatches = data.matches || [];

      if (rawMatches.length > 0) {
        const matches: MatchFixture[] = rawMatches.map((m: any) => ({
          id: m.id,
          utcDate: m.utcDate,
          status: m.status,
          matchday: m.matchday,
          leagueCode: leagueCode,
          leagueName: SUPPORTED_LEAGUES[leagueCode]?.name || leagueCode,
          homeTeam: { id: m.homeTeam.id, name: m.homeTeam.name, shortName: m.homeTeam.shortName },
          awayTeam: { id: m.awayTeam.id, name: m.awayTeam.name, shortName: m.awayTeam.shortName },
          score: m.score,
        }));

        await setCachedData(cacheKey, matches, 43200);
        return matches;
      }
    }
  } catch (err) {
    console.warn(`football-data.org falló para ${leagueCode}, intentando fallback API-Football...`);
  }

  // Fallback automático con API-Football (api-sports.io)
  const fallbackMatches = await fetchMatchesFromApiFootball(dateStr, leagueCode);
  if (fallbackMatches.length > 0) {
    await setCachedData(cacheKey, fallbackMatches, 21600);
  }
  return fallbackMatches;
}

/**
 * Obtiene la tabla de posiciones y promedios de goles para la competición.
 */
export async function fetchStandingsRates(
  leagueCode: string
): Promise<Record<number, TeamStandingRate>> {
  const cacheKey = `fd:standings:${leagueCode}`;
  const cached = await getCachedData<Record<number, TeamStandingRate>>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/competitions/${leagueCode}/standings`;

  try {
    const res = await fetch(url, { headers: getHeaders(), cache: "no-store" });
    if (!res.ok) return {};

    const data = await res.json();
    const result: Record<number, TeamStandingRate> = {};

    const standings = data.standings || [];
    const totalTable = standings.find((s: any) => s.type === "TOTAL") || standings[0];

    if (totalTable && totalTable.table) {
      for (const row of totalTable.table) {
        const teamId = row.team.id;
        const played = Math.max(1, row.playedGames || 1);
        const gf = row.goalsFor || 0;
        const ga = row.goalsAgainst || 0;

        result[teamId] = {
          teamId,
          teamName: row.team.name,
          goalsForPerGame: gf / played,
          goalsAgainstPerGame: ga / played,
        };
      }
    }

    // Cache por 24 horas para standings
    await setCachedData(cacheKey, result, 86400);
    return result;
  } catch (err) {
    console.error(`Error fetching standings para ${leagueCode}:`, err);
    return {};
  }
}
