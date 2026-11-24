# SPFIA Picks — Motor Cuantitativo de Seguridad y Valor

Aplicación web progresiva (PWA) conectada a **Neon PostgreSQL** mediante **Prisma ORM**, desplegada en **Netlify** con soporte para **16 ligas europeas** (`football-data.co.uk` + `football-data.org`).

## Mercados Soportados

* **Over 1.5 Goles** (Dixon-Coles + Regresión Logística L2 calibrada + Monte Carlo)
* **Over / Under 2.5 Goles EV+** (con cuotas reales de mercado)
* **Córneres Over 6.5 / 7.5** (Binomial Negativa sobre córneres reales y volumen de tiros)
* **Doble Oportunidad 1X / X2 EV+**

## Ejecución Local

```bash
npm install
npx prisma generate
npm run dev
```

Las credenciales de acceso y conexión a base de datos se configuran mediante variables de entorno (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DATABASE_URL`, `DIRECT_URL`, `FOOTBALL_DATA_TOKEN`).
