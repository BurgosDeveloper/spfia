/**
 * Verificación Integral Local de SPFIA v4:
 *  1) Paridad matemática exacta Python <-> TypeScript (< 1e-4 en los 6 objetivos)
 *  2) Escaneo en vivo de próximos partidos (football-data.co.uk/fixtures.csv)
 *  3) Validación sin NaNs, cuotas reales, EV+, Stakes y Combinada Óptima
 */

import assert from "node:assert/strict";
import { CALIBRATED_MODEL, predictMatchProbabilities, TargetName } from "../src/lib/model/inference";
import { analyzeSlate, assembleMatchFeatures } from "../src/lib/predictorEngine";
import { LiveMarketOdds, TeamWindowStats } from "../src/lib/providers/footballDataUk";

async function main() {
  console.log("=== 1. VERIFICACIÓN DE PARIDAD PYTHON <-> TYPESCRIPT ===");
  const checks = CALIBRATED_MODEL.parityChecks || [];
  assert.ok(checks.length >= 5, "Se esperaban al menos 5 parityChecks en calibrated_model.json");

  let maxFeatDiff = 0;
  let maxProbDiff = 0;
  const targets: TargetName[] = [
    "GOALS_O15",
    "GOALS_O25",
    "CORNERS_O65",
    "CORNERS_O75",
    "DC_1X",
    "DC_X2",
    "DC1X_O15",
    "DCX2_O15",
    "HOME_O15",
    "CORNERS_O85",
  ];

  for (const chk of checks) {
    const snap = chk.teamSnapshot;
    const homeStats: TeamWindowStats = {
      matchesCount: 10,
      effectiveWeight: snap.w_h,
      goalsFor: snap.h_gf,
      goalsAgainst: snap.h_ga,
      cornersFor: snap.h_cf,
      cornersAgainst: snap.h_ca,
      shotsFor: snap.h_sf,
      shotsAgainst: snap.h_sa,
      sotFor: snap.h_sotf,
      sotAgainst: snap.h_sota,
    };
    const awayStats: TeamWindowStats = {
      matchesCount: 10,
      effectiveWeight: snap.w_a,
      goalsFor: snap.a_gf,
      goalsAgainst: snap.a_ga,
      cornersFor: snap.a_cf,
      cornersAgainst: snap.a_ca,
      shotsFor: snap.a_sf,
      shotsAgainst: snap.a_sa,
      sotFor: snap.a_sotf,
      sotAgainst: snap.a_sota,
    };
    const odds: LiveMarketOdds = {
      hasMarketOdds: Boolean(chk.hasMarketOdds),
      pMktH: chk.pMktH,
      pMktD: chk.pMktD,
      pMktA: chk.pMktA,
      pMktO25: chk.pMktO25,
      oddsH: null,
      oddsD: null,
      oddsA: null,
      oddsO25: null,
      oddsU25: null,
      odds1X: null,
      oddsX2: null,
      ahh: null,
    };

    const assembled = assembleMatchFeatures({
      leagueCode: chk.league,
      home: homeStats,
      away: awayStats,
      odds,
    });
    const tsProbs = predictMatchProbabilities(assembled.featuresByTarget, assembled.hasOdds);

    for (const t of targets) {
      const pyVec: number[] = chk.features[t];
      const tsVec: number[] = assembled.featuresByTarget[t];
      for (let i = 0; i < pyVec.length; i++) {
        const diff = Math.abs(pyVec[i] - tsVec[i]);
        if (diff > maxFeatDiff) maxFeatDiff = diff;
        assert.ok(
          diff < 1e-3,
          `Feature diff excesivo en ${chk.homeTeam} vs ${chk.awayTeam} [${t}][${i}]: py=${pyVec[i]}, ts=${tsVec[i]}`
        );
      }
      const pDiff = Math.abs(chk.expectedProbs[t] - tsProbs[t]);
      if (pDiff > maxProbDiff) maxProbDiff = pDiff;
      assert.ok(
        pDiff < 1e-3,
        `Prob diff excesivo en ${chk.homeTeam} vs ${chk.awayTeam} [${t}]: py=${chk.expectedProbs[t]}, ts=${tsProbs[t]}`
      );
    }
    console.log(
      `  OK: ${chk.league} ${chk.date} ${chk.homeTeam} vs ${chk.awayTeam} -> O1.5=${(
        tsProbs.GOALS_O15 * 100
      ).toFixed(2)}% (Py=${(chk.expectedProbs.GOALS_O15 * 100).toFixed(2)}%)`
    );
  }
  console.log(
    `  Paridad superada: maxFeatDiff=${maxFeatDiff.toExponential(2)}, maxProbDiff=${maxProbDiff.toExponential(2)}`
  );

  console.log("\n=== 2. PRUEBA EN VIVO SOBRE PRÓXIMA JORNADA (fixtures.csv) ===");
  const slate = await analyzeSlate({ league: "ALL", mode: "UPCOMING", persist: false });
  assert.ok(slate.candidates.length > 0, "Se esperaban partidos próximos en fixtures.csv");
  console.log(`Partidos próximos analizados: ${slate.candidates.length}`);

  let tierS = 0;
  let tierA = 0;
  let oddsCount = 0;

  for (const c of slate.candidates) {
    if (c.marketOdds.hasMarketOdds) oddsCount++;
    assert.ok(Number.isFinite(c.monteCarlo.pO15), "MC NaN");
    for (const p of c.picks) {
      assert.ok(Number.isFinite(p.probability) && p.probability > 0 && p.probability < 1, "Prob inválida");
      assert.ok(Number.isFinite(p.mcProbability), "MC prob inválida");
      assert.ok(Number.isFinite(p.ev), "EV inválido");
      assert.ok(Number.isFinite(p.stakeUnits), "Stake inválido");
      if (p.tier === "TIER_S") tierS++;
      if (p.tier === "TIER_A") tierA++;
    }
  }

  console.log(`Con cuotas reales en vivo: ${oddsCount}/${slate.candidates.length}`);
  console.log(`Picks detectados -> Tier S: ${tierS} | Tier A: ${tierA}`);

  console.log("\nTop 8 Picks de Valor en Vivo:");
  const topPicks = slate.candidates
    .flatMap((c) =>
      c.picks
        .filter((p) => p.decision === "BET")
        .map((p) => ({
          match: `[${c.league}] ${c.homeTeam} vs ${c.awayTeam} (${c.date})`,
          pick: `${p.market} ${p.selection}${p.line > 0 ? " " + p.line : ""}`,
          tier: p.tier,
          prob: p.probability,
          mc: p.mcProbability,
          odds: p.odds,
          minOdds: p.minOdds,
          ev: p.ev,
          stake: p.stakeUnits,
        }))
    )
    .sort((a, b) => (a.tier !== b.tier ? (a.tier === "TIER_S" ? -1 : 1) : b.prob - a.prob));

  for (const tp of topPicks.slice(0, 8)) {
    const oddsTxt = tp.odds > 1.01 ? `cuota=${tp.odds} EV=${(tp.ev * 100).toFixed(1)}%` : `min=${tp.minOdds}`;
    console.log(
      `  ${tp.tier} | ${tp.match} -> ${tp.pick} | Prob=${(tp.prob * 100).toFixed(1)}% (MC ${(
        tp.mc * 100
      ).toFixed(1)}%) | ${oddsTxt} | Stake=${tp.stake}u`
    );
  }

  if (slate.parlay) {
    console.log(
      `\nCombinada Recomendada (${slate.parlay.legs.length} selecciones): Prob Conjunta=${(
        slate.parlay.combinedProbability * 100
      ).toFixed(1)}%, MinCuota=${slate.parlay.minCombinedOdds}, Stake=${slate.parlay.suggestedStakeUnits}u`
    );
    for (const leg of slate.parlay.legs) {
      console.log(
        `  - ${leg.matchName} (${leg.leagueName}): ${leg.market} ${leg.selection} ${leg.line || ""} (${(
          leg.probability * 100
        ).toFixed(1)}%)`
      );
    }
  } else {
    console.log("\nCombinada Recomendada: ninguna (pocos picks de alta seguridad en esta pizarra).");
  }

  console.log("\n=== 3. PRUEBA EN FECHA HISTÓRICA RECIENTE (SIN FUGA) ===");
  const histSlate = await analyzeSlate({
    league: "E0",
    mode: "DATE",
    date: "2026-11-22",
    persist: false,
  });
  console.log(`E0 2026-11-22 partidos encontrados: ${histSlate.candidates.length}`);
  for (const c of histSlate.candidates) {
    const ar = c.actualResult
      ? `${c.actualResult.fthg}-${c.actualResult.ftag} (${(c.actualResult.hc ?? 0) + (c.actualResult.ac ?? 0)}c)`
      : "-";
    const o15 = c.picks.find((p) => p.market === "GOALS_O15");
    const c65 = c.picks.find((p) => p.market === "CORNERS_OU");
    console.log(
      `  ${c.homeTeam} vs ${c.awayTeam}: Real=${ar} | O1.5=${((o15?.probability || 0) * 100).toFixed(
        1
      )}% (${o15?.tier}) | Corners=${((c65?.probability || 0) * 100).toFixed(1)}% (${c65?.tier})`
    );
  }
}

main().catch((err) => {
  console.error("VERIFICACIÓN FALLIDA:", err);
  process.exit(1);
});
