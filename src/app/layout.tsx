import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SPFIA Predictor v3.0 | Pronóstico de Goles y Córneres FC Barcelona Dark",
  description: "Plataforma predictiva ultra-conservadora para Over 1.5/2.5 Goles y Over 6.5/7.5 Córneres conectada a Neon PostgreSQL serverless.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${inter.className} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-[#0b0e14] text-slate-100">{children}</body>
    </html>
  );
}
