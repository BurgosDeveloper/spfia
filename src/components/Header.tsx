"use client";

import { IoShieldCheckmark, IoLogOut, IoServerOutline, IoFlashOutline, IoFootball } from "react-icons/io5";

interface HeaderProps {
  onLogout: () => void;
}

export default function Header({ onLogout }: HeaderProps) {
  return (
    <header className="clay-glass-card mb-8 p-4 md:p-6 relative overflow-hidden z-10">
      {/* Accent Barça Glow Bar */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#004D98] via-[#EDBB00] to-[#A50044]" />

      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#004D98] to-[#A50044] flex items-center justify-center shadow-lg border border-white/20">
            <IoShieldCheckmark className="w-8 h-8 text-[#EDBB00]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-black text-white tracking-wide flex items-center gap-2">
                SPFIA <span className="text-[#EDBB00]">Predictor</span>
                <IoFootball className="w-5 h-5 text-[#004D98] animate-spin-slow" />
              </h1>
              <span className="px-2.5 py-0.5 text-[10px] font-black rounded-full bg-[#EDBB00]/20 text-[#EDBB00] border border-[#EDBB00]/40 uppercase tracking-wider backdrop-blur-md">
                v3.0 Glass-Clay
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              Goles (Over 1.5/2.5) & Córneres (Over 6.5/7.5) • Neon Postgres Serverless
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900/70 border border-slate-700/50 text-xs text-slate-300 backdrop-blur-md">
            <IoServerOutline className="w-4 h-4 text-emerald-400" />
            <span>Neon DB Connected</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900/70 border border-slate-700/50 text-xs text-slate-300 backdrop-blur-md">
            <IoFlashOutline className="w-4 h-4 text-[#EDBB00]" />
            <span>Lineups Engine Active</span>
          </div>

          <button
            onClick={onLogout}
            className="p-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 text-xs font-bold transition-all shadow-md"
            title="Cerrar Sesión"
          >
            <IoLogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
