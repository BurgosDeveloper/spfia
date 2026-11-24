/**
 * Motor de Inferencia Calibrada en TypeScript Puro (Zero Python Runtime Needed).
 * Carga los pesos de Regresión Logística L2, Árboles GBDT, Mezcla Óptima y Calibración Platt
 * exportados por ml/train_and_backtest.py en calibrated_model.json.
 */

import rawModel from "./calibrated_model.json";
import { clamp, safeLogit, sigmoid } from "../math/poisson";

export type TargetName =
  | "GOALS_O15"
  | "GOALS_O25"
  | "CORNERS_O65"
  | "CORNERS_O75"
  | "DC_1X"
  | "DC_X2";

export interface LeagueParams {
  avgHomeGoals: number;
  avgAwayGoals: number;
  avgHomeCorners: number;
  avgAwayCorners: number;
  avgHomeShots: number;
  avgAwayShots: number;
  avgHomeSot: number;
  avgAwaySot: number;
  sotConversionRate: number;
  dcRho: number;
  nbDispersion: number;
  corrGC: number;
}

export interface GbdtNode {
  v?: number;
  f?: number;
  t?: number;
  l?: GbdtNode;
  r?: GbdtNode;
}

export interface TargetModel {
  featureMeans: number[];
  featureStds: number[];
  logisticWeights: number[];
  logisticBias: number;
  noOddsWeights: number[];
  noOddsBias: number;
  gbdtInit: number;
  gbdtLr: number;
  gbdtTrees: GbdtNode[];
  blendWeight: number;
  plattA: number;
  plattB: number;
}

export interface CalibratedModelArtifact {
  version: string;
  trainedAt: string;
  seasons: string[];
  trainCutoff: string;
  testCutoff: string;
  totalMatchesTrained: number;
  totalMatchesTested: number;
  xi: number;
  kPrior: number;
  sotBlendWeight: number;
  leagues: Record<string, LeagueParams>;
  targets: Record<TargetName, TargetModel>;
  backtestSummary: Record<string, any>;
  evSummary: Record<string, any>;
  parityChecks: any[];
}

export const CALIBRATED_MODEL = rawModel as unknown as CalibratedModelArtifact;

export function getLeagueParams(divCode: string): LeagueParams {
  return (
    CALIBRATED_MODEL.leagues[divCode] || {
      avgHomeGoals: 1.45,
      avgAwayGoals: 1.15,
      avgHomeCorners: 5.2,
      avgAwayCorners: 4.4,
      avgHomeShots: 13.0,
      avgAwayShots: 10.8,
      avgHomeSot: 4.4,
      avgAwaySot: 3.6,
      sotConversionRate: 0.32,
      dcRho: -0.04,
      nbDispersion: 12.0,
      corrGC: 0.05,
    }
  );
}

function evalGbdtTree(node: GbdtNode, xStd: number[]): number {
  let cur: GbdtNode = node;
  while (cur.v === undefined) {
    const featIdx = cur.f ?? 0;
    const thr = cur.t ?? 0;
    cur = xStd[featIdx] <= thr ? (cur.l as GbdtNode) : (cur.r as GbdtNode);
  }
  return cur.v;
}

function predictSingleTarget(
  target: TargetName,
  rawFeatures: number[],
  hasMarketOdds: boolean
): number {
  const tm = CALIBRATED_MODEL.targets[target];
  if (!tm) return 0.5;

  const xStd = rawFeatures.map((val, idx) => {
    const mean = tm.featureMeans[idx] ?? 0;
    const std = Math.max(1e-4, tm.featureStds[idx] ?? 1);
    return (val - mean) / std;
  });

  if (!hasMarketOdds) {
    // Modelo específico entrenado sin cuotas de mercado para partidos aún sin cuotas publicadas
    let z = tm.noOddsBias;
    for (let i = 0; i < tm.noOddsWeights.length; i++) {
      z += tm.noOddsWeights[i] * xStd[i];
    }
    return clamp(sigmoid(z), 0.001, 0.999);
  }

  let zLr = tm.logisticBias;
  for (let i = 0; i < tm.logisticWeights.length; i++) {
    zLr += tm.logisticWeights[i] * xStd[i];
  }
  const pLr = sigmoid(zLr);

  let zGb = tm.gbdtInit;
  for (const tree of tm.gbdtTrees) {
    zGb += tm.gbdtLr * evalGbdtTree(tree, xStd);
  }
  const pGb = sigmoid(zGb);

  const pMix = clamp(
    tm.blendWeight * pLr + (1.0 - tm.blendWeight) * pGb,
    1e-4,
    1.0 - 1e-4
  );
  const logitMix = safeLogit(pMix);
  const pCalibrated = sigmoid(tm.plattA * logitMix + tm.plattB);

  return clamp(pCalibrated, 0.001, 0.999);
}

export type FeatureMap = Record<TargetName, number[]>;
export type PredictionProbabilities = Record<TargetName, number> & { GOALS_U25: number };

export function predictMatchProbabilities(
  featuresByTarget: FeatureMap,
  hasMarketOdds: boolean
): PredictionProbabilities {
  const GOALS_O15 = predictSingleTarget("GOALS_O15", featuresByTarget.GOALS_O15, hasMarketOdds);
  const GOALS_O25 = predictSingleTarget("GOALS_O25", featuresByTarget.GOALS_O25, hasMarketOdds);
  const CORNERS_O65 = predictSingleTarget("CORNERS_O65", featuresByTarget.CORNERS_O65, hasMarketOdds);
  const CORNERS_O75 = predictSingleTarget("CORNERS_O75", featuresByTarget.CORNERS_O75, hasMarketOdds);
  const DC_1X = predictSingleTarget("DC_1X", featuresByTarget.DC_1X, hasMarketOdds);
  const DC_X2 = predictSingleTarget("DC_X2", featuresByTarget.DC_X2, hasMarketOdds);

  return {
    GOALS_O15: Number(GOALS_O15.toFixed(6)),
    GOALS_O25: Number(GOALS_O25.toFixed(6)),
    GOALS_U25: Number((1.0 - GOALS_O25).toFixed(6)),
    CORNERS_O65: Number(CORNERS_O65.toFixed(6)),
    CORNERS_O75: Number(CORNERS_O75.toFixed(6)),
    DC_1X: Number(DC_1X.toFixed(6)),
    DC_X2: Number(DC_X2.toFixed(6)),
  };
}
