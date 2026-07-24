# SPFIA Predictor v3.0 (FC Barcelona Dark Mode & Neon PostgreSQL)

Plataforma predictiva autónoma de ultra-precisión para fútbol, especializada en selecciones de **Over 1.5 / Over 2.5 Goles** y **Over 6.5 / Over 7.5 Córneres**, conectada a **Neon PostgreSQL Serverless** mediante **Prisma ORM**.

---

## 🚀 Características Principales

* **Frontend Web Autónoma**: Interfaz moderna con diseño Claymorphism en Modo Oscuro y estética del **FC Barcelona** (Blaugrana `#004D98`, Grana `#A50044`, Dorado `#EDBB00`).
* **Sin dependencias pesadas**: n8n y Postgres local fueron eliminados. Todo corre en una sola aplicación Web Fullstack de alto rendimiento.
* **Persistencia 24/7 en la Nube**: Conexión a Neon PostgreSQL (`ep-dark-sun-auwxsmw7`).
* **Motor Probabilístico Dual**:
  * **Goles**: Modelo Dixon-Coles + Poisson con filtro anti low-score ($0-0$, $1-0$, $0-1$).
  * **Córneres**: Modelo Poisson bivariado con métricas calibradas por liga y división local/visitante.
* **Factor de Alineaciones**: Integración con API-Football para ajustar dinámicamente la confianza ($P_{low}$) cuando las alineaciones son confirmadas.
* **Caché Persistente Anti-Fallos**: Almacenamiento en DB para no agotar la cuota de las APIs oficiales.

---

## 🛠️ Ejecución Local

1. Abrir la terminal en la raíz del proyecto.
2. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```
3. Abrir [http://localhost:3000](http://localhost:3000) en el navegador.

### Credenciales Admin de Acceso:
* **Usuario**: `admin`
* **Contraseña**: `spfia_admin_2026`

---

## ☁️ Despliegue en la Nube 24/7 (Vercel / Render / Netlify)

El proyecto está 100% preparado para desplegarse gratis en la nube:

1. Subir el repositorio a tu cuenta de GitHub.
2. Importar el repositorio en **Vercel** / **Render** / **Netlify**.
3. Configurar las variables de entorno en el panel de despliegue (tomadas de tu `.env`):
   * `DATABASE_URL`
   * `DIRECT_URL`
   * `FOOTBALL_DATA_TOKEN`
   * `API_FOOTBALL_DATA_TOKEN`
   * `ADMIN_USERNAME`
   * `ADMIN_PASSWORD`
