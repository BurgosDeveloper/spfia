/**
 * Proveedor Secundario de Calendario (football-data.org v4).
 * Se usa únicamente como respaldo de calendario cuando el usuario consulta una fecha
 * futura que aún no figura en football-data.co.uk/fixtures.csv.
 * Todas las métricas estadísticas reales provienen de footballDataUk.ts.
 */

import { getCachedData, setCachedData } from "../cache/persistentCache";
import {
  resolveUkLeagueCode,
  VERIFIED_LEAGUES,
  VERIFIED_LEAGUES_MAP,
} from "./footballDataUk";

export interface MatchFixture {
  id: string;
  utcDate: string;
  dateIso: string;
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

export const SUPPORTED_LEAGUES = Object.fromEntries(
  VERIFIED_LEAGUES.map((l) => [l.code, l])
);

const BASE_URL = "https://api.football-data.org/v4";

function getHeaders() {
  const token = process.env.FOOTBALL_DATA_TOKEN || "";
  return {
    "X-Auth-Token": token,
    Accept: "application/json",
  };
}

/**
 * Consulta partidos futuros en football-data.org para las ligas europeas soportadas por su plan gratuito.
 */
export async function fetchScheduleFallbackForDate(
  dateStr: string,
  leagueCode: string
): Promise<MatchFixture[]> {
  const ukCode = resolveUkLeagueCode(leagueCode);
  const leagueInfo = VERIFIED_LEAGUES_MAP[ukCode];
  if (!leagueInfo || !leagueInfo.fdOrgCode) return [];

  const cacheKey = `fd:sched:v2:${dateStr}:${ukCode}`;
  const cached = await getCachedData<MatchFixture[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/competitions/${leagueInfo.fdOrgCode}/matches?dateFrom=${dateStr}&dateTo=${dateStr}`;

  try {
    const res = await fetch(url, {
      headers: getHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const rawMatches = data.matches || [];
    const validMatches = rawMatches.filter(
      (m: any) => (m.utcDate || "").slice(0, 10) === dateStr
    );

    const matches: MatchFixture[] = validMatches.map((m: any) => ({
      id: `fd:${m.id}`,
      utcDate: m.utcDate,
      dateIso: (m.utcDate || "").slice(0, 10),
      status: m.status,
      matchday: m.matchday,
      leagueCode: ukCode,
      leagueName: leagueInfo.name,
      homeTeam: {
        id: m.homeTeam.id,
        name: m.homeTeam.shortName || m.homeTeam.name,
        shortName: m.homeTeam.shortName,
      },
      awayTeam: {
        id: m.awayTeam.id,
        name: m.awayTeam.shortName || m.awayTeam.name,
        shortName: m.awayTeam.shortName,
      },
      score: m.score,
    }));

    if (matches.length > 0) {
      void setCachedData(cacheKey, matches, 21600).catch(() => {});
    }
    return matches;
  } catch (err) {
    console.warn(`Respaldo football-data.org no disponible para ${ukCode}:`, err);
    return [];
  }
}
