# DATASTORE S.A.C. — Dashboard Empresarial v2.0 (Docker Only)

> **Big Data · MongoDB + HDFS · Panel 5 Cuadros en Tiempo Real · Tablas Escogibles · 16 Filtros · Diseño Renovado**
> **Lanzamiento:** `docker compose up --build` → http://localhost:3000  (Windows y CachyOS idéntico)

## 🚀 Inicio Rápido

```bash
# Windows (PowerShell Admin) o CachyOS (terminal)
git clone <repo> datastore && cd datastore/BIG_DATA
docker compose up --build -d
# Espera 30s, abre http://localhost:3000
# Login: admin / Admin123*
```

Ver guía completa: **[INSTALACION.md](INSTALACION.md)** (Windows y CachyOS paso a paso).

## ✨ Qué hay de nuevo (v2 Renovado)

- **Sin Cloudflare:** backend Node+Express en Docker (puerto 3000) reemplaza Worker/D1/KV. Todo `docker compose`.
- **Diseño 2.0:** glass topbar, sidebar oscuro con pills, cards elevadas, gradientes, chips, responsive móvil.
- **Tablas escogibles y reactivas:** clic en cualquier fila (producto/categoría/ciudad/mes) → filtra TODO el dashboard. Todas las 7 tablas reaccionan a TODOS los filtros.
- **16 filtros completos:** búsqueda global, categoría, ciudad, **producto**, año, mes, **fecha desde/hasta**, **trimestre Q1-Q4**, **día semana**, orden, Top N, ranking modo, métrica, precio, cantidad, venta total. Con chips activos y `↺ Limpiar todo`.

## 📊 Stack

```
ventas.csv (20k) → backend:3000 (Express + Mongo) → public/ (Chart.js)
                → mongodb:27017 + mongo-express:8081
                → hdfs://namenode:9000 (9870 UI) + datanode
```

## 📁 Estructura

```
BIG_DATA/
├── docker-compose.yml
├── backend/           # Docker backend (v2)
├── public/            # frontend renovado
├── ventas.csv
├── INSTALACION.md     # guía Windows/CachyOS
└── datastore-auth/    # legacy v1 (no usado)
```

## 🔍 Uso

1. `http://localhost:3000` → Ingresar `admin`/`Admin123*`
2. **Cargar ventas.csv** o **Cargar demo** → 20k registros
3. Prueba: slider precio `0-300`, fecha `2026-01-01`→`2026-03-31`, clic en Top5 `Laptop C` → todo reacciona
4. **Tiempo real ON** → inyecta ventas cada 2.5s
5. **Exportar filtrados (CSV)** → Excel

## 🛠 Comandos

```bash
docker compose ps
docker compose logs -f backend
docker compose down
curl http://localhost:3000/api/health
```

## 📄 Docs

- `INSTALACION.md` — instalación Windows/CachyOS + troubleshooting
- `reporte_analisis.md` — análisis Big Data
- `backend/server.js:1` — API

---
DATASTORE S.A.C. · PIAD 625 · 2026 · v2.0 Docker Only
