/**
 * Módulo Matemático Probabilístico para Predicción de Goles y Córneres.
 * Implementa Poisson Bivariado, Ajuste Dixon-Coles y Distribución Binomial Negativa.
 */

function factorial(n: number): number {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1.0 : 0.0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function poissonCdf(k: number, lambda: number): number {
  if (lambda <= 0) return 1.0;
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += poissonPmf(i, lambda);
  }
  return Math.min(1.0, Math.max(0.0, sum));
}

/**
  Probabilidad de que el total supere la línea según Poisson independiente.
 */
export function probOverPoisson(lambdaTotal: number, line: number): number {
  const kMax = Math.floor(line);
  const cdf = poissonCdf(kMax, lambdaTotal);
  return Math.min(1.0, Math.max(0.0, 1.0 - cdf));
}

/**
 * Ajuste de Dixon-Coles para goles bajos (0-0, 1-0, 0-1, 1-1).
 */
export function dixonColesTau(
  h: number,
  a: number,
  lambdaH: number,
  lambdaA: number,
  rho: number = 0.05
): number {
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
export function probOverDixonColes(
  lambdaH: number,
  lambdaA: number,
  line: number,
  rho: number = 0.05,
  maxGoals: number = 10
): number {
  let probUnder = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      if (h + a <= line) {
        const pPure = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA);
        const tau = dixonColesTau(h, a, lambdaH, lambdaA, rho);
        probUnder += pPure * tau;
      }
    }
  }
  return Math.min(1.0, Math.max(0.0, 1.0 - probUnder));
}

/**
 * Riesgo de marcador bajo para Goles (0-0, 1-0, 0-1, total <= 1).
 */
export function lowScoreRiskOver15(lambdaH: number, lambdaA: number, rho: number = 0.05) {
  const p00 = poissonPmf(0, lambdaH) * poissonPmf(0, lambdaA) * dixonColesTau(0, 0, lambdaH, lambdaA, rho);
  const p10 = poissonPmf(1, lambdaH) * poissonPmf(0, lambdaA) * dixonColesTau(1, 0, lambdaH, lambdaA, rho);
  const p01 = poissonPmf(0, lambdaH) * poissonPmf(1, lambdaA) * dixonColesTau(0, 1, lambdaH, lambdaA, rho);
  const pTotalLe1 = p00 + p10 + p01;

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
export function probOverCorners(
  lambdaCornersHome: number,
  lambdaCornersAway: number,
  line: number
): { pOver: number; lambdaTotal: number } {
  const lambdaTotal = Math.max(3.0, lambdaCornersHome + lambdaCornersAway);
  const kMax = Math.floor(line); // 6 para 6.5, 7 para 7.5
  const cdf = poissonCdf(kMax, lambdaTotal);
  const pOver = Math.min(1.0, Math.max(0.0, 1.0 - cdf));

  return { pOver, lambdaTotal };
}
