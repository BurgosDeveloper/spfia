/**
 * Simulador Estocástico Monte Carlo Determinista (N = 10,000 simulaciones por partido).
 * Acopla la distribución bivariada de Goles (Dixon-Coles) con la de Córneres (Binomial Negativa)
 * mediante una Cópula Gaussiana parametrizada por la correlación empírica de cada liga.
 *
 * Usa PRNG con semilla derivada del identificador del partido (mulberry32) para garantizar
 * reproducibilidad exacta al 100% sin saltos aleatorios al refrescar la interfaz.
 */

import { clamp, dixonColesTau, negBinPmf, poissonPmf } from "./poisson";

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Función de distribución acumulada normal estándar Phi(z) (aproximación Abramowitz & Stegun).
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + 0.3275911 * x);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

export interface MonteCarloResult {
  simulations: number;
  pO15: number;
  pO25: number;
  pU25: number;
  pCorners65: number;
  pCorners75: number;
  pCorners85: number;
  p1X: number;
  pX2: number;
  p1XO15: number;
  pX2O15: number;
  pHomeO15: number;
  pHomeWin: number;
  pHtO05: number;
  pJointO15AndC65: number;
  pJointO15AndC75: number;
  expectedGoals: number;
  expectedCorners: number;
}

interface GoalCell {
  h: number;
  a: number;
  cumProb: number;
}

export function simulateMatchMonteCarlo(params: {
  seedKey: string;
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  lambdaCornersTotal: number;
  nbDispersion: number;
  corrGC: number;
  simulations?: number;
}): MonteCarloResult {
  const {
    seedKey,
    lambdaHome,
    lambdaAway,
    rho,
    lambdaCornersTotal,
    nbDispersion,
    corrGC,
    simulations = 10000,
  } = params;

  const maxG = 9;
  const pmfH: number[] = [];
  const pmfA: number[] = [];
  for (let g = 0; g <= maxG; g++) {
    pmfH.push(poissonPmf(g, lambdaHome));
    pmfA.push(poissonPmf(g, lambdaAway));
  }

  // Ordenar celdas (h, a) por total de goles ascendente para acoplar monotonicamente con Z_g
  const rawCells: { h: number; a: number; p: number }[] = [];
  let sumG = 0;
  for (let tot = 0; tot <= 2 * maxG; tot++) {
    for (let h = 0; h <= Math.min(maxG, tot); h++) {
      const a = tot - h;
      if (a > maxG) continue;
      const tau = Math.max(0.01, dixonColesTau(h, a, lambdaHome, lambdaAway, rho));
      const p = pmfH[h] * pmfA[a] * tau;
      rawCells.push({ h, a, p });
      sumG += p;
    }
  }

  const goalCdf: GoalCell[] = [];
  let accG = 0;
  for (let i = 0; i < rawCells.length; i++) {
    accG += rawCells[i].p / Math.max(1e-12, sumG);
    goalCdf.push({ h: rawCells[i].h, a: rawCells[i].a, cumProb: accG });
  }
  goalCdf[goalCdf.length - 1].cumProb = 1.0;

  // Precomputar CDF de Binomial Negativa para córneres (0..32)
  const maxC = 32;
  const cornerCdf: number[] = [];
  let accC = 0;
  for (let k = 0; k <= maxC; k++) {
    accC += negBinPmf(k, lambdaCornersTotal, nbDispersion);
    cornerCdf.push(accC);
  }
  cornerCdf[maxC] = 1.0;

  const rng = createMulberry32(hashSeed(seedKey));
  const safeCorr = clamp(corrGC, -0.35, 0.45);
  const orthoScale = Math.sqrt(1.0 - safeCorr * safeCorr);

  let cntO15 = 0;
  let cntO25 = 0;
  let cntC65 = 0;
  let cntC75 = 0;
  let cntC85 = 0;
  let cnt1X = 0;
  let cntX2 = 0;
  let cnt1XO15 = 0;
  let cntX2O15 = 0;
  let cntHomeO15 = 0;
  let cntHomeWin = 0;
  let cntJoint65 = 0;
  let cntJoint75 = 0;
  let sumGoalsSim = 0;
  let sumCornersSim = 0;

  for (let i = 0; i < simulations; i++) {
    // Box-Muller para dos normales independientes
    const u1 = Math.max(1e-9, rng());
    const u2 = rng();
    const mag = Math.sqrt(-2.0 * Math.log(u1));
    const zG = mag * Math.cos(2.0 * Math.PI * u2);
    const zInd = mag * Math.sin(2.0 * Math.PI * u2);
    const zC = safeCorr * zG + orthoScale * zInd;

    const pG = normalCdf(zG);
    const pC = normalCdf(zC);

    // Búsqueda binaria rápida en CDF de goles
    let lo = 0;
    let hi = goalCdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (goalCdf[mid].cumProb < pG) lo = mid + 1;
      else hi = mid;
    }
    const gCell = goalCdf[lo];
    const totGoals = gCell.h + gCell.a;

    // Búsqueda binaria en CDF de córneres
    let clo = 0;
    let chi = maxC;
    while (clo < chi) {
      const cmid = (clo + chi) >> 1;
      if (cornerCdf[cmid] < pC) clo = cmid + 1;
      else chi = cmid;
    }
    const totCorners = clo;

    sumGoalsSim += totGoals;
    sumCornersSim += totCorners;

    const isO15 = totGoals >= 2;
    const isC65 = totCorners >= 7;
    const isC75 = totCorners >= 8;
    const isC85 = totCorners >= 9;

    if (isO15) cntO15++;
    if (totGoals >= 3) cntO25++;
    if (isC65) cntC65++;
    if (isC75) cntC75++;
    if (isC85) cntC85++;
    if (gCell.h >= gCell.a) cnt1X++;
    if (gCell.a >= gCell.h) cntX2++;
    if (gCell.h >= gCell.a && isO15) cnt1XO15++;
    if (gCell.a >= gCell.h && isO15) cntX2O15++;
    if (gCell.h >= 2) cntHomeO15++;
    if (gCell.h > gCell.a) cntHomeWin++;
    if (isO15 && isC65) cntJoint65++;
    if (isO15 && isC75) cntJoint75++;
  }

  const pHtO05 = clamp(1.0 - Math.exp(-0.45 * (lambdaHome + lambdaAway)), 0.001, 0.999);

  return {
    simulations,
    pO15: Number((cntO15 / simulations).toFixed(4)),
    pO25: Number((cntO25 / simulations).toFixed(4)),
    pU25: Number((1.0 - cntO25 / simulations).toFixed(4)),
    pCorners65: Number((cntC65 / simulations).toFixed(4)),
    pCorners75: Number((cntC75 / simulations).toFixed(4)),
    pCorners85: Number((cntC85 / simulations).toFixed(4)),
    p1X: Number((cnt1X / simulations).toFixed(4)),
    pX2: Number((cntX2 / simulations).toFixed(4)),
    p1XO15: Number((cnt1XO15 / simulations).toFixed(4)),
    pX2O15: Number((cntX2O15 / simulations).toFixed(4)),
    pHomeO15: Number((cntHomeO15 / simulations).toFixed(4)),
    pHomeWin: Number((cntHomeWin / simulations).toFixed(4)),
    pHtO05: Number(pHtO05.toFixed(4)),
    pJointO15AndC65: Number((cntJoint65 / simulations).toFixed(4)),
    pJointO15AndC75: Number((cntJoint75 / simulations).toFixed(4)),
    expectedGoals: Number((sumGoalsSim / simulations).toFixed(2)),
    expectedCorners: Number((sumCornersSim / simulations).toFixed(2)),
  };
}
