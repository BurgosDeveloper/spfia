/**
 * Proveedor Oficial de Datos Reales para 16 Ligas Europeas (football-data.co.uk).
 * Extrae goles FT/HT, córneres reales (HC/AC), tiros (HS/AS), tiros a puerta (HST/AST),
 * árbitros y cuotas reales de Bet365 y Betfair Exchange (BFE) sin costo ni límites diarios.
 */

import { getCachedData, setCachedData } from "../cache/persistentCache";
import { devigThreeWay, devigTwoWay, dutchDoubleChanceOdds } from "../math/poisson";
import { CALIBRATED_MODEL, LeagueParams } from "../model/inference";

export interface VerifiedLeague {
  code: string;        // Código oficial football-data.co.uk (ej. "E0", "SP1")
  fdOrgCode?: string;  // Código equivalente en football-data.org (si aplica)
  name: string;
  country: string;
  flag: string;
}

export const VERIFIED_LEAGUES: VerifiedLeague[] = [
  { code: "E0",  fdOrgCode: "PL",  name: "Premier League",        country: "Inglaterra",   flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "E1",  fdOrgCode: "ELC", name: "Championship",          country: "Inglaterra",   flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "SP1", fdOrgCode: "PD",  name: "LaLiga Primera",        country: "España",       flag: "🇪🇸" },
  { code: "SP2",                   name: "LaLiga Hypermotion",    country: "España",       flag: "🇪🇸" },
  { code: "I1",  fdOrgCode: "SA",  name: "Serie A",               country: "Italia",       flag: "🇮🇹" },
  { code: "I2",                    name: "Serie B",               country: "Italia",       flag: "🇮🇹" },
  { code: "D1",  fdOrgCode: "BL1", name: "Bundesliga",            country: "Alemania",     flag: "🇩🇪" },
  { code: "D2",                    name: "2. Bundesliga",         country: "Alemania",     flag: "🇩🇪" },
  { code: "F1",  fdOrgCode: "FL1", name: "Ligue 1",               country: "Francia",      flag: "🇫🇷" },
  { code: "F2",                    name: "Ligue 2",               country: "Francia",      flag: "🇫🇷" },
  { code: "P1",  fdOrgCode: "PPL", name: "Primeira Liga",         country: "Portugal",     flag: "🇵🇹" },
  { code: "N1",  fdOrgCode: "DED", name: "Eredivisie",            country: "Países Bajos", flag: "🇳🇱" },
  { code: "B1",                    name: "Jupiler Pro League",    country: "Bélgica",      flag: "🇧🇪" },
  { code: "SC0",                   name: "Scottish Premiership",  country: "Escocia",      flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { code: "T1",                    name: "Süper Lig",             country: "Turquía",      flag: "🇹🇷" },
  { code: "G1",                    name: "Super League Greece",   country: "Grecia",       flag: "🇬🇷" },
];

export const VERIFIED_LEAGUES_MAP: Record<string, VerifiedLeague> = Object.fromEntries(
  VERIFIED_LEAGUES.map((l) => [l.code, l])
);

const FDORG_TO_UK_CODE: Record<string, string> = {
  PL: "E0",
  ELC: "E1",
  PD: "SP1",
  SD: "SP2",
  SA: "I1",
  BL1: "D1",
  FL1: "F1",
  PPL: "P1",
  DED: "N1",
};

export function resolveUkLeagueCode(code: string): string {
  const upper = code.toUpperCase();
  if (VERIFIED_LEAGUES_MAP[upper]) return upper;
  return FDORG_TO_UK_CODE[upper] || upper;
}

export interface HistoricalMatchRow {
  league: string;
  season: string;
  dateIso: string;
  dateOrd: number;
  homeTeam: string;
  awayTeam: string;
  fthg: number;
  ftag: number;
  hc: number | null;
  ac: number | null;
  hs: number | null;
  as: number | null;
  hst: number | null;
  ast: number | null;
}

export interface LiveMarketOdds {
  hasMarketOdds: boolean;
  pMktH: number | null;
  pMktD: number | null;
  pMktA: number | null;
  pMktO25: number | null;
  oddsH: number | null;
  oddsD: number | null;
  oddsA: number | null;
  oddsO25: number | null;
  oddsU25: number | null;
  odds1X: number | null;
  oddsX2: number | null;
  ahh: number | null;
}

export interface UpcomingUkFixture {
  fixtureId: string;
  league: string;
  leagueName: string;
  dateIso: string;
  timeUtc: string;
  kickoffUtc: string;
  homeTeam: string;
  awayTeam: string;
  referee: string | null;
  odds: LiveMarketOdds;
}

const memCache = new Map<string, { exp: number; data: any }>();

function getMem<T>(key: string): T | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    memCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setMem<T>(key: string, data: T, ttlSec: number): void {
  memCache.set(key, { exp: Date.now() + ttlSec * 1000, data });
}

// ---------------------------------------------------------------------------
// Normalización y Alias de Nombres (puente football-data.org <-> .co.uk)
// ---------------------------------------------------------------------------

const TEAM_ALIASES: Record<string, string> = {
  "wolverhampton wanderers": "wolves",
  "manchester united": "man united",
  "manchester city": "man city",
  "nottingham forest": "nott m forest",
  "nottm forest": "nott m forest",
  "newcastle united": "newcastle",
  "brighton hove albion": "brighton",
  "brighton and hove albion": "brighton",
  "west ham united": "west ham",
  "tottenham hotspur": "tottenham",
  "leeds united": "leeds",
  "leicester city": "leicester",
  "ipswich town": "ipswich",
  "sheffield united": "sheffield utd",
  "west bromwich albion": "west brom",
  "blackburn rovers": "blackburn",
  "queens park rangers": "qpr",
  "oxford united": "oxford",
  "paris saint germain": "paris sg",
  "olympique lyonnais": "lyon",
  "olympique de marseille": "marseille",
  "stade brestois 29": "brest",
  "stade rennais": "rennes",
  "as monaco": "monaco",
  "lille osc": "lille",
  "rc lens": "lens",
  "ogc nice": "nice",
  "bayern munchen": "bayern munich",
  "borussia dortmund": "dortmund",
  "bayer 04 leverkusen": "leverkusen",
  "rasenballsport leipzig": "rb leipzig",
  "eintracht frankfurt": "ein frankfurt",
  "borussia monchengladbach": "m gladbach",
  "vfb stuttgart": "stuttgart",
  "tsg 1899 hoffenheim": "hoffenheim",
  "1 fsv mainz 05": "mainz",
  "sc freiburg": "freiburg",
  "sv werder bremen": "werder bremen",
  "1 fc koln": "fc koln",
  "1 fc heidenheim 1846": "heidenheim",
  "1 fc union berlin": "union berlin",
  "fc st pauli 1910": "st pauli",
  "internazionale milano": "inter",
  "inter milan": "inter",
  "ac milan": "milan",
  "as roma": "roma",
  "ss lazio": "lazio",
  "ssc napoli": "napoli",
  "atalanta bc": "atalanta",
  "acf fiorentina": "fiorentina",
  "bologna 1909": "bologna",
  "torino": "torino",
  "hellas verona": "verona",
  "como 1907": "como",
  "real madrid": "real madrid",
  "atletico de madrid": "ath madrid",
  "athletic": "ath bilbao",
  "athletic bilbao": "ath bilbao",
  "real betis balompie": "betis",
  "real sociedad de futbol": "sociedad",
  "celta de vigo": "celta",
  "deportivo alaves": "alaves",
  "espanyol de barcelona": "espanol",
  "rcd espanyol": "espanol",
  "rcd mallorca": "mallorca",
  "rayo vallecano": "vallecano",
  "ud las palmas": "las palmas",
  "ca osasuna": "osasuna",
  "girona": "girona",
  "valencia": "valencia",
  "sevilla": "sevilla",
  "villarreal": "villarreal",
  "getafe": "getafe",
  "sporting clube de portugal": "sp lisbon",
  "sport lisboa e benfica": "benfica",
  "porto": "porto",
  "sporting braga": "sp braga",
  "vitoria guimaraes": "guimaraes",
  "psv": "psv eindhoven",
  "az": "az alkmaar",
  "ajax amsterdam": "ajax",
  "feyenoord rotterdam": "feyenoord",
  "twente enschede": "twente",
  "nec": "nijmegen",
};

export function normalizeTeamName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`.&-]/g, " ")
    .replace(/\b(fc|cf|cd|ud|sd|sc|ac|afc|rcd|ca|ssc|as|ss|vfl|vfb|tsg|sv|fsv|club|real|deportivo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_ALIASES[cleaned] || cleaned;
}

function teamsMatch(candidateName: string, targetName: string): boolean {
  const a = normalizeTeamName(candidateName);
  const b = normalizeTeamName(targetName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  const tokA = new Set(a.split(" ").filter((t) => t.length >= 3));
  const tokB = new Set(b.split(" ").filter((t) => t.length >= 3));
  if (tokA.size === 0 || tokB.size === 0) return false;
  let common = 0;
  for (const t of tokA) {
    if (tokB.has(t)) common++;
  }
  return common > 0 && common / Math.max(tokA.size, tokB.size) >= 0.65;
}

// ---------------------------------------------------------------------------
// Parsing CSV & Fechas
// ---------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsvRecords(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    const rec: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      rec[headers[j]] = (vals[j] ?? "").trim();
    }
    rows.push(rec);
  }
  return rows;
}

export function parseUkDate(raw: string): { dateIso: string; dateOrd: number } | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let y = 0, m = 0, d = 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yy, mm, dd] = s.split("-").map(Number);
    y = yy; m = mm; d = dd;
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yy] = s.split("/").map(Number);
    y = yy; m = mm; d = dd;
  } else if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) {
    const [dd, mm, yy] = s.split("/").map(Number);
    y = 2000 + yy; m = mm; d = dd;
  } else {
    return null;
  }
  const ms = Date.UTC(y, m - 1, d);
  const dateIso = new Date(ms).toISOString().slice(0, 10);
  return { dateIso, dateOrd: Math.floor(ms / 86400000) };
}

export function dateIsoToOrd(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function numOrNull(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function oddsOrNull(v: string | undefined): number | null {
  const n = numOrNull(v);
  if (n === null || n <= 1.01 || n > 200) return null;
  return n;
}

function pickFirstOdds(row: Record<string, string>, keys: string[]): number | null {
  for (const k of keys) {
    const val = oddsOrNull(row[k]);
    if (val !== null) return val;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Descarga de Historial por Liga (Temporadas 25/26 y 26/27)
// ---------------------------------------------------------------------------

async function fetchSeasonCsv(season: string, divCode: string): Promise<HistoricalMatchRow[]> {
  const key = `fduk:season:v1:${season}:${divCode}`;
  const mem = getMem<HistoricalMatchRow[]>(key);
  if (mem) return mem;

  const dbCached = await getCachedData<HistoricalMatchRow[]>(key);
  if (dbCached && dbCached.length > 0) {
    setMem(key, dbCached, season === "2627" ? 3600 : 86400);
    return dbCached;
  }

  const url = `https://www.football-data.co.uk/mmz4281/${season}/${divCode}.csv`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (SPFIA Quant Engine)" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn(`Timeout o error descargando ${season}/${divCode}.csv:`, err);
    return [];
  }
  if (!res.ok) return [];

  const text = await res.text();
  const rawRows = parseCsvRecords(text);
  const parsed: HistoricalMatchRow[] = [];

  for (const r of rawRows) {
    const dt = parseUkDate(r.Date);
    const homeTeam = r.HomeTeam;
    const awayTeam = r.AwayTeam;
    const fthg = numOrNull(r.FTHG);
    const ftag = numOrNull(r.FTAG);
    if (!dt || !homeTeam || !awayTeam || fthg === null || ftag === null) continue;

    parsed.push({
      league: divCode,
      season,
      dateIso: dt.dateIso,
      dateOrd: dt.dateOrd,
      homeTeam,
      awayTeam,
      fthg: Math.round(fthg),
      ftag: Math.round(ftag),
      hc: numOrNull(r.HC),
      ac: numOrNull(r.AC),
      hs: numOrNull(r.HS),
      as: numOrNull(r.AS),
      hst: numOrNull(r.HST),
      ast: numOrNull(r.AST),
    });
  }

  const ttl = season === "2627" ? 4 * 3600 : 7 * 86400;
  setMem(key, parsed, ttl);
  void setCachedData(key, parsed, ttl).catch(() => {});
  return parsed;
}

export async function fetchLeagueHistory(divCode: string): Promise<HistoricalMatchRow[]> {
  const code = resolveUkLeagueCode(divCode);
  const [s2526, s2627] = await Promise.all([
    fetchSeasonCsv("2526", code),
    fetchSeasonCsv("2627", code),
  ]);
  return [...s2526, ...s2627].sort((a, b) => a.dateOrd - b.dateOrd);
}

// ---------------------------------------------------------------------------
// Descarga de Próximos Partidos y Cuotas Reales (fixtures.csv)
// ---------------------------------------------------------------------------

export function extractMarketOddsFromRow(r: Record<string, string>): LiveMarketOdds {
  const shH = pickFirstOdds(r, ["BFEH", "AvgH", "PSH", "B365H"]);
  const shD = pickFirstOdds(r, ["BFED", "AvgD", "PSD", "B365D"]);
  const shA = pickFirstOdds(r, ["BFEA", "AvgA", "PSA", "B365A"]);

  let pMktH: number | null = null;
  let pMktD: number | null = null;
  let pMktA: number | null = null;
  if (shH && shD && shA) {
    [pMktH, pMktD, pMktA] = devigThreeWay(shH, shD, shA);
  }

  const shO25 = pickFirstOdds(r, ["BFE>2.5", "Avg>2.5", "P>2.5", "B365>2.5"]);
  const shU25 = pickFirstOdds(r, ["BFE<2.5", "Avg<2.5", "P<2.5", "B365<2.5"]);
  let pMktO25: number | null = null;
  if (shO25 && shU25) {
    [pMktO25] = devigTwoWay(shO25, shU25);
  }

  const bkH = pickFirstOdds(r, ["B365H", "AvgH", "BFEH"]);
  const bkD = pickFirstOdds(r, ["B365D", "AvgD", "BFED"]);
  const bkA = pickFirstOdds(r, ["B365A", "AvgA", "BFEA"]);
  const bkO25 = pickFirstOdds(r, ["B365>2.5", "Avg>2.5", "BFE>2.5"]);
  const bkU25 = pickFirstOdds(r, ["B365<2.5", "Avg<2.5", "BFE<2.5"]);

  const odds1X = bkH && bkD ? Number(dutchDoubleChanceOdds(bkH, bkD).toFixed(2)) : null;
  const oddsX2 = bkD && bkA ? Number(dutchDoubleChanceOdds(bkD, bkA).toFixed(2)) : null;

  return {
    hasMarketOdds: pMktO25 !== null && pMktH !== null && pMktD !== null && pMktA !== null,
    pMktH,
    pMktD,
    pMktA,
    pMktO25,
    oddsH: bkH,
    oddsD: bkD,
    oddsA: bkA,
    oddsO25: bkO25,
    oddsU25: bkU25,
    odds1X,
    oddsX2,
    ahh: numOrNull(r.AHh),
  };
}

export async function fetchUpcomingFixtures(): Promise<UpcomingUkFixture[]> {
  const key = "fduk:fixtures:v1";
  const mem = getMem<UpcomingUkFixture[]>(key);
  if (mem) return mem;

  const dbCached = await getCachedData<UpcomingUkFixture[]>(key);
  if (dbCached) {
    setMem(key, dbCached, 900);
    return dbCached;
  }

  try {
    const res = await fetch("https://www.football-data.co.uk/fixtures.csv", {
      headers: { "User-Agent": "Mozilla/5.0 (SPFIA Quant Engine)" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const text = await res.text();
    const rawRows = parseCsvRecords(text);
    const out: UpcomingUkFixture[] = [];

    for (const r of rawRows) {
      const div = (r.Div || "").toUpperCase();
      const lgInfo = VERIFIED_LEAGUES_MAP[div];
      if (!lgInfo) continue;

      const dt = parseUkDate(r.Date);
      const homeTeam = r.HomeTeam;
      const awayTeam = r.AwayTeam;
      if (!dt || !homeTeam || !awayTeam) continue;

      const timeStr = /^\d{2}:\d{2}$/.test(r.Time || "") ? r.Time : "15:00";
      const kickoffUtc = `${dt.dateIso}T${timeStr}:00Z`;
      const slugH = normalizeTeamName(homeTeam).replace(/\s+/g, "-");
      const slugA = normalizeTeamName(awayTeam).replace(/\s+/g, "-");
      const fixtureId = `uk:${div}:${dt.dateIso}:${slugH}:${slugA}`;

      out.push({
        fixtureId,
        league: div,
        leagueName: lgInfo.name,
        dateIso: dt.dateIso,
        timeUtc: timeStr,
        kickoffUtc,
        homeTeam,
        awayTeam,
        referee: r.Referee || null,
        odds: extractMarketOddsFromRow(r),
      });
    }

    setMem(key, out, 900); // 15 min cache
    void setCachedData(key, out, 900).catch(() => {});
    return out;
  } catch (err) {
    console.error("Error leyendo fixtures.csv de football-data.co.uk:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cálculo Exacto de Snapshot por Equipo (Time-Decay + Shrinkage Bayesiano)
// ---------------------------------------------------------------------------

export interface TeamWindowStats {
  matchesCount: number;
  effectiveWeight: number;
  goalsFor: number;
  goalsAgainst: number;
  cornersFor: number;
  cornersAgainst: number;
  shotsFor: number;
  shotsAgainst: number;
  sotFor: number;
  sotAgainst: number;
}

function computeDecayedTeamStats(
  records: HistoricalMatchRow[],
  isHome: boolean,
  asOfOrd: number,
  lg: LeagueParams,
  xi: number,
  kPrior: number
): TeamWindowStats {
  const fields = isHome
    ? {
        priorGf: lg.avgHomeGoals,
        priorGa: lg.avgAwayGoals,
        priorCf: lg.avgHomeCorners,
        priorCa: lg.avgAwayCorners,
        priorSf: lg.avgHomeShots,
        priorSa: lg.avgAwayShots,
        priorSotf: lg.avgHomeSot,
        priorSota: lg.avgAwaySot,
      }
    : {
        priorGf: lg.avgAwayGoals,
        priorGa: lg.avgHomeGoals,
        priorCf: lg.avgAwayCorners,
        priorCa: lg.avgHomeCorners,
        priorSf: lg.avgAwayShots,
        priorSa: lg.avgHomeShots,
        priorSotf: lg.avgAwaySot,
        priorSota: lg.avgHomeSot,
      };

  let wG = 0, wGf = 0, wGa = 0;
  let wC = 0, wCf = 0, wCa = 0;
  let wS = 0, wSf = 0, wSa = 0;
  let wSot = 0, wSotf = 0, wSota = 0;

  for (const r of records) {
    const daysAgo = Math.max(1, asOfOrd - r.dateOrd);
    const w = Math.exp(-xi * daysAgo);

    const gf = isHome ? r.fthg : r.ftag;
    const ga = isHome ? r.ftag : r.fthg;
    wG += w;
    wGf += w * gf;
    wGa += w * ga;

    const cf = isHome ? r.hc : r.ac;
    const ca = isHome ? r.ac : r.hc;
    if (cf !== null && ca !== null) {
      wC += w;
      wCf += w * cf;
      wCa += w * ca;
    }

    const sf = isHome ? r.hs : r.as;
    const sa = isHome ? r.as : r.hs;
    if (sf !== null && sa !== null) {
      wS += w;
      wSf += w * sf;
      wSa += w * sa;
    }

    const sotf = isHome ? r.hst : r.ast;
    const sota = isHome ? r.ast : r.hst;
    if (sotf !== null && sota !== null) {
      wSot += w;
      wSotf += w * sotf;
      wSota += w * sota;
    }
  }

  return {
    matchesCount: records.length,
    effectiveWeight: Number(wG.toFixed(3)),
    goalsFor: (kPrior * fields.priorGf + wGf) / (kPrior + wG),
    goalsAgainst: (kPrior * fields.priorGa + wGa) / (kPrior + wG),
    cornersFor: (kPrior * fields.priorCf + wCf) / (kPrior + wC),
    cornersAgainst: (kPrior * fields.priorCa + wCa) / (kPrior + wC),
    shotsFor: (kPrior * fields.priorSf + wSf) / (kPrior + wS),
    shotsAgainst: (kPrior * fields.priorSa + wSa) / (kPrior + wS),
    sotFor: (kPrior * fields.priorSotf + wSotf) / (kPrior + wSot),
    sotAgainst: (kPrior * fields.priorSota + wSota) / (kPrior + wSot),
  };
}

export function computeTeamSnapshotAsOf(
  historyRows: HistoricalMatchRow[],
  homeTeam: string,
  awayTeam: string,
  asOfDateIso: string,
  leagueParams: LeagueParams
): { home: TeamWindowStats; away: TeamWindowStats } {
  const asOfOrd = dateIsoToOrd(asOfDateIso);
  const xi = CALIBRATED_MODEL.xi;
  const kPrior = CALIBRATED_MODEL.kPrior;

  const hRecs = historyRows.filter(
    (r) => r.dateIso < asOfDateIso && teamsMatch(r.homeTeam, homeTeam)
  );
  const aRecs = historyRows.filter(
    (r) => r.dateIso < asOfDateIso && teamsMatch(r.awayTeam, awayTeam)
  );

  return {
    home: computeDecayedTeamStats(hRecs, true, asOfOrd, leagueParams, xi, kPrior),
    away: computeDecayedTeamStats(aRecs, false, asOfOrd, leagueParams, xi, kPrior),
  };
}

export function findFinishedUkMatch(
  historyRows: HistoricalMatchRow[],
  dateIso: string,
  homeTeam: string,
  awayTeam: string
): HistoricalMatchRow | undefined {
  return historyRows.find(
    (r) =>
      r.dateIso === dateIso &&
      teamsMatch(r.homeTeam, homeTeam) &&
      teamsMatch(r.awayTeam, awayTeam)
  );
}
