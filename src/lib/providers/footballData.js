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
exports.SUPPORTED_LEAGUES = void 0;
exports.fetchMatchesForDateAndLeague = fetchMatchesForDateAndLeague;
exports.fetchStandingsRates = fetchStandingsRates;
var persistentCache_1 = require("../cache/persistentCache");
var apiFootball_1 = require("./apiFootball");
exports.SUPPORTED_LEAGUES = {
    PD: { code: "PD", name: "LaLiga Primera", country: "España" },
    SD: { code: "SD", name: "LaLiga Segunda Hypermotion", country: "España" },
    PL: { code: "PL", name: "Premier League", country: "Inglaterra" },
    ELC: { code: "ELC", name: "Championship", country: "Inglaterra" },
    FL1: { code: "FL1", name: "Ligue 1", country: "Francia" },
    SA: { code: "SA", name: "Serie A", country: "Italia" },
    BL1: { code: "BL1", name: "Bundesliga", country: "Alemania" },
    BSA: { code: "BSA", name: "Brasileirao Serie A", country: "Brasil" },
    LPF: { code: "LPF", name: "Liga Profesional Argentina", country: "Argentina" },
    PPL: { code: "PPL", name: "Primeira Liga", country: "Portugal" },
    DED: { code: "DED", name: "Eredivisie", country: "Países Bajos" },
};
var BASE_URL = "https://api.football-data.org/v4";
function getHeaders() {
    var token = process.env.FOOTBALL_DATA_TOKEN || "946f807431bf460f868d279d49cfddd0";
    return {
        "X-Auth-Token": token,
        "Accept": "application/json",
    };
}
/**
 * Obtiene los partidos programados para una fecha específica e inspeccionada estrictamente por liga.
 * Aplica filtro de fecha exacto YYYY-MM-DD y fallback directo hacia API-Football (api-sports.io).
 */
function fetchMatchesForDateAndLeague(dateStr, leagueCode) {
    return __awaiter(this, void 0, void 0, function () {
        var cacheKey, cached, url, res, data, rawMatches, validMatches, matches, err_1, fallbackMatches;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    cacheKey = "fd:matches:v2:".concat(dateStr, ":").concat(leagueCode);
                    return [4 /*yield*/, (0, persistentCache_1.getCachedData)(cacheKey)];
                case 1:
                    cached = _a.sent();
                    if (cached)
                        return [2 /*return*/, cached];
                    url = "".concat(BASE_URL, "/competitions/").concat(leagueCode, "/matches?dateFrom=").concat(dateStr, "&dateTo=").concat(dateStr);
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 7, , 8]);
                    return [4 /*yield*/, fetch(url, { headers: getHeaders(), cache: "no-store" })];
                case 3:
                    res = _a.sent();
                    if (!res.ok) return [3 /*break*/, 6];
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _a.sent();
                    rawMatches = data.matches || [];
                    validMatches = rawMatches.filter(function (m) {
                        var mDate = (m.utcDate || "").slice(0, 10);
                        return mDate === dateStr;
                    });
                    if (!(validMatches.length > 0)) return [3 /*break*/, 6];
                    matches = validMatches.map(function (m) {
                        var _a;
                        return ({
                            id: m.id,
                            utcDate: m.utcDate,
                            status: m.status,
                            matchday: m.matchday,
                            leagueCode: leagueCode,
                            leagueName: ((_a = exports.SUPPORTED_LEAGUES[leagueCode]) === null || _a === void 0 ? void 0 : _a.name) || leagueCode,
                            homeTeam: { id: m.homeTeam.id, name: m.homeTeam.name, shortName: m.homeTeam.shortName },
                            awayTeam: { id: m.awayTeam.id, name: m.awayTeam.name, shortName: m.awayTeam.shortName },
                            score: m.score,
                        });
                    });
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, matches, 43200)];
                case 5:
                    _a.sent();
                    return [2 /*return*/, matches];
                case 6: return [3 /*break*/, 8];
                case 7:
                    err_1 = _a.sent();
                    console.warn("football-data.org fall\u00F3 o restre\u00F1ido para ".concat(leagueCode, ", activando fallback API-Football..."));
                    return [3 /*break*/, 8];
                case 8: return [4 /*yield*/, (0, apiFootball_1.fetchMatchesFromApiFootball)(dateStr, leagueCode)];
                case 9:
                    fallbackMatches = _a.sent();
                    if (!(fallbackMatches.length > 0)) return [3 /*break*/, 11];
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, fallbackMatches, 21600)];
                case 10:
                    _a.sent();
                    _a.label = 11;
                case 11: return [2 /*return*/, fallbackMatches];
            }
        });
    });
}
/**
 * Obtiene la tabla de posiciones y promedios de goles para la competición.
 */
function fetchStandingsRates(leagueCode) {
    return __awaiter(this, void 0, void 0, function () {
        var cacheKey, cached, url, res, data, result, standings, totalTable, _i, _a, row, teamId, played, gf, ga, err_2;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    cacheKey = "fd:standings:".concat(leagueCode);
                    return [4 /*yield*/, (0, persistentCache_1.getCachedData)(cacheKey)];
                case 1:
                    cached = _b.sent();
                    if (cached)
                        return [2 /*return*/, cached];
                    url = "".concat(BASE_URL, "/competitions/").concat(leagueCode, "/standings");
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 6, , 7]);
                    return [4 /*yield*/, fetch(url, { headers: getHeaders(), cache: "no-store" })];
                case 3:
                    res = _b.sent();
                    if (!res.ok)
                        return [2 /*return*/, {}];
                    return [4 /*yield*/, res.json()];
                case 4:
                    data = _b.sent();
                    result = {};
                    standings = data.standings || [];
                    totalTable = standings.find(function (s) { return s.type === "TOTAL"; }) || standings[0];
                    if (totalTable && totalTable.table) {
                        for (_i = 0, _a = totalTable.table; _i < _a.length; _i++) {
                            row = _a[_i];
                            teamId = row.team.id;
                            played = Math.max(1, row.playedGames || 1);
                            gf = row.goalsFor || 0;
                            ga = row.goalsAgainst || 0;
                            result[teamId] = {
                                teamId: teamId,
                                teamName: row.team.name,
                                goalsForPerGame: gf / played,
                                goalsAgainstPerGame: ga / played,
                            };
                        }
                    }
                    // Cache por 24 horas para standings
                    return [4 /*yield*/, (0, persistentCache_1.setCachedData)(cacheKey, result, 86400)];
                case 5:
                    // Cache por 24 horas para standings
                    _b.sent();
                    return [2 /*return*/, result];
                case 6:
                    err_2 = _b.sent();
                    console.error("Error fetching standings para ".concat(leagueCode, ":"), err_2);
                    return [2 /*return*/, {}];
                case 7: return [2 /*return*/];
            }
        });
    });
}
