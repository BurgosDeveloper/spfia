"use client";

import { useState } from "react";
import { CandidateResult } from "@/lib/predictorEngine";
import {
  IoFootball,
  IoFlag,
  IoCheckmarkCircle,
  IoWarning,
  IoChevronDown,
  IoChevronUp,
  IoPeople,
  IoTimeOutline,
} from "react-icons/io5";

interface CandidateCardProps {
  candidate: CandidateResult;
  activeFilter?: "ALL" | "BET" | "GOALS" | "CORNERS";
}

export default function CandidateCard({ candidate, activeFilter = "ALL" }: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasBet = candidate.picks.some((p) => p.decision === "BET");

  // Filtrado de picks a mostrar según la pestaña seleccionada
  const displayedPicks = candidate.picks.filter((p) => {
    if (activeFilter === "BET") return p.decision === "BET";
    if (activeFilter === "GOALS") return p.market === "GOALS_OU";
    if (activeFilter === "CORNERS") return p.market === "CORNERS_OU";
    return true;
  });

  return (
    <div
      className={hasBet ? "clay-glass-card-active p-5 md:p-6 transition-all" : "clay-glass-card p-5 md:p-6 transition-all"}
    >
      {/* Encabezado del Partido */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2.5 py-0.5 text-[11px] font-black rounded-lg bg-[#004D98]/40 text-blue-200 border border-[#004D98]/60 uppercase tracking-wide backdrop-blur-md">
              {candidate.leagueName}
            </span>
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
              <IoTimeOutline className="w-3.5 h-3.5" />
              {new Date(candidate.kickoffUtc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC
            </span>
          </div>

          <h3 className="text-lg md:text-xl font-black text-white flex items-center gap-2.5">
            <span className="text-slate-100">{candidate.homeTeam}</span>
            <span className="text-[#A50044] font-black text-sm px-1.5 py-0.5 rounded-md bg-[#A50044]/20 border border-[#A50044]/40">
              VS
            </span>
            <span className="text-slate-100">{candidate.awayTeam}</span>
          </h3>
        </div>

        {/* Estado de Alineaciones */}
        <div className="flex items-center gap-2">
          {candidate.lineupStatus.status === "CONFIRMED" ? (
            <span className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-black backdrop-blur-md">
              <IoPeople className="w-4 h-4 text-emerald-400" /> Alineaciones Confirmadas (100%)
            </span>
          ) : candidate.lineupStatus.status === "AVAILABLE_PARTIAL" ? (
            <span className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-black backdrop-blur-md">
              <IoPeople className="w-4 h-4 text-amber-400" /> Alineación Parcial (96%)
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900/60 text-slate-400 text-xs font-semibold border border-slate-800 backdrop-blur-md">
              <IoPeople className="w-4 h-4 text-slate-500" /> Pre-Alineaciones (92%)
            </span>
          )}
        </div>
      </div>

      {/* Lista de Pronósticos (Filtrados por la Pestaña Activa) */}
      <div className="space-y-4 mb-4">
        {displayedPicks.map((pick, idx) => (
          <div
            key={idx}
            className={`p-4 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-all ${
              pick.decision === "BET"
                ? "bg-gradient-to-r from-[#004D98]/25 via-[#151c2a]/80 to-[#A50044]/25 border border-[#EDBB00]/40 shadow-xl backdrop-blur-md"
                : "bg-slate-900/40 border border-slate-800/40 opacity-80"
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black shadow-md border ${
                  pick.market === "GOALS_OU"
                    ? "bg-gradient-to-br from-[#004D98] to-[#002f60] text-[#EDBB00] border-blue-400/30"
                    : "bg-gradient-to-br from-[#A50044] to-[#600027] text-[#EDBB00] border-rose-400/30"
                }`}
              >
                {pick.market === "GOALS_OU" ? (
                  <IoFootball className="w-6 h-6" />
                ) : (
                  <IoFlag className="w-6 h-6" />
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-black text-white">
                    {pick.market === "GOALS_OU" ? "GOLES:" : "CÓRNERES:"} {pick.selection} {pick.line}
                  </span>
                  <span className="text-xs px-2.5 py-0.5 rounded-lg bg-slate-900/80 text-slate-300 font-bold border border-slate-700/60">
                    Umbral: {(pick.threshold * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="flex items-center gap-3.5 text-xs text-slate-400 mt-1.5 font-medium">
                  <span>
                    Prob: <strong className="text-white font-bold">{(pick.probability * 100).toFixed(1)}%</strong>
                  </span>
                  <span>
                    Lím. Inf ($P_{"{low}"}$): <strong className="text-[#EDBB00] font-black">{(pick.pLower * 100).toFixed(1)}%</strong>
                  </span>
                  <span>
                    Estabilidad: <strong className="text-blue-300 font-bold">{(pick.stability * 100).toFixed(1)}%</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Badge Decisión */}
            <div>
              {pick.decision === "BET" ? (
                <div className="glass-badge-gold px-4 py-2.5 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <IoCheckmarkCircle className="w-5 h-5 text-[#07090e]" />
                  <span>APOSTAR (BET)</span>
                </div>
              ) : (
                <div className="glass-badge-nobet px-4 py-2 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <IoWarning className="w-4 h-4 text-slate-500" />
                  <span>NO APOSTAR</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {displayedPicks.length === 0 && (
          <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/40 text-center text-xs text-slate-400">
            No hay selecciones en este partido bajo el filtro actual.
          </div>
        )}
      </div>

      {/* Botón para expandir detalles técnicos */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full py-2.5 text-xs font-bold text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
      >
        <span>{expanded ? "Ocultar Análisis Estadístico" : "Ver Análisis Estadístico Detallado"}</span>
        {expanded ? <IoChevronUp className="w-4 h-4 text-[#EDBB00]" /> : <IoChevronDown className="w-4 h-4 text-[#EDBB00]" />}
      </button>

      {/* Detalles desplegables */}
      {expanded && (
        <div className="mt-4 p-4 rounded-2xl bg-slate-950/90 border border-slate-800/80 text-xs space-y-3 font-mono backdrop-blur-lg">
          {displayedPicks.map((p, i) => (
            <div key={i} className="border-b border-slate-800/60 pb-2.5 last:border-0">
              <div className="text-slate-200 font-bold mb-1 flex items-center gap-1.5">
                <span className="text-[#EDBB00]">▶</span> {p.market} {p.selection} {p.line} Reasoning:
              </div>
              <pre className="text-slate-400 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(p.reasoning, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
