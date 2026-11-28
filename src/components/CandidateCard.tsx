"use client";

import { useState } from "react";
import { CandidateResult, MarketKey, PickResult } from "@/lib/predictorEngine";
import {
  IoFootball,
  IoFlag,
  IoShieldHalf,
  IoChevronDown,
  IoChevronUp,
  IoTimeOutline,
  IoCheckmarkDone,
  IoWarningOutline,
} from "react-icons/io5";

interface CandidateCardProps {
  candidate: CandidateResult;
  activeFilter: "VALUE_150" | "VALUE" | "ALL" | "GOALS" | "CORNERS" | "DC";
  onOddsSaved?: () => void;
}

function formatMarketLabel(pick: PickResult): string {
  switch (pick.market) {
    case "GOALS_O15":
      return "Goles: Over 1.5";
    case "GOALS_OU25":
      return `Goles: ${pick.selection} 2.5`;
    case "CORNERS_OU":
      return `Córneres: Over ${pick.line}`;
    case "CORNERS_O85":
      return "Córneres 1.50+: Over 8.5";
    case "COMBO_DC_O15":
      return pick.selection === "1X_O15"
        ? "Combo 1.50+: 1X + Over 1.5 Goles"
        : "Combo 1.50+: X2 + Over 1.5 Goles";
    case "TEAM_O15":
      return "Equipo 1.50+: Local Over 1.5 Goles";
    case "HOME_WIN":
      return "1X2 1.50+: Gana Local";
    case "HT_O05":
      return "1er Tiempo: Más de 0.5 Goles (45 min)";
    case "DOUBLE_CHANCE":
      return `Doble Oportunidad: ${pick.selection}`;
  }
}

function MarketIcon({ market }: { market: MarketKey }) {
  if (
    market === "GOALS_O15" ||
    market === "GOALS_OU25" ||
    market === "TEAM_O15" ||
    market === "HT_O05"
  ) {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#004D98] to-[#002f60] text-[#EDBB00] border border-blue-400/30 shadow shrink-0">
        <IoFootball className="w-5 h-5" />
      </div>
    );
  }
  if (market === "CORNERS_OU" || market === "CORNERS_O85") {
    return (
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#A50044] to-[#600027] text-[#EDBB00] border border-rose-400/30 shadow shrink-0">
        <IoFlag className="w-5 h-5" />
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-emerald-700 to-teal-900 text-[#EDBB00] border border-emerald-400/30 shadow shrink-0">
      <IoShieldHalf className="w-5 h-5" />
    </div>
  );
}

function TierBadge({ pick }: { pick: PickResult }) {
  if (pick.tier === "TIER_S") {
    return (
      <span className="glass-badge-gold px-2.5 py-1 text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1">
        💎 Tier S &bull; Máx. Seguridad
      </span>
    );
  }
  if (pick.tier === "TIER_A") {
    return (
      <span className="px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1">
        🟢 Tier A &bull; Segura
      </span>
    );
  }
  return (
    <span className="glass-badge-nobet px-2.5 py-1 text-[10px] uppercase tracking-wider">
      Descartar
    </span>
  );
}

export default function CandidateCard({
  candidate,
  activeFilter,
  onOddsSaved,
}: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [customOddsMap, setCustomOddsMap] = useState<Record<number, string>>({});
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<Record<number, boolean>>({});

  const hasTierS = candidate.picks.some((p) => p.tier === "TIER_S");
  const hasBet = candidate.picks.some((p) => p.decision === "BET");

  const displayedPicks = candidate.picks.filter((p) => {
    if (activeFilter === "VALUE_150") {
      return (
        p.decision === "BET" &&
        (p.market === "HOME_WIN" ||
          p.market === "COMBO_DC_O15" ||
          p.market === "TEAM_O15" ||
          p.market === "CORNERS_O85" ||
          p.market === "GOALS_OU25" ||
          p.market === "HT_O05")
      );
    }
    if (activeFilter === "VALUE") return p.decision === "BET";
    if (activeFilter === "GOALS") {
      return (
        p.market === "GOALS_O15" ||
        p.market === "GOALS_OU25" ||
        p.market === "TEAM_O15" ||
        p.market === "COMBO_DC_O15" ||
        p.market === "HT_O05"
      );
    }
    if (activeFilter === "CORNERS") return p.market === "CORNERS_OU" || p.market === "CORNERS_O85";
    if (activeFilter === "DC") {
      return (
        p.market === "DOUBLE_CHANCE" ||
        p.market === "COMBO_DC_O15" ||
        p.market === "HOME_WIN"
      );
    }
    return true;
  });

  const handleSaveCustomOdds = async (pick: PickResult, idx: number, oddsNum: number) => {
    if (!pick.id || oddsNum <= 1.01) return;
    setSavingIdx(idx);
    try {
      const res = await fetch("/api/picks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickId: pick.id, odds: oddsNum }),
      });
      if (res.ok) {
        setSavedIdx((prev) => ({ ...prev, [idx]: true }));
        onOddsSaved?.();
      }
    } finally {
      setSavingIdx(null);
    }
  };

  const sampleStats = candidate.picks[0]?.reasoning?.teamStats;
  const goalsReasoning = candidate.picks.find((p) => p.market === "GOALS_O15")?.reasoning;
  const cornersReasoning = candidate.picks.find((p) => p.market === "CORNERS_OU")?.reasoning;
  const shortSample =
    sampleStats && (sampleStats.homeSampleCount < 10 || sampleStats.awaySampleCount < 10);

  return (
    <div
      className={
        hasTierS
          ? "clay-glass-card-active p-4 md:p-5 transition-all"
          : "clay-glass-card p-4 md:p-5 transition-all"
      }
    >
      {/* Cabecera */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 mb-3.5 pb-3 border-b border-white/10">
        <div>
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="px-2 py-0.5 text-[10px] font-black rounded-lg bg-[#004D98]/40 text-blue-200 border border-[#004D98]/60 uppercase tracking-wide">
              {candidate.leagueFlag} {candidate.leagueName}
            </span>
            <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
              <IoTimeOutline className="w-3.5 h-3.5" />
              {candidate.date} &bull;{" "}
              {new Date(candidate.kickoffUtc).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {candidate.referee && (
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-900/70 text-slate-400 border border-slate-800">
                Árb: {candidate.referee}
              </span>
            )}
            {shortSample && (
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold inline-flex items-center gap-1">
                <IoWarningOutline className="w-3 h-3" />
                Muestra corta ({sampleStats.homeSampleCount}/{sampleStats.awaySampleCount} PJ)
              </span>
            )}
            {candidate.actualResult && (
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black">
                Final: {candidate.actualResult.fthg}-{candidate.actualResult.ftag}
                {candidate.actualResult.hc !== null && candidate.actualResult.ac !== null
                  ? ` • ${candidate.actualResult.hc + candidate.actualResult.ac} Córneres`
                  : ""}
              </span>
            )}
          </div>

          <h3 className="text-base md:text-lg font-black text-white flex flex-wrap items-center gap-2">
            <span>{candidate.homeTeam}</span>
            <span className="text-[#A50044] font-black text-[10px] px-1.5 py-0.5 rounded bg-[#A50044]/20 border border-[#A50044]/40">
              VS
            </span>
            <span>{candidate.awayTeam}</span>
          </h3>
        </div>

        {/* Cuotas de referencia en vivo */}
        {candidate.marketOdds.hasMarketOdds ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
            <span className="px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-700/60 text-slate-300">
              1X2:{" "}
              <strong className="text-white">
                {candidate.marketOdds.oddsH} / {candidate.marketOdds.oddsD} /{" "}
                {candidate.marketOdds.oddsA}
              </strong>
            </span>
            {candidate.marketOdds.oddsO25 && candidate.marketOdds.oddsU25 && (
              <span className="px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-700/60 text-slate-300">
                O/U 2.5:{" "}
                <strong className="text-[#EDBB00]">
                  {candidate.marketOdds.oddsO25} / {candidate.marketOdds.oddsU25}
                </strong>
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900/70 text-slate-400 border border-slate-800 self-start">
            Sin cuotas de mercado aún
          </span>
        )}
      </div>

      {/* Picks */}
      <div className="space-y-2.5 mb-3">
        {displayedPicks.map((pick, idx) => {
          const customInput = customOddsMap[idx] ?? "";
          const parsedCustomOdds = Number(customInput);
          const customEv =
            pick.odds <= 1.01 && Number.isFinite(parsedCustomOdds) && parsedCustomOdds > 1.01
              ? pick.probability * parsedCustomOdds - 1.0
              : null;

          return (
            <div
              key={`${pick.market}-${idx}`}
              className={`p-3 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 transition-all ${
                pick.decision === "BET"
                  ? "bg-gradient-to-r from-[#004D98]/25 via-[#151c2a]/85 to-[#A50044]/20 border border-[#EDBB00]/35"
                  : "bg-slate-900/45 border border-slate-800/50 opacity-75"
              }`}
            >
              <div className="flex items-start sm:items-center gap-3">
                <MarketIcon market={pick.market} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-black text-white">
                      {formatMarketLabel(pick)}
                    </span>
                    <TierBadge pick={pick} />
                    {(pick.market === "HOME_WIN" ||
                      pick.market === "GOALS_OU25" ||
                      pick.market === "COMBO_DC_O15" ||
                      pick.market === "TEAM_O15" ||
                      pick.market === "CORNERS_O85" ||
                      pick.market === "HT_O05") &&
                      pick.decision === "BET" && (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-400/40 text-[10px] font-black">
                          {pick.market === "HT_O05" ? "⚡ Gol 45 min" : "🔥 Cuota 1.50+"}
                        </span>
                      )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-slate-300 mt-1">
                    <span>
                      Prob. Real:{" "}
                      <strong className="text-white font-black">
                        {(pick.probability * 100).toFixed(1)}%
                      </strong>
                    </span>
                    <span>
                      Simulación:{" "}
                      <strong className="text-blue-300 font-bold">
                        {(pick.mcProbability * 100).toFixed(1)}%
                      </strong>
                    </span>
                    {pick.odds > 1.01 ? (
                      <>
                        <span>
                          Cuota ref.:{" "}
                          <strong className="text-[#EDBB00] font-black">{pick.odds}</strong>
                        </span>
                        <span
                          className={`font-black ${
                            pick.ev > 0 ? "text-emerald-400" : "text-slate-400"
                          }`}
                        >
                          Valor: {pick.ev >= 0 ? "+" : ""}
                          {(pick.ev * 100).toFixed(1)}%
                        </span>
                      </>
                    ) : (
                      <span>
                        Cuota buena:{" "}
                        <strong className="text-[#EDBB00] font-black">
                          &ge; {pick.minOdds}
                        </strong>{" "}
                        <span className="text-slate-500">(Justa {pick.fairOdds})</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Validador rápido de cuota de la casa (sin gestión de dinero) */}
              {pick.odds <= 1.01 && pick.decision === "BET" && (
                <div className="flex flex-wrap items-center gap-2 bg-slate-950/70 px-3 py-1.5 rounded-xl border border-slate-800">
                  <label className="text-[11px] text-slate-400 font-semibold">
                    ¿Tu cuota?
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1.02"
                    placeholder={`${pick.minOdds}`}
                    value={customInput}
                    onChange={(e) =>
                      setCustomOddsMap((prev) => ({ ...prev, [idx]: e.target.value }))
                    }
                    className="w-16 px-2 py-1 text-xs font-bold bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-[#EDBB00]"
                  />
                  {customEv !== null && (
                    <span
                      className={`text-[11px] font-black ${
                        customEv > 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {customEv > 0
                        ? `✅ Buena (+${(customEv * 100).toFixed(1)}%)`
                        : "⚠️ Muy baja"}
                    </span>
                  )}
                  {pick.id && parsedCustomOdds > 1.01 && (
                    <button
                      onClick={() => handleSaveCustomOdds(pick, idx, parsedCustomOdds)}
                      disabled={savingIdx === idx}
                      className="px-2 py-1 rounded-lg bg-[#004D98] hover:bg-blue-700 text-white text-[10px] font-bold flex items-center gap-1"
                    >
                      {savedIdx[idx] ? (
                        <>
                          <IoCheckmarkDone className="w-3 h-3 text-emerald-300" />
                          Guardada
                        </>
                      ) : savingIdx === idx ? (
                        "..."
                      ) : (
                        "Guardar"
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {displayedPicks.length === 0 && (
          <div className="p-3 rounded-xl bg-slate-900/35 border border-slate-800/40 text-center text-xs text-slate-400">
            {hasBet
              ? "Ningún pick de este partido coincide con el filtro actual."
              : "Descartado: ningún mercado cumple el umbral mínimo de seguridad."}
          </div>
        )}
      </div>

      {/* Desplegable de estadísticas reales */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full py-1.5 text-xs font-bold text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
      >
        <span>
          {expanded ? "Ocultar estadísticas reales" : "Ver estadísticas reales del partido"}
        </span>
        {expanded ? (
          <IoChevronUp className="w-4 h-4 text-[#EDBB00]" />
        ) : (
          <IoChevronDown className="w-4 h-4 text-[#EDBB00]" />
        )}
      </button>

      {expanded && sampleStats && (
        <div className="mt-2.5 p-3.5 rounded-2xl bg-slate-950/85 border border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
          <div className="space-y-1">
            <div className="text-[#EDBB00] font-black uppercase tracking-wider text-[10px]">
              ⚽ Goles y Remates (Local vs Visita)
            </div>
            <p className="text-slate-300">
              <strong className="text-white">{candidate.homeTeam} (Local):</strong>{" "}
              {sampleStats.homeGoalsFor} GF / {sampleStats.homeGoalsAgainst} GC &bull;{" "}
              {sampleStats.homeSotFor} tiros al arco ({sampleStats.homeSampleCount} PJ)
            </p>
            <p className="text-slate-300">
              <strong className="text-white">{candidate.awayTeam} (Visita):</strong>{" "}
              {sampleStats.awayGoalsFor} GF / {sampleStats.awayGoalsAgainst} GC &bull;{" "}
              {sampleStats.awaySotFor} tiros al arco ({sampleStats.awaySampleCount} PJ)
            </p>
            {goalsReasoning && (
              <p className="text-slate-400 pt-0.5">
                Proyección: <strong className="text-white">{goalsReasoning.lambdaTotal} goles</strong>{" "}
                ({goalsReasoning.lambdaHome} - {goalsReasoning.lambdaAway}) &bull; Riesgo 0-0:{" "}
                <strong className="text-amber-300">
                  {(goalsReasoning.p00Risk * 100).toFixed(1)}%
                </strong>
              </p>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[#EDBB00] font-black uppercase tracking-wider text-[10px]">
              🚩 Córneres Reales (Local vs Visita)
            </div>
            <p className="text-slate-300">
              <strong className="text-white">{candidate.homeTeam} (Local):</strong>{" "}
              {sampleStats.homeCornersFor} a favor / {sampleStats.homeCornersAgainst} en contra
            </p>
            <p className="text-slate-300">
              <strong className="text-white">{candidate.awayTeam} (Visita):</strong>{" "}
              {sampleStats.awayCornersFor} a favor / {sampleStats.awayCornersAgainst} en contra
            </p>
            {cornersReasoning && (
              <p className="text-slate-400 pt-0.5">
                Proyección:{" "}
                <strong className="text-white">
                  {cornersReasoning.lambdaCornersTotal} córneres
                </strong>{" "}
                ({cornersReasoning.lambdaCornersHome} + {cornersReasoning.lambdaCornersAway}) &bull;
                O1.5 + O6.5C simultáneo:{" "}
                <strong className="text-emerald-300">
                  {(cornersReasoning.jointO15AndC65 * 100).toFixed(1)}%
                </strong>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
