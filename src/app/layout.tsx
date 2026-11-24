import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SPFIA Picks | Pronósticos de Seguridad y Valor",
  description:
    "App de pronósticos deportivos cuantitativos para 16 ligas europeas: Over 1.5 Goles, Over/Under 2.5 EV+, Córneres Over 6.5/7.5 y Doble Oportunidad.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SPFIA Picks",
  },
};

export const viewport: Viewport = {
  themeColor: "#07090e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${inter.className} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-[#07090e] text-slate-100 selection:bg-[#EDBB00]/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
