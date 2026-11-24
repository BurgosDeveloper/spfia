"use client";

import { IoShieldCheckmark, IoLogOut, IoFootball } from "react-icons/io5";

interface HeaderProps {
  onLogout: () => void;
  dbConnected?: boolean;
}

export default function Header({ onLogout, dbConnected = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 py-3 mb-5 bg-[#07090e]/85 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#004D98] to-[#A50044] flex items-center justify-center shadow-lg border border-white/20 shrink-0">
            <IoShieldCheckmark className="w-5 h-5 text-[#EDBB00]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-black text-white tracking-wide flex items-center gap-1.5 truncate">
              SPFIA <span className="text-[#EDBB00]">Picks</span>
              <IoFootball className="w-4 h-4 text-[#004D98] shrink-0" />
            </h1>
            <p className="text-[11px] text-slate-400 font-medium truncate">
              16 Ligas &bull; Seguridad y Valor
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${
              dbConnected
                ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-300"
                : "bg-amber-500/15 border-amber-500/35 text-amber-300"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                dbConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
            />
            {dbConnected ? "En línea" : "Solo lectura"}
          </span>

          <button
            onClick={onLogout}
            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 text-rose-400 transition-all"
            title="Cerrar Sesión"
            aria-label="Cerrar Sesión"
          >
            <IoLogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
