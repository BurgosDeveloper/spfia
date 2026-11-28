/**
 * Módulo Matemático Probabilístico para Predicción de Goles, Córneres y Doble Oportunidad.
 * Implementa Dixon-Coles Bivariado normalizado, Binomial Negativa (sobredispersión en córneres),
 * de-vigging de cuotas reales y dimensionamiento de Stake mediante Kelly Fraccional.
 */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function sigmoid(z: number): number {
  if (z >= 0) {
    return 1.0 / (1.0 + Math.exp(-Math.min(z, 35.0)));
  }
  const ez = Math.exp(Math.max(z, -35.0));
  return ez / (1.0 + ez);
}

export function safeLogit(p: number): number {
  const pc = clamp(p, 1e-4, 1.0 - 1e-4);
  return Math.log(pc / (1.0 - pc));
}

/**
 * Aproximación de Lanczos para ln(Gamma(z)), precisa a ~1e-12 para todo z > 0.
 * Idéntica funcionalmente a math.lgamma de Python para Binomial Negativa.
 */
const LANCZOS_COEFFS = [
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lgamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  const zm1 = z - 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i] / (zm1 + i + 1);
  }
  const t = zm1 + LANCZOS_COEFFS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1.0 : 0.0;
  return Math.exp(-lambda + k * Math.log(lambda) - lgamma(k + 1));
}

export function poissonCdf(k: number, lambda: number): number {
  if (lambda <= 0) return 1.0;
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += poissonPmf(i, lambda);
  }
  return clamp(sum, 0.0, 1.0);
}

export function probOverPoisson(lambdaTotal: number, line: number): number {
  const kMax = Math.floor(line);
  return clamp(1.0 - poissonCdf(kMax, lambdaTotal), 0.0, 1.0);
}

/**
 * Ajuste de Dixon-Coles para marcadores bajos (0-0, 1-0, 0-1, 1-1).
 */
export function dixonColesTau(
  h: number,
  a: number,
  lambdaH: number,
  lambdaA: number,
  rho: number = 0.0
): number {
  if (h === 0 && a === 0) return 1.0 - lambdaH * lambdaA * rho;
  if (h === 1 && a === 0) return 1.0 + lambdaA * rho;
  if (h === 0 && a === 1) return 1.0 + lambdaH * rho;
  if (h === 1 && a === 1) return 1.0 - rho;
  return 1.0;
}

export interface DixonColesMatrixResult {
  pO15: number;
  pO25: number;
  pU25: number;
  p1X: number;
  pX2: number;
  pH: number;
  pD: number;
  pA: number;
  p00: number;
  pLe1: number;
  p1XO15: number;
  pX2O15: number;
  pHomeO15: number;
}

/**
 * Matriz completa y normalizada de Dixon-Coles (0..10 goles por equipo).
 */
export function dixonColesMatrix(
  lambdaH: number,
  lambdaA: number,
  rho: number = 0.0,
  maxGoals: number = 10
): DixonColesMatrixResult {
  const pmfH: number[] = [];
  const pmfA: number[] = [];
  for (let g = 0; g <= maxGoals; g++) {
    pmfH.push(poissonPmf(g, lambdaH));
    pmfA.push(poissonPmf(g, lambdaA));
  }

  let total = 0;
  const mat: number[][] = [];
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const tau = Math.max(0.01, dixonColesTau(h, a, lambdaH, lambdaA, rho));
      const val = pmfH[h] * pmfA[a] * tau;
      row.push(val);
      total += val;
    }
    mat.push(row);
  }

  const inv = 1.0 / Math.max(1e-12, total);
  let pH = 0, pD = 0, pA = 0, pO15 = 0, pO25 = 0, p00 = 0, pLe1 = 0;
  let p1XO15 = 0, pX2O15 = 0, pHomeO15 = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = mat[h][a] * inv;
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;

      const totG = h + a;
      if (totG > 1.5) pO15 += p;
      if (totG > 2.5) pO25 += p;
      if (totG === 0) p00 += p;
      if (totG <= 1) pLe1 += p;
      if (h >= a && totG >= 2) p1XO15 += p;
      if (a >= h && totG >= 2) pX2O15 += p;
      if (h >= 2) pHomeO15 += p;
    }
  }

  return {
    pO15: clamp(pO15, 0.001, 0.999),
    pO25: clamp(pO25, 0.001, 0.999),
    pU25: clamp(1.0 - pO25, 0.001, 0.999),
    p1X: clamp(pH + pD, 0.001, 0.999),
    pX2: clamp(pD + pA, 0.001, 0.999),
    pH: clamp(pH, 0.001, 0.999),
    pD: clamp(pD, 0.001, 0.999),
    pA: clamp(pA, 0.001, 0.999),
    p00: clamp(p00, 0.001, 0.999),
    pLe1: clamp(pLe1, 0.001, 0.999),
    p1XO15: clamp(p1XO15, 0.001, 0.999),
    pX2O15: clamp(pX2O15, 0.001, 0.999),
    pHomeO15: clamp(pHomeO15, 0.001, 0.999),
  };
}

export function probOverDixonColes(
  lambdaH: number,
  lambdaA: number,
  line: number,
  rho: number = 0.0,
  maxGoals: number = 10
): number {
  const m = dixonColesMatrix(lambdaH, lambdaA, rho, maxGoals);
  if (Math.abs(line - 1.5) < 0.05) return m.pO15;
  if (Math.abs(line - 2.5) < 0.05) return m.pO25;
  return m.pO15;
}

export function lowScoreRiskOver15(lambdaH: number, lambdaA: number, rho: number = 0.0) {
  const m = dixonColesMatrix(lambdaH, lambdaA, rho, 10);
  const p10 = poissonPmf(1, lambdaH) * poissonPmf(0, lambdaA) * Math.max(0.01, dixonColesTau(1, 0, lambdaH, lambdaA, rho));
  const p01 = poissonPmf(0, lambdaH) * poissonPmf(1, lambdaA) * Math.max(0.01, dixonColesTau(0, 1, lambdaH, lambdaA, rho));
  return {
    p00: m.p00,
    p10: clamp(p10, 0, 1),
    p01: clamp(p01, 0, 1),
    pTotalLe1: m.pLe1,
  };
}

/**
 * Distribución Binomial Negativa exacta para Córneres Totales (captura sobredispersión real).
 */
export function negBinPmf(k: number, mu: number, r: number): number {
  if (mu <= 0) return k === 0 ? 1.0 : 0.0;
  const p = r / (r + mu);
  const logP =
    lgamma(k + r) -
    lgamma(r) -
    lgamma(k + 1) +
    r * Math.log(p) +
    k * Math.log(Math.max(1e-12, 1.0 - p));
  return Math.exp(logP);
}

export function probOverNegBin(mu: number, r: number, line: number): number {
  const kMax = Math.floor(line);
  let cdf = 0;
  for (let k = 0; k <= kMax; k++) {
    cdf += negBinPmf(k, mu, r);
  }
  return clamp(1.0 - cdf, 0.001, 0.999);
}

export function probOverCorners(
  lambdaCornersHome: number,
  lambdaCornersAway: number,
  line: number,
  dispersionR: number = 12.0
): { pOver: number; lambdaTotal: number } {
  const lambdaTotal = Math.max(3.0, lambdaCornersHome + lambdaCornersAway);
  const pOver = probOverNegBin(lambdaTotal, dispersionR, line);
  return { pOver, lambdaTotal };
}

/**
 * De-vig multiplicativo de cuotas reales de mercado (2 vías y 3 vías).
 */
export function devigTwoWay(o1: number, o2: number): [number, number] {
  const q1 = 1.0 / o1;
  const q2 = 1.0 / o2;
  const s = q1 + q2;
  return [clamp(q1 / s, 0.001, 0.999), clamp(q2 / s, 0.001, 0.999)];
}

export function devigThreeWay(oH: number, oD: number, oA: number): [number, number, number] {
  const qh = 1.0 / oH;
  const qd = 1.0 / oD;
  const qa = 1.0 / oA;
  const s = qh + qd + qa;
  return [clamp(qh / s, 0.001, 0.999), clamp(qd / s, 0.001, 0.999), clamp(qa / s, 0.001, 0.999)];
}

export function dutchDoubleChanceOdds(o1: number, o2: number, haircut: number = 0.985): number {
  return (1.0 / (1.0 / o1 + 1.0 / o2)) * haircut;
}

export interface KellyStakeResult {
  ev: number;
  fairOdds: number;
  minOddsForEdge: number;
  kellyFraction: number;
  stakeUnits: number;
}

/**
 * Calculadora de Valor Esperado (EV) y Stake con Kelly Fraccional (0.25x por defecto, escala 0.5u - 5.0u).
 */
export function calculateKellyStake(
  prob: number,
  odds: number,
  fraction: number = 0.25,
  minEdge: number = 0.025
): KellyStakeResult {
  const p = clamp(prob, 0.01, 0.99);
  const fairOdds = Number((1.0 / p).toFixed(2));
  const minOddsForEdge = Number(((1.0 + minEdge) / p).toFixed(2));

  if (!odds || odds <= 1.01) {
    return {
      ev: 0,
      fairOdds,
      minOddsForEdge,
      kellyFraction: 0,
      stakeUnits: 0,
    };
  }

  const ev = p * odds - 1.0;
  if (ev <= 0) {
    return {
      ev: Number(ev.toFixed(4)),
      fairOdds,
      minOddsForEdge,
      kellyFraction: 0,
      stakeUnits: 0,
    };
  }

  const fullKelly = ev / (odds - 1.0);
  const kellyFraction = fullKelly * fraction;
  const rawUnits = kellyFraction * 100.0;
  const stakeUnits = clamp(Math.round(rawUnits * 2.0) / 2.0, 0.5, 5.0);

  return {
    ev: Number(ev.toFixed(4)),
    fairOdds,
    minOddsForEdge,
    kellyFraction: Number(kellyFraction.toFixed(4)),
    stakeUnits,
  };
}
