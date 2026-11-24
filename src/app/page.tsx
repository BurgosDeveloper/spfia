"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import CandidateCard from "@/components/CandidateCard";
import { CandidateResult, ParlayRecommendation } from "@/lib/predictorEngine";
import { VERIFIED_LEAGUES } from "@/lib/providers/footballDataUk";
import {
  IoPlay,
  IoCalendarOutline,
  IoRefreshOutline,
  IoTrophyOutline,
  IoSparkles,
  IoStatsChart,
  IoLayers,
  IoCheckmarkDoneCircle,
  IoShieldCheckmark,
} from "react-icons/io5";

type MainTab = "PICKS" | "HISTORY";
type PickFilter = "VALUE" | "ALL" | "GOALS" | "CORNERS" | "DC";
type DateViewMode = "TODAY" | "UPCOMING" | "DATE";

function getLocalTodayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("PICKS");

  // Controles de escaneo (Por defecto: Hoy en todas las ligas)
  const [selectedLeague, setSelectedLeague] = useState("ALL");
  const [dateViewMode, setDateViewMode] = useState<DateViewMode>("TODAY");
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalTodayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Resultados
  const [candidates, setCandidates] = useState<CandidateResult[]>([]);
  const [parlay, setParlay] = useState<ParlayRecommendation | null>(null);
  const [sourceInfo, setSourceInfo] = useState("");
  const [nextAvailableDate, setNextAvailableDate] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<PickFilter>("VALUE");
  const [parlayHouseOdds, setParlayHouseOdds] = useState("");
  const [hasScannedOnce, setHasScannedOnce] = useState(false);

  // Historial & Backtest
  const [historyData, setHistoryData] = useState<any>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState("");

  const autoRanRef = useRef(false);

  useEffect(() => {
    if (localStorage.getItem("spfia_logged") === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const loadHistoryAndBacktest = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/picks?decision=BET");
      const data = await res.json();
      if (res.ok && data.ok) {
        setHistoryData(data);
      }
    } catch {
      // Silencioso en modo offline
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const runPrediction = useCallback(
    async (
      overrideMode?: DateViewMode,
      overrideDate?: string,
      overrideLeague?: string
    ) => {
      const activeMode = overrideMode ?? dateViewMode;
      const activeLeague = overrideLeague ?? selectedLeague;
      const effectiveDate =
        activeMode === "TODAY"
          ? getLocalTodayIso()
          : activeMode === "DATE"
            ? overrideDate ?? selectedDate
            : undefined;
      const apiMode = activeMode === "UPCOMING" ? "UPCOMING" : "DATE";

      setLoading(true);
      setError("");
      setHasScannedOnce(true);

      try {
        const res = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            league: activeLeague,
            mode: apiMode,
            date: effectiveDate,
          }),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          setCandidates(data.candidates || []);
          setParlay(data.parlay || null);
          setSourceInfo(data.sourceInfo || "");
          setNextAvailableDate(data.nextAvailableDate || null);
        } else {
          setError(data.error || "No se pudo completar el análisis.");
        }
      } catch {
        setError("Error de conexión con el servidor.");
      } finally {
        setLoading(false);
      }
    },
    [dateViewMode, selectedDate, selectedLeague]
  );

  // Auto-escanear al entrar autenticado
  useEffect(() => {
    if (isAuthenticated && !autoRanRef.current) {
      autoRanRef.current = true;
      void runPrediction("TODAY");
      void loadHistoryAndBacktest();
    }
  }, [isAuthenticated, runPrediction, loadHistoryAndBacktest]);

  const handleSettle = async () => {
    setSettling(true);
    setSettleMsg("");
    try {
      const res = await fetch("/api/settle", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSettleMsg(
          data.settledCount > 0
            ? `Se liquidaron ${data.settledCount} picks con resultados reales (${data.pendingCount} pendientes).`
            : `Todos los partidos finalizados ya están al día (${data.pendingCount} pendientes).`
        );
        await loadHistoryAndBacktest();
      } else {
        setSettleMsg(data.error || "No se pudo liquidar en este momento.");
      }
    } catch {
      setSettleMsg("Error de red al liquidar resultados.");
    } finally {
      setSettling(false);
    }
  };

  const handleLoginSuccess = () => {
    localStorage.setItem("spfia_logged", "true");
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("spfia_logged");
    autoRanRef.current = false;
    setIsAuthenticated(false);
  };

  const allPicks = candidates.flatMap((c) => c.picks);
  const tierSCount = allPicks.filter((p) => p.tier === "TIER_S").length;
  const tierACount = allPicks.filter((p) => p.tier === "TIER_A").length;
  const valueMatches = candidates.filter((c) => c.picks.some((p) => p.decision === "BET"));

  const filteredCandidates = candidates.filter((c) => {
    if (activeFilter === "VALUE") return c.picks.some((p) => p.decision === "BET");
    return true;
  });

  const parlayOddsNum = Number(parlayHouseOdds);
  const parlayEv =
    parlay && Number.isFinite(parlayOddsNum) && parlayOddsNum > 1.01
      ? parlay.combinedProbability * parlayOddsNum - 1.0
      : null;

  return (
    <main className="min-h-screen pb-24 md:pb-16 px-4 md:px-8 max-w-5xl mx-auto w-full relative z-10">
      <div className="ambient-barca-bg" />

      {!isAuthenticated && <LoginModal onSuccess={handleLoginSuccess} />}

      <Header
        onLogout={handleLogout}
        dbConnected={historyData ? historyData.dbConnected !== false : true}
      />

      {/* Navegación Desktop */}
      <div className="hidden md:flex items-center gap-2 mb-5">
        <button
          onClick={() => setMainTab("PICKS")}
          className={`px-4 py-2.5 rounded-2xl text-sm font-black flex items-center gap-2 transition-all ${
            mainTab === "PICKS"
              ? "bg-gradient-to-r from-[#004D98] to-[#A50044] text-white shadow-lg border border-white/20"
              : "clay-glass-card text-slate-400 hover:text-white"
          }`}
        >
          <IoSparkles className="w-4 h-4 text-[#EDBB00]" />
          <span>Picks de Seguridad</span>
        </button>

        <button
          onClick={() => {
            setMainTab("HISTORY");
            void loadHistoryAndBacktest();
          }}
          className={`px-4 py-2.5 rounded-2xl text-sm font-black flex items-center gap-2 transition-all ${
            mainTab === "HISTORY"
              ? "bg-gradient-to-r from-[#004D98] to-[#A50044] text-white shadow-lg border border-white/20"
              : "clay-glass-card text-slate-400 hover:text-white"
          }`}
        >
          <IoStatsChart className="w-4 h-4 text-[#EDBB00]" />
          <span>Resultados &amp; Backtest</span>
        </button>
      </div>

      {/* ================= VISTA 1: PICKS ================= */}
      {mainTab === "PICKS" && (
        <>
          <section className="clay-glass-card p-4 md:p-5 mb-5 space-y-3.5">
            {/* Selector segmentado estilo App */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex p-1 rounded-2xl bg-slate-950/85 border border-slate-800 w-full sm:w-auto">
                {(
                  [
                    ["TODAY", "Hoy"],
                    ["UPCOMING", "Próximos días"],
                    ["DATE", "Otra fecha"],
                  ] as [DateViewMode, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setDateViewMode(key);
                      if (key !== "DATE") {
                        void runPrediction(key);
                      }
                    }}
                    className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-black transition-all ${
                      dateViewMode === key
                        ? "bg-[#EDBB00] text-[#07090e] shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {dateViewMode === "DATE" && (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <IoCalendarOutline className="w-4 h-4 text-[#EDBB00] shrink-0" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="clay-glass-input flex-1 sm:w-44 px-3 py-2 text-xs font-bold focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Selector de liga + Botón Analizar */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
              <div className="sm:col-span-8">
                <select
                  value={selectedLeague}
                  onChange={(e) => setSelectedLeague(e.target.value)}
                  className="clay-glass-input w-full p-3 text-xs md:text-sm font-bold focus:outline-none cursor-pointer"
                >
                  <option value="ALL" className="bg-[#0d121d] text-white">
                    🔥 Todas las Ligas (16 Ligas Europeas)
                  </option>
                  {VERIFIED_LEAGUES.map((l) => (
                    <option key={l.code} value={l.code} className="bg-[#0d121d] text-white">
                      {l.flag} {l.country} — {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-4">
                <button
                  onClick={() => void runPrediction()}
                  disabled={loading}
                  className="clay-glass-button w-full py-3 text-xs md:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <IoRefreshOutline className="w-4 h-4 animate-spin text-[#EDBB00]" />
                      <span>Analizando...</span>
                    </>
                  ) : (
                    <>
                      <IoPlay className="w-4 h-4 text-[#EDBB00]" />
                      <span>Analizar Partidos</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {error && (
            <div className="clay-glass-card p-4 mb-5 border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs md:text-sm font-semibold text-center">
              {error}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="space-y-5">
              {/* KPIs compactos */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <div className="clay-glass-card p-3.5 text-center">
                  <div className="text-[10px] uppercase text-slate-400 font-bold">Partidos</div>
                  <div className="text-xl md:text-2xl font-black text-white mt-0.5">
                    {candidates.length}
                  </div>
                </div>
                <div className="clay-glass-card p-3.5 text-center">
                  <div className="text-[10px] uppercase text-slate-400 font-bold">
                    💎 Picks Tier S
                  </div>
                  <div className="text-xl md:text-2xl font-black text-[#EDBB00] mt-0.5">
                    {tierSCount}
                  </div>
                </div>
                <div className="clay-glass-card p-3.5 text-center">
                  <div className="text-[10px] uppercase text-slate-400 font-bold">
                    🟢 Picks Tier A
                  </div>
                  <div className="text-xl md:text-2xl font-black text-emerald-400 mt-0.5">
                    {tierACount}
                  </div>
                </div>
                <div className="clay-glass-card p-3.5 text-center">
                  <div className="text-[10px] uppercase text-slate-400 font-bold">
                    Partidos Aptos
                  </div>
                  <div className="text-xl md:text-2xl font-black text-blue-300 mt-0.5">
                    {valueMatches.length}
                  </div>
                </div>
              </div>

              {/* Combinada Recomendada */}
              {parlay && (
                <section className="clay-glass-card-active p-4 md:p-5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3.5">
                    <div className="flex items-start gap-2.5">
                      <IoLayers className="w-6 h-6 text-[#EDBB00] shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-base md:text-lg font-black text-white">
                          Combinada Recomendada ({parlay.legs.length} Selecciones Puras)
                        </h2>
                        <p className="text-xs text-slate-300 mt-0.5">
                          Seguridad conjunta:{" "}
                          <strong className="text-white">
                            {(parlay.combinedProbability * 100).toFixed(1)}%
                          </strong>{" "}
                          &bull; Cuota buena:{" "}
                          <strong className="text-[#EDBB00]">&ge; {parlay.minCombinedOdds}</strong>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 bg-slate-950/75 px-3 py-2 rounded-xl border border-slate-800 self-start md:self-auto">
                      <span className="text-[11px] text-slate-400 font-bold">
                        Cuota en casa:
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={`${parlay.minCombinedOdds}`}
                        value={parlayHouseOdds}
                        onChange={(e) => setParlayHouseOdds(e.target.value)}
                        className="w-16 px-2 py-1 text-xs font-bold bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-[#EDBB00]"
                      />
                      {parlayEv !== null && (
                        <span
                          className={`text-xs font-black ${
                            parlayEv > 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {parlayEv > 0
                            ? `✅ +${(parlayEv * 100).toFixed(1)}%`
                            : `⚠️ Pide ≥ ${parlay.minCombinedOdds}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {parlay.legs.map((leg, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-2xl bg-slate-950/75 border border-white/10 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-blue-300 font-bold truncate">
                            {leg.leagueName} &bull;{" "}
                            {new Date(leg.kickoffUtc).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="text-[10px] font-black text-[#EDBB00] shrink-0">
                            {leg.tier === "TIER_S" ? "💎 TIER S" : "🟢 TIER A"}
                          </span>
                        </div>
                        <div className="font-black text-white text-sm">{leg.matchName}</div>
                        <div className="text-[#EDBB00] font-black">
                          {leg.market === "GOALS_O15"
                            ? "Over 1.5 Goles"
                            : leg.market === "CORNERS_OU"
                              ? `Over ${leg.line} Córneres`
                              : leg.market === "DOUBLE_CHANCE"
                                ? `Doble Oportunidad ${leg.selection}`
                                : `${leg.selection} ${leg.line} Goles`}
                        </div>
                        <div className="text-slate-400">
                          Prob:{" "}
                          <strong className="text-white">
                            {(leg.probability * 100).toFixed(1)}%
                          </strong>{" "}
                          &bull; Cuota buena:{" "}
                          <strong className="text-slate-200">&ge; {leg.minOdds}</strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-white/10 text-[11px] text-slate-400 flex items-center gap-1.5">
                    <IoShieldCheckmark className="w-4 h-4 text-[#EDBB00] shrink-0" />
                    <span>
                      Regla de seguridad: juega solo 2–3 selecciones puras Tier S (1 condición por
                      partido). Evita agregar cuotas de relleno &lt; 1.15.
                    </span>
                  </div>
                </section>
              )}

              {/* Filtros */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <p className="text-[11px] text-slate-400 font-medium">{sourceInfo}</p>
                <div className="flex flex-wrap items-center gap-1 p-1 rounded-2xl bg-slate-950/80 border border-slate-800">
                  {(
                    [
                      ["VALUE", `Recomendados (${valueMatches.length})`],
                      ["ALL", `Todos (${candidates.length})`],
                      ["GOALS", "Goles"],
                      ["CORNERS", "Córneres"],
                      ["DC", "Doble Oport."],
                    ] as [PickFilter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setActiveFilter(key)}
                      className={`px-2.5 py-1.5 text-[11px] font-black rounded-xl transition-all ${
                        activeFilter === key
                          ? "bg-[#EDBB00] text-[#07090e]"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tarjetas de Partidos */}
              <div className="grid grid-cols-1 gap-4">
                {filteredCandidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.fixtureId}
                    candidate={candidate}
                    activeFilter={activeFilter}
                    onOddsSaved={loadHistoryAndBacktest}
                  />
                ))}
              </div>
            </div>
          )}

          {candidates.length === 0 && !loading && !error && hasScannedOnce && (
            <div className="clay-glass-card p-8 text-center max-w-xl mx-auto my-6 space-y-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-[#004D98] to-[#A50044] flex items-center justify-center shadow-lg border border-white/20">
                <IoTrophyOutline className="w-6 h-6 text-[#EDBB00]" />
              </div>
              <div>
                <h3 className="text-base font-black text-white mb-1">
                  Sin partidos en la fecha seleccionada
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  No hay encuentros con cuotas publicadas para este filtro exacto.
                </p>
              </div>
              {nextAvailableDate ? (
                <button
                  onClick={() => {
                    setDateViewMode("DATE");
                    setSelectedDate(nextAvailableDate);
                    void runPrediction("DATE", nextAvailableDate);
                  }}
                  className="clay-glass-button px-5 py-2.5 text-xs font-black inline-flex items-center gap-2"
                >
                  <IoCalendarOutline className="w-4 h-4 text-[#EDBB00]" />
                  <span>Ver próxima jornada ({nextAvailableDate})</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setDateViewMode("UPCOMING");
                    void runPrediction("UPCOMING");
                  }}
                  className="clay-glass-button px-5 py-2.5 text-xs font-black"
                >
                  Ver próximos días
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ================= VISTA 2: RESULTADOS & BACKTEST ================= */}
      {mainTab === "HISTORY" && (
        <div className="space-y-5">
          {historyData?.evSummary && (
            <section className="clay-glass-card p-4 md:p-5">
              <div className="mb-3.5">
                <h2 className="text-base md:text-lg font-black text-white">
                  Efectividad Verificada (Temporada 2026/27 &bull;{" "}
                  {historyData.modelInfo?.totalMatchesTested || 1835} Partidos)
                </h2>
                <p className="text-xs text-slate-400">
                  Resultados reales fuera de muestra en 16 ligas europeas.
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3.5">
                {[
                  { label: "Over 1.5 Goles (Tier S)", val: historyData.evSummary.TIERS?.GOALS_O15_S },
                  {
                    label: "Córneres Over 6.5 (Tier S)",
                    val: historyData.evSummary.TIERS?.CORNERS_O65_S,
                  },
                  {
                    label: "Córneres Over 7.5 (Tier S)",
                    val: historyData.evSummary.TIERS?.CORNERS_O75_S,
                  },
                  { label: "Doble Oport. (Tier S)", val: historyData.evSummary.TIERS?.DC_S },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-2xl bg-slate-950/70 border border-white/10"
                  >
                    <div className="text-[10px] text-slate-400 font-bold">{item.label}</div>
                    <div className="text-lg md:text-xl font-black text-[#EDBB00] mt-1">
                      {item.val ? `${(item.val.hitRate * 100).toFixed(1)}%` : "-"}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {item.val ? `${item.val.wins} / ${item.val.total} aciertos` : ""}
                    </div>
                  </div>
                ))}
              </div>

              {historyData.evSummary.GOALS_OU25 && (
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs flex flex-wrap items-center justify-between gap-2">
                  <span className="text-emerald-200 font-bold">
                    Simples Over/Under 2.5 con Valor EV+:
                  </span>
                  <span className="font-black text-emerald-300">
                    {historyData.evSummary.GOALS_OU25.bets} picks &bull;{" "}
                    {(historyData.evSummary.GOALS_OU25.hitRate * 100).toFixed(1)}% acierto &bull;
                    Cuota media {historyData.evSummary.GOALS_OU25.avgOdds} &bull; ROI +
                    {(historyData.evSummary.GOALS_OU25.roi * 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Liquidación & Seguimiento Real */}
          <section className="clay-glass-card p-4 md:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base md:text-lg font-black text-white">
                  Control de Aciertos en Vivo
                </h2>
                <p className="text-xs text-slate-400">
                  Verifica marcadores y córneres finales reales de las jornadas analizadas.
                </p>
              </div>

              <button
                onClick={handleSettle}
                disabled={settling}
                className="clay-glass-button px-4 py-2.5 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {settling ? (
                  <IoRefreshOutline className="w-4 h-4 animate-spin text-[#EDBB00]" />
                ) : (
                  <IoCheckmarkDoneCircle className="w-4 h-4 text-[#EDBB00]" />
                )}
                <span>{settling ? "Verificando..." : "Liquidar Resultados"}</span>
              </button>
            </div>

            {settleMsg && (
              <div className="mb-4 p-3 rounded-xl bg-blue-500/15 border border-blue-500/30 text-xs text-blue-200 font-semibold">
                {settleMsg}
              </div>
            )}

            {historyData?.kpis && (
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                <div className="p-3 rounded-2xl bg-slate-950/70 border border-white/10 text-center">
                  <div className="text-[10px] text-slate-400 font-bold">Total Picks</div>
                  <div className="text-lg font-black text-white mt-0.5">
                    {historyData.kpis.totalBets}
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950/70 border border-white/10 text-center">
                  <div className="text-[10px] text-slate-400 font-bold">Acierto Real</div>
                  <div className="text-lg font-black text-emerald-400 mt-0.5">
                    {(historyData.kpis.hitRate * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-slate-950/70 border border-white/10 text-center">
                  <div className="text-[10px] text-slate-400 font-bold">Ganados / Pend.</div>
                  <div className="text-lg font-black text-[#EDBB00] mt-0.5">
                    {historyData.kpis.won} / {historyData.kpis.pending}
                  </div>
                </div>
              </div>
            )}

            {loadingHistory ? (
              <div className="text-center py-6 text-xs text-slate-400">Cargando resultados...</div>
            ) : (
              <div className="space-y-2">
                {(historyData?.picks || []).slice(0, 40).map((p: any) => (
                  <div
                    key={p.id}
                    className="p-3 rounded-xl bg-slate-950/65 border border-slate-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="text-slate-500 mr-2">{p.candidate?.date}</span>
                      <span className="text-blue-300 font-bold mr-2">[{p.candidate?.league}]</span>
                      <strong className="text-white">
                        {p.candidate?.homeTeam} vs {p.candidate?.awayTeam}
                      </strong>
                      <div className="text-slate-400 mt-0.5">
                        {p.market} &bull; {p.selection} {p.line > 0 ? p.line : ""} &bull; Prob{" "}
                        <strong className="text-slate-200">
                          {(p.probability * 100).toFixed(1)}%
                        </strong>
                        {p.odds > 1.01 ? ` • Cuota ${p.odds}` : ""}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {p.runTag && (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-black text-[#EDBB00]">
                          {p.runTag.replace("_", " ")}
                        </span>
                      )}
                      <span
                        className={`px-2.5 py-1 rounded-lg font-black text-[10px] ${
                          p.outcome === "WON"
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : p.outcome === "LOST"
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                              : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {p.outcome === "WON"
                          ? "ACERTADO"
                          : p.outcome === "LOST"
                            ? "FALLADO"
                            : "PENDIENTE"}
                      </span>
                    </div>
                  </div>
                ))}

                {(!historyData?.picks || historyData.picks.length === 0) && (
                  <div className="text-center py-6 text-xs text-slate-400">
                    Aún no hay picks guardados en la base de datos.
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Barra de Navegación Inferior Móvil estilo App Nativa */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#07090e]/95 backdrop-blur-xl border-t border-white/10 px-4 py-2 flex items-center justify-around">
        <button
          onClick={() => setMainTab("PICKS")}
          className={`flex flex-col items-center gap-1 px-6 py-1.5 rounded-xl text-[11px] font-black transition-all ${
            mainTab === "PICKS" ? "text-[#EDBB00]" : "text-slate-400"
          }`}
        >
          <IoSparkles className="w-5 h-5" />
          <span>Picks</span>
        </button>
        <button
          onClick={() => {
            setMainTab("HISTORY");
            void loadHistoryAndBacktest();
          }}
          className={`flex flex-col items-center gap-1 px-6 py-1.5 rounded-xl text-[11px] font-black transition-all ${
            mainTab === "HISTORY" ? "text-[#EDBB00]" : "text-slate-400"
          }`}
        >
          <IoStatsChart className="w-5 h-5" />
          <span>Resultados</span>
        </button>
      </nav>
    </main>
  );
}
