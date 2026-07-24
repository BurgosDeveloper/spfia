import { getCachedData, setCachedData } from "../cache/persistentCache";
import { MatchFixture, SUPPORTED_LEAGUES } from "./footballData";

export interface LineupStatus {
  status: "CONFIRMED" | "AVAILABLE_PARTIAL" | "NOT_AVAILABLE";
  confidence: number; // 1.0 para CONFIRMED, 0.96 para PARTIAL, 0.92 para NOT_AVAILABLE
  homeStartXiCount: number;
  awayStartXiCount: number;
}

export interface TeamCornerStats {
  teamName: string;
  avgCornersEarnedHome: number;
  avgCornersConcededHome: number;
  avgCornersEarnedAway: number;
  avgCornersConcededAway: number;
  overallAvgCorners: number;
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
};

function getHeaders() {
  return {
    "x-apisports-key": API_KEY,
    "Accept": "application/json",
  };
}

/**
 * Normaliza nombres de equipos para hacer matching con API-Football.
 */
function normTeamName(name: string): string {
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
 * Consulta de partidos desde API-Football (api-sports.io).
 * Filtra la respuesta completa de partidos por fecha (evita el error de parámetro season de la API)
 * asegurando la extracción exacta de la Liga Profesional y Primera División.
 */
export async function fetchMatchesFromApiFootball(
  dateStr: string,
  leagueCode: string
): Promise<MatchFixture[]> {
  const cacheKey = `apif:v3:fixtures:${dateStr}:${leagueCode}`;
  const cached = await getCachedData<MatchFixture[]>(cacheKey);
  if (cached) return cached;

  if (!API_KEY) return [];

  const targetLeagueId = API_FOOTBALL_LEAGUE_IDS[leagueCode];
  const leagueInfo = SUPPORTED_LEAGUES[leagueCode];
  const targetCode = leagueCode.toUpperCase();

  try {
    const url = `${BASE_URL}/fixtures?date=${dateStr}`;
    const res = await fetch(url, { headers: getHeaders(), cache: "no-store" });
    if (!res.ok) return [];

    const data = await res.json();
    const responseList = data.response || [];

    const matches: MatchFixture[] = [];

    for (const item of responseList) {
      const fLeague = item.league || {};
      const fLeagueId = fLeague.id;
      const fCountry = (fLeague.country || "").toLowerCase();
      const fName = (fLeague.name || "").toLowerCase();

      // Excluir ligas de reservas o juveniles
      if (fName.includes("reserve") || fName.includes("u20") || fName.includes("u21") || fName.includes("u19")) {
        continue;
      }

      let isMatch = false;

      // 1. Coincidencia directa por ID de Liga
      if (targetLeagueId && fLeagueId === targetLeagueId) {
        isMatch = true;
      } else {
        // 2. Coincidencia secundaria por País y Nombre de Liga
        if (targetCode === "LPF" && (fCountry === "argentina" && (fName.includes("liga profesional") || fName.includes("primera")))) {
          isMatch = true;
        } else if (targetCode === "SD" && fCountry === "spain" && (fName.includes("segunda") || fName.includes("hypermotion"))) {
          isMatch = true;
        } else if (targetCode === "PD" && fCountry === "spain" && (fName.includes("primera") || fName.includes("la liga"))) {
          isMatch = true;
        } else if (targetCode === "PL" && fCountry === "england" && fName.includes("premier")) {
          isMatch = true;
        } else if (targetCode === "ELC" && fCountry === "england" && fName.includes("championship")) {
          isMatch = true;
        } else if (targetCode === "FL1" && fCountry === "france" && fName.includes("ligue 1")) {
          isMatch = true;
        } else if (targetCode === "SA" && fCountry === "italy" && fName.includes("serie a")) {
          isMatch = true;
        } else if (targetCode === "BL1" && fCountry === "germany" && fName.includes("bundesliga")) {
          isMatch = true;
        } else if (targetCode === "BSA" && fCountry === "brazil" && fName.includes("serie a")) {
          isMatch = true;
        }
      }

      if (isMatch) {
        matches.push({
          id: item.fixture.id,
          utcDate: item.fixture.date,
          status: item.fixture.status?.short || "NS",
          matchday: fLeague.round ? parseInt(fLeague.round.replace(/\D/g, "") || "1", 10) : 1,
          leagueCode: leagueCode,
          leagueName: leagueInfo?.name || fLeague.name,
          homeTeam: { id: item.teams.home.id, name: item.teams.home.name },
          awayTeam: { id: item.teams.away.id, name: item.teams.away.name },
          score: {
            fullTime: {
              home: item.goals.home,
              away: item.goals.away,
            },
          },
        });
      }
    }

    await setCachedData(cacheKey, matches, 21600); // 6 horas de caché
    return matches;
  } catch (err) {
    console.error(`Error en API-Football para ${leagueCode}:`, err);
    return [];
  }
}

/**
 * Consulta alineaciones pre-partido si el token está activo.
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
    // 1. Buscar fixture ID
    const searchUrl = `${BASE_URL}/fixtures?date=${dateStr}&search=${encodeURIComponent(homeTeam.split(" ")[0])}`;
    const resSearch = await fetch(searchUrl, { headers: getHeaders(), cache: "no-store" });
    
    if (!resSearch.ok) {
      return { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
    }

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

    // 2. Obtener lineups
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

    if (homeXi === 11 && awayXi === 11) {
      status = "CONFIRMED";
      confidence = 1.0;
    } else if (homeXi > 0 || awayXi > 0) {
      status = "AVAILABLE_PARTIAL";
      confidence = 0.96;
    }

    const result: LineupStatus = {
      status,
      confidence,
      homeStartXiCount: homeXi,
      awayStartXiCount: awayXi,
    };

    await setCachedData(cacheKey, result, status === "CONFIRMED" ? 86400 : 900);
    return result;
  } catch (err) {
    console.error("Error consultando alineaciones en API-Football:", err);
    return { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
  }
}

/**
 * Obtiene promedios de córneres por liga y equipo (o usa promedios históricos calibrados por liga).
 */
export function getDefaultCornerStatsForLeague(leagueCode: string): {
  avgCornersHome: number;
  avgCornersAway: number;
} {
  switch (leagueCode) {
    case "PL": // Premier League (~10.4 córneres/partido)
      return { avgCornersHome: 5.6, avgCornersAway: 4.8 };
    case "PD": // LaLiga España (~9.6 córneres/partido)
      return { avgCornersHome: 5.1, avgCornersAway: 4.5 };
    case "SD": // LaLiga Segunda (~9.8 córneres/partido)
      return { avgCornersHome: 5.3, avgCornersAway: 4.5 };
    case "BL1": // Bundesliga (~10.1 córneres/partido)
      return { avgCornersHome: 5.4, avgCornersAway: 4.7 };
    case "SA": // Serie A Italia (~9.8 córneres/partido)
      return { avgCornersHome: 5.2, avgCornersAway: 4.6 };
    case "FL1": // Ligue 1 Francia (~9.5 córneres/partido)
      return { avgCornersHome: 5.0, avgCornersAway: 4.5 };
    case "ELC": // Championship (~10.5 córneres/partido)
      return { avgCornersHome: 5.7, avgCornersAway: 4.8 };
    case "BSA": // Brasil Serie A (~10.2 córneres/partido)
      return { avgCornersHome: 5.5, avgCornersAway: 4.7 };
    case "LPF": // Argentina Primera (~9.4 córneres/partido)
      return { avgCornersHome: 5.0, avgCornersAway: 4.4 };
    default:
      return { avgCornersHome: 5.2, avgCornersAway: 4.5 };
  }
}
