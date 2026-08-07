"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.analyzeLeagueForDate = analyzeLeagueForDate;
var poisson_1 = require("./math/poisson");
var footballData_1 = require("./providers/footballData");
var apiFootball_1 = require("./providers/apiFootball");
var prisma_1 = require("./prisma");
/**
 * Calculo del margen de seguridad para el límite inferior (P_lower).
 */
function calculateLowerBound(p, stabilityFactor, lineupConfidence) {
    var margin = 0.01;
    margin += 0.06 * (1.0 - Math.min(1.0, Math.max(0.0, stabilityFactor)));
    margin += 0.06 * (1.0 - Math.min(1.0, Math.max(0.0, lineupConfidence)));
    margin = Math.min(0.12, Math.max(0.0, margin));
    var pLower = Math.min(1.0, Math.max(0.0, p - margin));
    return { pLower: pLower, margin: margin };
}
/**
 * Calcula la estabilidad estadística real (100% dinámica e independiente por partido)
 * basada en tamaño de muestra efectivo, consistencia de gol/córner, origen de datos y alineaciones.
 */
function calculateDynamicStability(homePlayed, awayPlayed, homeSource, awaySource, lambda1, lambda2, lineupConfidence, marketType) {
    // 1. Asintótica continua de tamaño de muestra (Media armónica de partidos jugados)
    var effPlayed = (2 * homePlayed * awayPlayed) / Math.max(1, homePlayed + awayPlayed);
    var sampleConfidence = 0.58 + 0.33 * (1 - Math.exp(-effPlayed / 11.0)); // Crece suavemente de 0.60 a 0.91
    // 2. Calidad de la fuente de datos (Real API vs Fallback)
    var sourceQuality = 0;
    if (homeSource.includes("API-Football") || homeSource.includes("football-data"))
        sourceQuality += 0.025;
    if (awaySource.includes("API-Football") || awaySource.includes("football-data"))
        sourceQuality += 0.025;
    if (homeSource.includes("FALLBACK"))
        sourceQuality -= 0.06;
    if (awaySource.includes("FALLBACK"))
        sourceQuality -= 0.06;
    // 3. Consistencia y balance estadístico del partido (evitar partidos de extrema varianza aleatoria)
    var consistencyScore = 0;
    var ratio = Math.min(lambda1, lambda2) / Math.max(0.1, Math.max(lambda1, lambda2));
    if (marketType === "GOALS") {
        var totalLambdas = lambda1 + lambda2;
        consistencyScore += (Math.min(3.2, totalLambdas) - 2.0) * 0.02;
        consistencyScore += (ratio - 0.5) * 0.03;
    }
    else {
        var totalCorners = lambda1 + lambda2;
        consistencyScore += (Math.min(11.0, totalCorners) - 8.5) * 0.015;
        consistencyScore += (ratio - 0.5) * 0.025;
    }
    // 4. Confianza de alineaciones pre-partido
    var lineupBoost = (lineupConfidence - 0.85) * 0.15;
    var rawStability = sampleConfidence + sourceQuality + consistencyScore + lineupBoost;
    // Clampeado a rango realista probabilístico [0.5500, 0.9650] y redondeado a 4 decimales
    return Number(Math.max(0.55, Math.min(0.965, rawStability)).toFixed(4));
}
/**
 * Procesa la evaluación completa para una liga en la fecha solicitada.
 * Utiliza clasificaciones por equipo en 1 sola consulta HTTP por liga para garantizar
 * que CADA PARTIDO tenga sus propias estadísticas únicas sin agotar la cuota de la API.
 */
function analyzeLeagueForDate(dateStr, leagueCode) {
    return __awaiter(this, void 0, void 0, function () {
        var leagueInfo, matches, _a, apifStandings, fdStandings, defaultCorners, results, _i, matches_1, m, fixtureId, lineupsInfo, normHome, normAway, homeApi, awayApi, homeFd, awayFd, homeGF, homeGA, homePlayed, homeSource, awayGF, awayGA, awayPlayed, awaySource, homeAdvantage, awayAdjustment, lambdaHomeGoals, lambdaAwayGoals, lambdaTotalGoals, baseH, baseA, lambdaCornersHome, lambdaCornersAway, lambdaCornersTotal, goalsStability, cornersStability, lowRisk, passesLowScoreRisk, finalCornersStability, picks, pOver15Raw, pOver25Raw, pOver15Adj, pOver25Adj, pOver15Lower, pOver25Lower, thrGoals, goalsReasoning, pCorners65Raw, pCorners75Raw, pCorners65Adj, pCorners75Adj, pCorners65Lower, pCorners75Lower, thrCorners, cornerRiskMsg, cornersReasoning, candRecord, snapData, _b, picks_1, pk, err_1;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    leagueInfo = footballData_1.SUPPORTED_LEAGUES[leagueCode];
                    if (!leagueInfo) {
                        throw new Error("Liga no soportada: ".concat(leagueCode));
                    }
                    return [4 /*yield*/, (0, footballData_1.fetchMatchesForDateAndLeague)(dateStr, leagueCode)];
                case 1:
                    matches = _c.sent();
                    if (!matches || matches.length === 0)
                        return [2 /*return*/, []];
                    return [4 /*yield*/, Promise.all([
                            (0, apiFootball_1.fetchApiFootballStandings)(leagueCode),
                            (0, footballData_1.fetchStandingsRates)(leagueCode),
                        ])];
                case 2:
                    _a = _c.sent(), apifStandings = _a[0], fdStandings = _a[1];
                    defaultCorners = (0, apiFootball_1.getDefaultCornerStatsForLeague)(leagueCode);
                    results = [];
                    _i = 0, matches_1 = matches;
                    _c.label = 3;
                case 3:
                    if (!(_i < matches_1.length)) return [3 /*break*/, 14];
                    m = matches_1[_i];
                    fixtureId = "fd:".concat(m.id);
                    return [4 /*yield*/, (0, apiFootball_1.fetchLineupsForMatch)(dateStr, m.homeTeam.name, m.awayTeam.name)];
                case 4:
                    lineupsInfo = _c.sent();
                    normHome = (0, apiFootball_1.normTeamName)(m.homeTeam.name);
                    normAway = (0, apiFootball_1.normTeamName)(m.awayTeam.name);
                    homeApi = apifStandings[String(m.homeTeam.id)] || apifStandings[normHome];
                    awayApi = apifStandings[String(m.awayTeam.id)] || apifStandings[normAway];
                    homeFd = fdStandings[m.homeTeam.id];
                    awayFd = fdStandings[m.awayTeam.id];
                    homeGF = void 0, homeGA = void 0, homePlayed = void 0;
                    homeSource = void 0;
                    if (homeApi) {
                        // Candado 1: Sample Size Blend para Local (Mezclar global si hay pocos partidos de local)
                        homePlayed = homeApi.homePlayed;
                        if (homePlayed < 5) {
                            homeGF = (homeApi.homeGoalsForPerGame + homeApi.goalsForPerGame) / 2.0;
                            homeGA = (homeApi.homeGoalsAgainstPerGame + homeApi.goalsAgainstPerGame) / 2.0;
                            homeSource = "API-Football Blend (<5 Home PJ, GF:".concat(homeGF.toFixed(2), ", GA:").concat(homeGA.toFixed(2), ")");
                        }
                        else {
                            homeGF = homeApi.homeGoalsForPerGame;
                            homeGA = homeApi.homeGoalsAgainstPerGame;
                            homeSource = "API-Football Pure Home (".concat(homePlayed, "PJ, GF:").concat(homeGF.toFixed(2), ", GA:").concat(homeGA.toFixed(2), ")");
                        }
                    }
                    else if (homeFd) {
                        // football-data.org solo da TOTAL en free tier, aplicamos el total
                        homeGF = homeFd.goalsForPerGame;
                        homeGA = homeFd.goalsAgainstPerGame;
                        homePlayed = 15;
                        homeSource = "football-data (".concat(homeFd.goalsForPerGame.toFixed(2), "/").concat(homeFd.goalsAgainstPerGame.toFixed(2), ")");
                    }
                    else {
                        homeGF = 1.30;
                        homeGA = 1.15;
                        homePlayed = 5;
                        homeSource = "Liga Promedio (Ajuste Calibrado)";
                    }
                    awayGF = void 0, awayGA = void 0, awayPlayed = void 0;
                    awaySource = void 0;
                    if (awayApi) {
                        // Candado 1: Sample Size Blend para Visitante
                        awayPlayed = awayApi.awayPlayed;
                        if (awayPlayed < 5) {
                            awayGF = (awayApi.awayGoalsForPerGame + awayApi.goalsForPerGame) / 2.0;
                            awayGA = (awayApi.awayGoalsAgainstPerGame + awayApi.goalsAgainstPerGame) / 2.0;
                            awaySource = "API-Football Blend (<5 Away PJ, GF:".concat(awayGF.toFixed(2), ", GA:").concat(awayGA.toFixed(2), ")");
                        }
                        else {
                            awayGF = awayApi.awayGoalsForPerGame;
                            awayGA = awayApi.awayGoalsAgainstPerGame;
                            awaySource = "API-Football Pure Away (".concat(awayPlayed, "PJ, GF:").concat(awayGF.toFixed(2), ", GA:").concat(awayGA.toFixed(2), ")");
                        }
                    }
                    else if (awayFd) {
                        awayGF = awayFd.goalsForPerGame;
                        awayGA = awayFd.goalsAgainstPerGame;
                        awayPlayed = 15;
                        awaySource = "football-data (".concat(awayFd.goalsForPerGame.toFixed(2), "/").concat(awayFd.goalsAgainstPerGame.toFixed(2), ")");
                    }
                    else {
                        awayGF = 1.10;
                        awayGA = 1.35;
                        awayPlayed = 5;
                        awaySource = "Liga Promedio (Ajuste Calibrado)";
                    }
                    homeAdvantage = homeApi ? 1.0 : 1.12;
                    awayAdjustment = awayApi ? 1.0 : 0.88;
                    lambdaHomeGoals = Math.max(0.3, ((homeGF + awayGA) / 2.0) * homeAdvantage);
                    lambdaAwayGoals = Math.max(0.3, ((awayGF + homeGA) / 2.0) * awayAdjustment);
                    lambdaTotalGoals = lambdaHomeGoals + lambdaAwayGoals;
                    baseH = defaultCorners.avgCornersHome;
                    baseA = defaultCorners.avgCornersAway;
                    lambdaCornersHome = Math.max(3.0, baseH * Math.pow(homeGF / 1.3, 0.5) * Math.pow(awayGA / 1.2, 0.3) * homeAdvantage);
                    lambdaCornersAway = Math.max(2.5, baseA * Math.pow(awayGF / 1.3, 0.5) * Math.pow(homeGA / 1.2, 0.3) * awayAdjustment);
                    lambdaCornersTotal = lambdaCornersHome + lambdaCornersAway;
                    goalsStability = calculateDynamicStability(homePlayed, awayPlayed, homeSource, awaySource, lambdaHomeGoals, lambdaAwayGoals, lineupsInfo.confidence, "GOALS");
                    cornersStability = calculateDynamicStability(homePlayed, awayPlayed, homeSource, awaySource, lambdaCornersHome, lambdaCornersAway, lineupsInfo.confidence, "CORNERS");
                    lowRisk = (0, poisson_1.lowScoreRiskOver15)(lambdaHomeGoals, lambdaAwayGoals);
                    passesLowScoreRisk = lowRisk.p00 <= 0.12 && lowRisk.pTotalLe1 <= 0.22;
                    finalCornersStability = cornersStability;
                    if (lowRisk.p00 > 0.12) {
                        finalCornersStability = Math.max(0.55, finalCornersStability - 0.08); // Penalización del 8%
                    }
                    picks = [];
                    pOver15Raw = (0, poisson_1.probOverDixonColes)(lambdaHomeGoals, lambdaAwayGoals, 1.5);
                    pOver25Raw = (0, poisson_1.probOverDixonColes)(lambdaHomeGoals, lambdaAwayGoals, 2.5);
                    // Candado 2: Cross-Volatility Filter (Varianza Cruzada)
                    // Si el local anota muchísimo (ej. 3.0) pero el visitante defiende perfecto (ej. 0.2)
                    if (Math.abs(homeGF - awayGA) > 1.5 || Math.abs(awayGF - homeGA) > 1.5) {
                        pOver15Raw *= 0.95; // Castigo del 5% a la probabilidad bruta
                        pOver25Raw *= 0.95;
                    }
                    pOver15Adj = 0.5 + (pOver15Raw - 0.5) * lineupsInfo.confidence;
                    pOver25Adj = 0.5 + (pOver25Raw - 0.5) * lineupsInfo.confidence;
                    pOver15Lower = calculateLowerBound(pOver15Adj, goalsStability, lineupsInfo.confidence).pLower;
                    pOver25Lower = calculateLowerBound(pOver25Adj, goalsStability, lineupsInfo.confidence).pLower;
                    thrGoals = 0.80;
                    goalsReasoning = {
                        lambdaHome: Number(lambdaHomeGoals.toFixed(3)),
                        lambdaAway: Number(lambdaAwayGoals.toFixed(3)),
                        lambdaTotal: Number(lambdaTotalGoals.toFixed(3)),
                        homeTeamStats: homeSource,
                        awayTeamStats: awaySource,
                        lineupsStatus: lineupsInfo.status,
                        stability: goalsStability,
                        lowRisk: lowRisk,
                    };
                    if (pOver25Lower >= thrGoals && passesLowScoreRisk) {
                        picks.push({
                            market: "GOALS_OU", selection: "OVER", line: 2.5,
                            probability: Number(pOver25Adj.toFixed(4)),
                            pLower: Number(pOver25Lower.toFixed(4)),
                            decision: "BET", threshold: thrGoals, stability: goalsStability,
                            reasoning: goalsReasoning,
                        });
                    }
                    else if (pOver15Lower >= thrGoals && passesLowScoreRisk) {
                        picks.push({
                            market: "GOALS_OU", selection: "OVER", line: 1.5,
                            probability: Number(pOver15Adj.toFixed(4)),
                            pLower: Number(pOver15Lower.toFixed(4)),
                            decision: "BET", threshold: thrGoals, stability: goalsStability,
                            reasoning: goalsReasoning,
                        });
                    }
                    else {
                        picks.push({
                            market: "GOALS_OU", selection: "OVER", line: 1.5,
                            probability: Number(pOver15Adj.toFixed(4)),
                            pLower: Number(pOver15Lower.toFixed(4)),
                            decision: "NO_BET", threshold: thrGoals, stability: goalsStability,
                            reasoning: __assign(__assign({}, goalsReasoning), { reason: !passesLowScoreRisk
                                    ? "Riesgo de marcador bajo: P(0-0)=".concat((lowRisk.p00 * 100).toFixed(1), "%, P(\u22641 gol)=").concat((lowRisk.pTotalLe1 * 100).toFixed(1), "%")
                                    : "P_lower=".concat((pOver15Lower * 100).toFixed(1), "% < umbral ").concat(thrGoals * 100, "%") }),
                        });
                    }
                    pCorners65Raw = (0, poisson_1.probOverCorners)(lambdaCornersHome, lambdaCornersAway, 6.5).pOver;
                    pCorners75Raw = (0, poisson_1.probOverCorners)(lambdaCornersHome, lambdaCornersAway, 7.5).pOver;
                    pCorners65Adj = 0.5 + (pCorners65Raw - 0.5) * lineupsInfo.confidence;
                    pCorners75Adj = 0.5 + (pCorners75Raw - 0.5) * lineupsInfo.confidence;
                    pCorners65Lower = calculateLowerBound(pCorners65Adj, finalCornersStability, lineupsInfo.confidence).pLower;
                    pCorners75Lower = calculateLowerBound(pCorners75Adj, finalCornersStability, lineupsInfo.confidence).pLower;
                    thrCorners = 0.78;
                    cornerRiskMsg = (lowRisk.p00 > 0.12) ? "⚠ Riesgo 0-0 penalizó Córneres (-8% estabilidad)" : "Riesgo de bajo marcador bajo control.";
                    cornersReasoning = {
                        lambdaCornersHome: Number(lambdaCornersHome.toFixed(2)),
                        lambdaCornersAway: Number(lambdaCornersAway.toFixed(2)),
                        lambdaCornersTotal: Number(lambdaCornersTotal.toFixed(2)),
                        homeTeamStats: homeSource,
                        awayTeamStats: awaySource,
                        lineupsStatus: lineupsInfo.status,
                        stability: finalCornersStability,
                        cornerRiskMsg: cornerRiskMsg,
                    };
                    if (pCorners75Lower >= thrCorners) {
                        picks.push({
                            market: "CORNERS_OU", selection: "OVER", line: 7.5,
                            probability: Number(pCorners75Adj.toFixed(4)),
                            pLower: Number(pCorners75Lower.toFixed(4)),
                            decision: "BET", threshold: thrCorners, stability: finalCornersStability,
                            reasoning: cornersReasoning,
                        });
                    }
                    else if (pCorners65Lower >= thrCorners) {
                        picks.push({
                            market: "CORNERS_OU", selection: "OVER", line: 6.5,
                            probability: Number(pCorners65Adj.toFixed(4)),
                            pLower: Number(pCorners65Lower.toFixed(4)),
                            decision: "BET", threshold: thrCorners, stability: finalCornersStability,
                            reasoning: cornersReasoning,
                        });
                    }
                    else {
                        picks.push({
                            market: "CORNERS_OU", selection: "OVER", line: 6.5,
                            probability: Number(pCorners65Adj.toFixed(4)),
                            pLower: Number(pCorners65Lower.toFixed(4)),
                            decision: "NO_BET", threshold: thrCorners, stability: finalCornersStability,
                            reasoning: __assign(__assign({}, cornersReasoning), { reason: "P_lower=".concat((pCorners65Lower * 100).toFixed(1), "% < umbral ").concat(thrCorners * 100, "%") }),
                        });
                    }
                    candRecord = void 0;
                    _c.label = 5;
                case 5:
                    _c.trys.push([5, 11, , 12]);
                    snapData = {
                        lineupStatus: lineupsInfo,
                        score: m.score,
                        homeStats: homeSource,
                        awayStats: awaySource,
                    };
                    return [4 /*yield*/, prisma_1.prisma.candidate.upsert({
                            where: { fixtureId: fixtureId },
                            create: {
                                date: dateStr,
                                league: leagueCode,
                                fixtureId: fixtureId,
                                homeTeam: m.homeTeam.name,
                                awayTeam: m.awayTeam.name,
                                kickoffUtc: new Date(m.utcDate),
                                executeAtUtc: new Date(m.utcDate),
                                status: picks.some(function (p) { return p.decision === "BET"; }) ? "CANDIDATE" : "NO_BET",
                                snapshot: snapData,
                            },
                            update: {
                                status: picks.some(function (p) { return p.decision === "BET"; }) ? "CANDIDATE" : "NO_BET",
                                snapshot: snapData,
                            },
                        })];
                case 6:
                    candRecord = _c.sent();
                    _b = 0, picks_1 = picks;
                    _c.label = 7;
                case 7:
                    if (!(_b < picks_1.length)) return [3 /*break*/, 10];
                    pk = picks_1[_b];
                    return [4 /*yield*/, prisma_1.prisma.pick.create({
                            data: {
                                candidateId: candRecord.id,
                                decision: pk.decision,
                                market: pk.market,
                                selection: pk.selection,
                                line: pk.line,
                                probability: pk.probability,
                                pLower: pk.pLower,
                                reasoning: pk.reasoning,
                            },
                        })];
                case 8:
                    _c.sent();
                    _c.label = 9;
                case 9:
                    _b++;
                    return [3 /*break*/, 7];
                case 10: return [3 /*break*/, 12];
                case 11:
                    err_1 = _c.sent();
                    console.error("Error guardando candidato ".concat(fixtureId, " en Neon DB:"), err_1);
                    return [3 /*break*/, 12];
                case 12:
                    results.push({
                        id: (candRecord === null || candRecord === void 0 ? void 0 : candRecord.id) || fixtureId,
                        date: dateStr,
                        league: leagueCode,
                        leagueName: leagueInfo.name,
                        fixtureId: fixtureId,
                        homeTeam: m.homeTeam.name,
                        awayTeam: m.awayTeam.name,
                        kickoffUtc: m.utcDate,
                        status: m.status,
                        lineupStatus: lineupsInfo,
                        picks: picks,
                    });
                    _c.label = 13;
                case 13:
                    _i++;
                    return [3 /*break*/, 3];
                case 14: return [2 /*return*/, results];
            }
        });
    });
}
