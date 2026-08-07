"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_FOOTBALL_LEAGUE_IDS = void 0;
exports.normTeamName = normTeamName;
exports.fetchApiFootballStandings = fetchApiFootballStandings;
exports.getDefaultCornerStatsForLeague = getDefaultCornerStatsForLeague;
exports.fetchMatchesFromApiFootball = fetchMatchesFromApiFootball;
exports.fetchLineupsForMatch = fetchLineupsForMatch;
var persistentCache_1 = require("../cache/persistentCache");
var footballData_1 = require("./footballData");
var API_KEY = process.env.API_FOOTBALL_DATA_TOKEN || "f10f4374d9c89e9218f7e716912251af";
var BASE_URL = "https://v3.football.api-sports.io";
exports.API_FOOTBALL_LEAGUE_IDS = {
    PD: 140, // LaLiga Primera España
    SD: 141, // LaLiga Segunda Hypermotion España
    PL: 39, // Premier League Inglaterra
    ELC: 40, // Championship Inglaterra
    FL1: 61, // Ligue 1 Francia
    SA: 135, // Serie A Italia
    BL1: 78, // Bundesliga Alemania
    BSA: 71, // Brasileirao Serie A Brasil
    LPF: 128, // Liga Profesional Primera División Argentina
    PPL: 94, // Primeira Liga Portugal
    DED: 91, // Eredivisie Países Bajos
};
var LEAGUE_CORNER_BASELINES = {
    PL: { avgHome: 5.6, avgAway: 4.8 },
    PD: { avgHome: 5.1, avgAway: 4.5 },
    SD: { avgHome: 5.3, avgAway: 4.5 },
    BL1: { avgHome: 5.4, avgAway: 4.7 },
    SA: { avgHome: 5.2, avgAway: 4.6 },
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
function normTeamName(name) {
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
function fetchApiFootballStandings(leagueCode) {
    return __awaiter(this, void 0, void 0, function () {
        var leagueId, cacheKey, cached, seasonsToTry, _i, seasonsToTry_1, season, url, res, data, standingsList, result, _a, standingsList_1, row, teamId, teamName, normName, played, goalsFor, goalsAgainst, homePlayed, homeGoalsFor, homeGoalsAgainst, awayPlayed, awayGoalsFor, awayGoalsAgainst, stats, err_1;
        var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
        return __generator(this, function (_y) {
            switch (_y.label) {
                case 0:
                    leagueId = exports.API_FOOTBALL_LEAGUE_IDS[leagueCode];
                    if (!leagueId || !API_KEY)
                        return [2 /*return*/, {}];
                    cacheKey = "apif:standings:v3:".concat(leagueCode, ":").concat(leagueId);
                    return [4 /*yield*/, (0, persistentCache_1.getCachedData)(cacheKey)];
                case 1:
                    cached = _y.sent();
                    if (cached)
                        return [2 /*return*/, cached];
                    seasonsToTry = [2024, 2023, 2022];
                    _i = 0, seasonsToTry_1 = seasonsToTry;
                    _y.label = 2;
                case 2:
                    if (!(_i < seasonsToTry_1.length)) return [3 /*break*/, 9];
                    season = seasonsToTry_1[_i];
                    _y.label = 3;
                case 3:
                    _y.trys.push([3, 7, , 8]);
                    url = "".concat(BASE_URL, "/standings?league=").concat(leagueId, "&season=").concat(season);
                    return [4 /*yield*/, fetch(url, { headers: getHeaders(), cache: "no-store" })];
                case 4:
                    res = _y.sent();
                    if (!res.ok)
                        return [3 /*break*/, 8];
                    return [4 /*yield*/, res.json()];
                case 5:
                    data = _y.sent();
                    if (data.errors && Object.keys(data.errors).length > 0)
                        return [3 /*break*/, 8];
                    standingsList = ((_e = (_d = (_c = (_b = data.response) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.league) === null || _d === void 0 ? void 0 : _d.standings) === null || _e === void 0 ? void 0 : _e[0]) || [];
                    if (standingsList.length === 0)
                        return [3 /*break*/, 8];
                    result = {};
                    for (_a = 0, standingsList_1 = standingsList; _a < standingsList_1.length; _a++) {
                        row = standingsList_1[_a];
                        teamId = (_f = row.team) === null || _f === void 0 ? void 0 : _f.id;
                        teamName = ((_g = row.team) === null || _g === void 0 ? void 0 : _g.name) || "";
                        normName = normTeamName(teamName);
                        played = Math.max(1, ((_h = row.all) === null || _h === void 0 ? void 0 : _h.played) || 1);
                        goalsFor = ((_k = (_j = row.all) === null || _j === void 0 ? void 0 : _j.goals) === null || _k === void 0 ? void 0 : _k.for) || 0;
                        goalsAgainst = ((_m = (_l = row.all) === null || _l === void 0 ? void 0 : _l.goals) === null || _m === void 0 ? void 0 : _m.against) || 0;
                        homePlayed = Math.max(1, ((_o = row.home) === null || _o === void 0 ? void 0 : _o.played) || 1);
                        homeGoalsFor = ((_q = (_p = row.home) === null || _p === void 0 ? void 0 : _p.goals) === null || _q === void 0 ? void 0 : _q.for) || 0;
                        homeGoalsAgainst = ((_s = (_r = row.home) === null || _r === void 0 ? void 0 : _r.goals) === null || _s === void 0 ? void 0 : _s.against) || 0;
                        awayPlayed = Math.max(1, ((_t = row.away) === null || _t === void 0 ? void 0 : _t.played) || 1);
                        awayGoalsFor = ((_v = (_u = row.away) === null || _u === void 0 ? void 0 : _u.goals) === null || _v === void 0 ? void 0 : _v.for) || 0;
                        awayGoalsAgainst = ((_x = (_w = row.away) === null || _w === void 0 ? void 0 : _w.goals) === null || _x === void 0 ? void 0 : _x.against) || 0;
                        stats = {
                            teamId: teamId,
                            teamName: teamName,
                            played: played,
                            goalsForPerGame: goalsFor / played,
                            goalsAgainstPerGame: goalsAgainst / played,
                            homePlayed: homePlayed,
                            homeGoalsForPerGame: homeGoalsFor / homePlayed,
                            homeGoalsAgainstPerGame: homeGoalsAgainst / homePlayed,
                            awayPlayed: awayPlayed,
                            awayGoalsForPerGame: awayGoalsFor / awayPlayed,
                            awayGoalsAgainstPerGame: awayGoalsAgainst / awayPlayed,
                        };
                        // Guardar por ID numérico y por nombre normalizado para garantizar matching 100%
                        result[String(teamId)] = stats;
                        result[normName] = stats;
                    }
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, result, 86400)];
                case 6:
                    _y.sent(); // Caché 24 horas
                    return [2 /*return*/, result];
                case 7:
                    err_1 = _y.sent();
                    console.error("Error obteniendo clasificaciones para ".concat(leagueCode, ":"), err_1);
                    return [3 /*break*/, 8];
                case 8:
                    _i++;
                    return [3 /*break*/, 2];
                case 9: return [2 /*return*/, {}];
            }
        });
    });
}
/**
 * Obtiene promedios de córneres por liga (baseline usado si las stats por equipo no están disponibles).
 */
function getDefaultCornerStatsForLeague(leagueCode) {
    var baseline = LEAGUE_CORNER_BASELINES[leagueCode];
    return baseline
        ? { avgCornersHome: baseline.avgHome, avgCornersAway: baseline.avgAway }
        : { avgCornersHome: 5.2, avgCornersAway: 4.5 };
}
/**
 * Consulta de partidos desde API-Football (api-sports.io).
 * Aplica Ventana de Tiempo por Jornada Local.
 */
function fetchMatchesFromApiFootball(dateStr, leagueCode) {
    return __awaiter(this, void 0, void 0, function () {
        var cacheKey, cached, targetLeagueId, leagueInfo, targetCode, currDateObj, nextDateObj, nextDateStr, windowStart, windowEnd, _a, resCurr, resNext, responseList, dCurr, dNext, matchesMap, _i, responseList_1, item, fLeague, fLeagueId, fName, fCountry, fDate, fixtureTime, isMatch, isExcluded, matches, err_2;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    cacheKey = "apif:v4:matchday:".concat(dateStr, ":").concat(leagueCode);
                    return [4 /*yield*/, (0, persistentCache_1.getCachedData)(cacheKey)];
                case 1:
                    cached = _d.sent();
                    if (cached)
                        return [2 /*return*/, cached];
                    if (!API_KEY)
                        return [2 /*return*/, []];
                    targetLeagueId = exports.API_FOOTBALL_LEAGUE_IDS[leagueCode];
                    leagueInfo = footballData_1.SUPPORTED_LEAGUES[leagueCode];
                    targetCode = leagueCode.toUpperCase();
                    currDateObj = new Date(dateStr + "T00:00:00Z");
                    nextDateObj = new Date(currDateObj.getTime() + 86400000);
                    nextDateStr = nextDateObj.toISOString().split("T")[0];
                    windowStart = new Date(dateStr + "T05:00:00Z").getTime();
                    windowEnd = new Date(nextDateStr + "T04:59:59Z").getTime();
                    _d.label = 2;
                case 2:
                    _d.trys.push([2, 9, , 10]);
                    return [4 /*yield*/, Promise.all([
                            fetch("".concat(BASE_URL, "/fixtures?date=").concat(dateStr), { headers: getHeaders(), cache: "no-store" }),
                            fetch("".concat(BASE_URL, "/fixtures?date=").concat(nextDateStr), { headers: getHeaders(), cache: "no-store" }),
                        ])];
                case 3:
                    _a = _d.sent(), resCurr = _a[0], resNext = _a[1];
                    responseList = [];
                    if (!resCurr.ok) return [3 /*break*/, 5];
                    return [4 /*yield*/, resCurr.json()];
                case 4:
                    dCurr = _d.sent();
                    responseList = responseList.concat(dCurr.response || []);
                    _d.label = 5;
                case 5:
                    if (!resNext.ok) return [3 /*break*/, 7];
                    return [4 /*yield*/, resNext.json()];
                case 6:
                    dNext = _d.sent();
                    responseList = responseList.concat(dNext.response || []);
                    _d.label = 7;
                case 7:
                    matchesMap = new Map();
                    for (_i = 0, responseList_1 = responseList; _i < responseList_1.length; _i++) {
                        item = responseList_1[_i];
                        fLeague = item.league || {};
                        fLeagueId = fLeague.id;
                        fName = (fLeague.name || "").toLowerCase();
                        fCountry = (fLeague.country || "").toLowerCase();
                        fDate = ((_b = item.fixture) === null || _b === void 0 ? void 0 : _b.date) || "";
                        if (fName.includes("reserve") || fName.includes("u20") || fName.includes("u21") || fName.includes("u19"))
                            continue;
                        fixtureTime = new Date(fDate).getTime();
                        if (fixtureTime < windowStart || fixtureTime > windowEnd)
                            continue;
                        isMatch = false;
                        if (fLeagueId && targetLeagueId) {
                            // Validación estricta por ID oficial de liga (ej. 128 para LPF Liga Profesional Argentina)
                            isMatch = fLeagueId === targetLeagueId;
                        }
                        else if (!fLeagueId && targetCode === "LPF" && fCountry === "argentina") {
                            isExcluded = fName.includes("primera b") ||
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
                        }
                        else if (!fLeagueId) {
                            if (targetCode === "SD" && fCountry === "spain" && (fName.includes("segunda") || fName.includes("hypermotion")))
                                isMatch = true;
                            else if (targetCode === "PD" && fCountry === "spain" && (fName.includes("primera") || fName.includes("la liga")))
                                isMatch = true;
                            else if (targetCode === "PL" && fCountry === "england" && fName.includes("premier"))
                                isMatch = true;
                            else if (targetCode === "ELC" && fCountry === "england" && fName.includes("championship"))
                                isMatch = true;
                            else if (targetCode === "FL1" && fCountry === "france" && fName.includes("ligue 1"))
                                isMatch = true;
                            else if (targetCode === "SA" && fCountry === "italy" && fName.includes("serie a"))
                                isMatch = true;
                            else if (targetCode === "BL1" && fCountry === "germany" && fName.includes("bundesliga"))
                                isMatch = true;
                            else if (targetCode === "BSA" && fCountry === "brazil" && fName.includes("serie a"))
                                isMatch = true;
                        }
                        if (isMatch && !matchesMap.has(item.fixture.id)) {
                            matchesMap.set(item.fixture.id, {
                                id: item.fixture.id,
                                utcDate: item.fixture.date,
                                status: ((_c = item.fixture.status) === null || _c === void 0 ? void 0 : _c.short) || "NS",
                                matchday: fLeague.round ? parseInt(fLeague.round.replace(/\D/g, "") || "1", 10) : 1,
                                leagueCode: leagueCode,
                                leagueName: (leagueInfo === null || leagueInfo === void 0 ? void 0 : leagueInfo.name) || fLeague.name,
                                homeTeam: { id: item.teams.home.id, name: item.teams.home.name },
                                awayTeam: { id: item.teams.away.id, name: item.teams.away.name },
                                score: {
                                    fullTime: { home: item.goals.home, away: item.goals.away },
                                },
                            });
                        }
                    }
                    matches = Array.from(matchesMap.values());
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, matches, 21600)];
                case 8:
                    _d.sent();
                    return [2 /*return*/, matches];
                case 9:
                    err_2 = _d.sent();
                    console.error("Error en API-Football para ".concat(leagueCode, ":"), err_2);
                    return [2 /*return*/, []];
                case 10: return [2 /*return*/];
            }
        });
    });
}
/**
 * Consulta alineaciones pre-partido.
 */
function fetchLineupsForMatch(dateStr, homeTeam, awayTeam) {
    return __awaiter(this, void 0, void 0, function () {
        var normHome, normAway, cacheKey, cached, searchUrl, resSearch, searchData, fixtures, matchedFixture, fallback, fixtureId, fallback, lineupsUrl, resLineups, fallback, lineupsData, lineupList, homeXi, awayXi, status_1, confidence, result, err_3;
        var _a, _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    normHome = normTeamName(homeTeam);
                    normAway = normTeamName(awayTeam);
                    cacheKey = "apif:lineups:".concat(dateStr, ":").concat(normHome, ":").concat(normAway);
                    return [4 /*yield*/, (0, persistentCache_1.getCachedData)(cacheKey)];
                case 1:
                    cached = _f.sent();
                    if (cached)
                        return [2 /*return*/, cached];
                    if (!API_KEY) {
                        return [2 /*return*/, { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 }];
                    }
                    _f.label = 2;
                case 2:
                    _f.trys.push([2, 14, , 15]);
                    searchUrl = "".concat(BASE_URL, "/fixtures?date=").concat(dateStr, "&search=").concat(encodeURIComponent(homeTeam.split(" ")[0]));
                    return [4 /*yield*/, fetch(searchUrl, { headers: getHeaders(), cache: "no-store" })];
                case 3:
                    resSearch = _f.sent();
                    if (!resSearch.ok)
                        return [2 /*return*/, { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 }];
                    return [4 /*yield*/, resSearch.json()];
                case 4:
                    searchData = _f.sent();
                    fixtures = searchData.response || [];
                    matchedFixture = fixtures.find(function (f) {
                        var _a, _b, _c, _d;
                        var fHome = normTeamName(((_b = (_a = f.teams) === null || _a === void 0 ? void 0 : _a.home) === null || _b === void 0 ? void 0 : _b.name) || "");
                        var fAway = normTeamName(((_d = (_c = f.teams) === null || _c === void 0 ? void 0 : _c.away) === null || _d === void 0 ? void 0 : _d.name) || "");
                        return fHome.includes(normHome) || normHome.includes(fHome) || fAway.includes(normAway);
                    });
                    if (!!matchedFixture) return [3 /*break*/, 6];
                    fallback = { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, fallback, 3600)];
                case 5:
                    _f.sent();
                    return [2 /*return*/, fallback];
                case 6:
                    fixtureId = (_a = matchedFixture.fixture) === null || _a === void 0 ? void 0 : _a.id;
                    if (!!fixtureId) return [3 /*break*/, 8];
                    fallback = { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, fallback, 3600)];
                case 7:
                    _f.sent();
                    return [2 /*return*/, fallback];
                case 8:
                    lineupsUrl = "".concat(BASE_URL, "/fixtures/lineups?fixture=").concat(fixtureId);
                    return [4 /*yield*/, fetch(lineupsUrl, { headers: getHeaders(), cache: "no-store" })];
                case 9:
                    resLineups = _f.sent();
                    if (!!resLineups.ok) return [3 /*break*/, 11];
                    fallback = { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 };
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, fallback, 3600)];
                case 10:
                    _f.sent();
                    return [2 /*return*/, fallback];
                case 11: return [4 /*yield*/, resLineups.json()];
                case 12:
                    lineupsData = _f.sent();
                    lineupList = lineupsData.response || [];
                    homeXi = 0;
                    awayXi = 0;
                    if (lineupList.length >= 2) {
                        homeXi = ((_c = (_b = lineupList[0]) === null || _b === void 0 ? void 0 : _b.startXI) === null || _c === void 0 ? void 0 : _c.length) || 0;
                        awayXi = ((_e = (_d = lineupList[1]) === null || _d === void 0 ? void 0 : _d.startXI) === null || _e === void 0 ? void 0 : _e.length) || 0;
                    }
                    status_1 = "NOT_AVAILABLE";
                    confidence = 0.92;
                    if (homeXi === 11 && awayXi === 11) {
                        status_1 = "CONFIRMED";
                        confidence = 1.0;
                    }
                    else if (homeXi > 0 || awayXi > 0) {
                        status_1 = "AVAILABLE_PARTIAL";
                        confidence = 0.96;
                    }
                    result = { status: status_1, confidence: confidence, homeStartXiCount: homeXi, awayStartXiCount: awayXi };
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, result, status_1 === "CONFIRMED" ? 86400 : 900)];
                case 13:
                    _f.sent();
                    return [2 /*return*/, result];
                case 14:
                    err_3 = _f.sent();
                    console.error("Error consultando alineaciones en API-Football:", err_3);
                    return [2 /*return*/, { status: "NOT_AVAILABLE", confidence: 0.92, homeStartXiCount: 0, awayStartXiCount: 0 }];
                case 15: return [2 /*return*/];
            }
        });
    });
}
