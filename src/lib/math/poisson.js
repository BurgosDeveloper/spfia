"use strict";
/**
 * Módulo Matemático Probabilístico para Predicción de Goles y Córneres.
 * Implementa Poisson Bivariado, Ajuste Dixon-Coles y Distribución Binomial Negativa.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.poissonPmf = poissonPmf;
exports.poissonCdf = poissonCdf;
exports.probOverPoisson = probOverPoisson;
exports.dixonColesTau = dixonColesTau;
exports.probOverDixonColes = probOverDixonColes;
exports.lowScoreRiskOver15 = lowScoreRiskOver15;
exports.probOverCorners = probOverCorners;
function factorial(n) {
    if (n <= 1)
        return 1;
    var res = 1;
    for (var i = 2; i <= n; i++)
        res *= i;
    return res;
}
function poissonPmf(k, lambda) {
    if (lambda <= 0)
        return k === 0 ? 1.0 : 0.0;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}
function poissonCdf(k, lambda) {
    if (lambda <= 0)
        return 1.0;
    var sum = 0;
    for (var i = 0; i <= Math.floor(k); i++) {
        sum += poissonPmf(i, lambda);
    }
    return Math.min(1.0, Math.max(0.0, sum));
}
/**
  Probabilidad de que el total supere la línea según Poisson independiente.
 */
function probOverPoisson(lambdaTotal, line) {
    var kMax = Math.floor(line);
    var cdf = poissonCdf(kMax, lambdaTotal);
    return Math.min(1.0, Math.max(0.0, 1.0 - cdf));
}
/**
 * Ajuste de Dixon-Coles para goles bajos (0-0, 1-0, 0-1, 1-1).
 */
function dixonColesTau(h, a, lambdaH, lambdaA, rho) {
    if (rho === void 0) { rho = 0.05; }
    if (h === 0 && a === 0) {
        return 1 - lambdaH * lambdaA * rho;
    }
    if (h === 1 && a === 0) {
        return 1 + lambdaA * rho;
    }
    if (h === 0 && a === 1) {
        return 1 + lambdaH * rho;
    }
    if (h === 1 && a === 1) {
        return 1 - rho;
    }
    return 1.0;
}
/**
 * Probabilidad Over para Goles incorporando Dixon-Coles.
 */
function probOverDixonColes(lambdaH, lambdaA, line, rho, maxGoals) {
    if (rho === void 0) { rho = 0.05; }
    if (maxGoals === void 0) { maxGoals = 10; }
    var probUnder = 0;
    for (var h = 0; h <= maxGoals; h++) {
        for (var a = 0; a <= maxGoals; a++) {
            if (h + a <= line) {
                var pPure = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA);
                var tau = dixonColesTau(h, a, lambdaH, lambdaA, rho);
                probUnder += pPure * tau;
            }
        }
    }
    return Math.min(1.0, Math.max(0.0, 1.0 - probUnder));
}
/**
 * Riesgo de marcador bajo para Goles (0-0, 1-0, 0-1, total <= 1).
 */
function lowScoreRiskOver15(lambdaH, lambdaA, rho) {
    if (rho === void 0) { rho = 0.05; }
    var p00 = poissonPmf(0, lambdaH) * poissonPmf(0, lambdaA) * dixonColesTau(0, 0, lambdaH, lambdaA, rho);
    var p10 = poissonPmf(1, lambdaH) * poissonPmf(0, lambdaA) * dixonColesTau(1, 0, lambdaH, lambdaA, rho);
    var p01 = poissonPmf(0, lambdaH) * poissonPmf(1, lambdaA) * dixonColesTau(0, 1, lambdaH, lambdaA, rho);
    var pTotalLe1 = p00 + p10 + p01;
    return {
        p00: Math.max(0.0, p00),
        p10: Math.max(0.0, p10),
        p01: Math.max(0.0, p01),
        pTotalLe1: Math.max(0.0, pTotalLe1),
    };
}
/**
 * Probabilidad de Córneres Totales (Poisson Bivariado sobre total de córneres esperados).
 * Soporta las líneas fijas Over 6.5 y Over 7.5.
 */
function probOverCorners(lambdaCornersHome, lambdaCornersAway, line) {
    var lambdaTotal = Math.max(3.0, lambdaCornersHome + lambdaCornersAway);
    var kMax = Math.floor(line); // 6 para 6.5, 7 para 7.5
    var cdf = poissonCdf(kMax, lambdaTotal);
    var pOver = Math.min(1.0, Math.max(0.0, 1.0 - cdf));
    return { pOver: pOver, lambdaTotal: lambdaTotal };
}
