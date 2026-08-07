"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import LoginModal from "@/components/LoginModal";
import CandidateCard from "@/components/CandidateCard";
import { CandidateResult } from "@/lib/predictorEngine";
import {
  IoPlay,
  IoCalendarOutline,
  IoRefreshOutline,
  IoTrophyOutline,
  IoSparkles,
  IoFootball,
  IoCheckmarkDoneCircle,
} from "react-icons/io5";

const LEAGUES = [
  { code: "PD", name: "España - LaLiga Primera", flag: "🇪🇸" },
  { code: "SD", name: "España - LaLiga Segunda Hypermotion", flag: "🇪🇸" },
  { code: "PL", name: "Inglaterra - Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "ELC", name: "Inglaterra - Championship", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { code: "FL1", name: "Francia - Ligue 1", flag: "🇫🇷" },
  { code: "SA", name: "Italia - Serie A", flag: "🇮🇹" },
  { code: "BL1", name: "Alemania - Bundesliga", flag: "🇩🇪" },
  { code: "BSA", name: "Brasil - Brasileirão Serie A", flag: "🇧🇷" },
  { code: "LPF", name: "Argentina - Liga Profesional Argentina", flag: "🇦🇷" },
  { code: "PPL", name: "Portugal - Primeira Liga", flag: "🇵🇹" },
  { code: "DED", name: "Países Bajos - Eredivisie", flag: "🇳🇱" },
];

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState("PD");
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CandidateResult[]>([]);
  const [activeFilter, setActiveFilter] = useState<"ALL" | "BET" | "GOALS" | "CORNERS">("ALL");
  const [error, setError] = useState("");

  // Verificar login guardado
  useEffect(() => {
    const session = localStorage.getItem("spfia_logged");
    if (session === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLoginSuccess = () => {
    localStorage.setItem("spfia_logged", "true");
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("spfia_logged");
    setIsAuthenticated(false);
  };

  const handleRunPrediction = async () => {
    setLoading(true);
    setError("");
    setCandidates([]);

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate, league: selectedLeague }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setCandidates(data.candidates || []);
      } else {
        setError(data.error || "No se encontraron partidos o hubo un error en la solicitud.");
      }
    } catch (err) {
      setError("Error de red o conexión con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  // Conteos exactos dinámicos por categoría
  const countBetMatches = candidates.filter((c) => c.picks.some((p) => p.decision === "BET")).length;
  const countGoalsMatches = candidates.filter((c) => c.picks.some((p) => p.market === "GOALS_OU")).length;
  const countCornersMatches = candidates.filter((c) => c.picks.some((p) => p.market === "CORNERS_OU")).length;

  // Filtrado de partidos a renderizar según pestaña activa
  const filteredCandidates = candidates.filter((c) => {
    if (activeFilter === "BET") {
      return c.picks.some((p) => p.decision === "BET");
    }
    if (activeFilter === "GOALS") {
      return c.picks.some((p) => p.market === "GOALS_OU");
    }
    if (activeFilter === "CORNERS") {
      return c.picks.some((p) => p.market === "CORNERS_OU");
    }
    return true;
  });

  const totalBetsCount = candidates.reduce(
    (acc, c) => acc + c.picks.filter((p) => p.decision === "BET").length,
    0
  );

  return (
    <main className="min-h-screen pb-20 px-4 md:px-8 max-w-7xl mx-auto relative z-10">
      {/* Fondo de resplandor ambiental azulgrana */}
      <div className="ambient-barca-bg" />

      {!isAuthenticated && <LoginModal onSuccess={handleLoginSuccess} />}

      <Header onLogout={handleLogout} />

      {/* Panel de Controles Claymorphism + Glassmorphism */}
      <section className="clay-glass-card p-6 mb-8 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-4 text-[#EDBB00] font-black text-sm uppercase tracking-wider">
          <IoSparkles className="w-4 h-4 text-[#EDBB00]" />
          <span>Ejecución de Análisis por Liga (Hoy)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Selector de Liga */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
              Liga / Competición
            </label>
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
              className="clay-glass-input w-full p-3.5 text-sm font-bold focus:outline-none cursor-pointer"
            >
              {LEAGUES.map((l) => (
                <option key={l.code} value={l.code} className="bg-[#0d121d] text-white">
                  {l.flag} {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Fecha */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider flex items-center gap-1.5">
              <IoCalendarOutline className="w-4 h-4 text-[#EDBB00]" />
              Fecha de Jornada
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="clay-glass-input w-full p-3 text-sm font-bold focus:outline-none cursor-pointer"
            />
          </div>

          {/* Botón Ejecutar */}
          <div>
            <button
              onClick={handleRunPrediction}
              disabled={loading}
              className="clay-glass-button w-full py-3.5 text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <IoRefreshOutline className="w-5 h-5 animate-spin text-[#EDBB00]" />
                  <span>Analizando Liga...</span>
                </>
              ) : (
                <>
                  <IoPlay className="w-5 h-5 text-[#EDBB00]" />
                  <span>Analizar Jornada</span>
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="clay-glass-card p-4 mb-6 border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm font-semibold text-center backdrop-blur-md">
          {error}
        </div>
      )}

      {/* Resultados & Filtros */}
      {candidates.length > 0 && (
        <section className="space-y-6">
          {/* Barra de Estadísticas y Filtros */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-black text-white flex items-center gap-1.5">
                <IoFootball className="w-4 h-4 text-[#004D98]" />
                Partidos Analizados: <span className="text-[#EDBB00] font-black">{candidates.length}</span>
              </span>
              <span className="text-xs px-3.5 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black backdrop-blur-md flex items-center gap-1">
                <IoCheckmarkDoneCircle className="w-4 h-4 text-emerald-400" />
                Picks BET Recomendados: {totalBetsCount}
              </span>
            </div>

            {/* Tabs Filtro Interactivo */}
            <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-950/80 border border-slate-800 backdrop-blur-md">
              <button
                onClick={() => setActiveFilter("ALL")}
                className={`px-3.5 py-1.5 text-xs font-black rounded-xl transition-all ${
                  activeFilter === "ALL"
                    ? "bg-[#004D98] text-white shadow-md border border-blue-400/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Todos ({candidates.length})
              </button>
              <button
                onClick={() => setActiveFilter("BET")}
                className={`px-3.5 py-1.5 text-xs font-black rounded-xl transition-all ${
                  activeFilter === "BET"
                    ? "bg-[#EDBB00] text-[#07090e] shadow-md border border-yellow-300"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Solo BET ({countBetMatches})
              </button>
              <button
                onClick={() => setActiveFilter("GOALS")}
                className={`px-3.5 py-1.5 text-xs font-black rounded-xl transition-all ${
                  activeFilter === "GOALS"
                    ? "bg-[#A50044] text-white shadow-md border border-rose-400/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Goles ({countGoalsMatches})
              </button>
              <button
                onClick={() => setActiveFilter("CORNERS")}
                className={`px-3.5 py-1.5 text-xs font-black rounded-xl transition-all ${
                  activeFilter === "CORNERS"
                    ? "bg-purple-600 text-white shadow-md border border-purple-400/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Córneres ({countCornersMatches})
              </button>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 gap-6">
            {filteredCandidates.map((candidate) => (
              <CandidateCard
                key={candidate.fixtureId}
                candidate={candidate}
                activeFilter={activeFilter}
              />
            ))}
          </div>

          {filteredCandidates.length === 0 && (
            <div className="clay-glass-card p-8 text-center text-slate-400 text-sm">
              No hay partidos que coincidan con la pestaña seleccionada en esta jornada.
            </div>
          )}
        </section>
      )}

      {/* Estado Inicial VACÍO */}
      {candidates.length === 0 && !loading && !error && (
        <div className="clay-glass-card p-12 text-center max-w-2xl mx-auto my-12 relative overflow-hidden">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#004D98] to-[#A50044] flex items-center justify-center shadow-xl border border-white/20">
            <IoTrophyOutline className="w-9 h-9 text-[#EDBB00]" />
          </div>
          <h3 className="text-xl font-black text-white mb-2">
            Selecciona una Liga y ejecuta el Pronóstico
          </h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            El sistema analizará los partidos del día para la liga seleccionada, evaluando líneas ultra-conservadoras de 
            <strong className="text-white"> Over 1.5/2.5 Goles</strong> y <strong className="text-white">Over 6.5/7.5 Córneres</strong>.
          </p>
        </div>
      )}
    </main>
  );
}
