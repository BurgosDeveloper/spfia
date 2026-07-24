"use client";

import { useState } from "react";
import { IoShieldCheckmark, IoPerson, IoLockClosed, IoLogIn } from "react-icons/io5";

interface LoginModalProps {
  onSuccess: () => void;
}

export default function LoginModal({ onSuccess }: LoginModalProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        onSuccess();
      } else {
        setError(data.error || "Credenciales incorrectas");
      }
    } catch (err) {
      setError("Error al conectar con el servidor");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-lg p-4">
      <div className="clay-glass-card w-full max-w-md p-8 relative overflow-hidden shadow-2xl">
        {/* Accent Barça Bar */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-[#004D98] via-[#EDBB00] to-[#A50044]" />

        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#004D98] to-[#A50044] flex items-center justify-center shadow-xl border border-white/20">
            <IoShieldCheckmark className="w-10 h-10 text-[#EDBB00]" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-wide">
            SPFIA <span className="text-[#EDBB00]">Predictor</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-semibold">
            Acceso Privado Predictivo
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-sm text-center font-medium backdrop-blur-md">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
              Usuario
            </label>
            <div className="relative">
              <IoPerson className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="clay-glass-input w-full pl-12 pr-4 py-3 text-sm focus:outline-none"
                placeholder="Ingresa tu usuario"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2 uppercase tracking-wider">
              Contraseña
            </label>
            <div className="relative">
              <IoLockClosed className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="clay-glass-input w-full pl-12 pr-4 py-3 text-sm focus:outline-none"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="clay-glass-button w-full py-3.5 text-sm uppercase tracking-wider font-extrabold mt-4 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <IoLogIn className="w-5 h-5 text-[#EDBB00]" />
                <span>Ingresar al Panel</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
