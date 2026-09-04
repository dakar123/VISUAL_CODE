# DATASTORE S.A.C. — Guía de Instalación y Lanzamiento (v2.0 Docker Only)

> **¡Renovado! 100% Docker · Sin Cloudflare · Funciona idéntico en Windows y CachyOS**
> Panel 5 Cuadros + Tiempo Real + Tablas Escogibles + Filtros Completos + MongoDB + HDFS + Diseño 2.0

---

## 1) Qué cambia en v2.0

| Antes (v1) | Ahora (v2 Docker Only) |
|---|---|
| Dependía de `wrangler dev` (Cloudflare D1/KV) | **Un solo comando:** `docker compose up --build` |
| `datastore-auth` Worker | `backend/` Node+Express (sirve `public/` y API `/api/*`) |
| `wrangler.jsonc`, `D1`, `KV` | **MongoDB** (`datastore.sales`, `users`, `sessions`) |
| `npm test` con Workers | `curl http://localhost:3000/api/health` |
| Tablas estáticas | **Tablas escogibles:** clic en fila → filtra y reacciona todo |
| Filtros básicos (precio, mes, ciudad) | **16 filtros completos** (fecha rango, trimestre, weekday, producto, etc.) |
| Diseño 1.0 | **Diseño 2.0 renovado:** glass, gradientes, cards elevadas, chips, responsive |

**Accesos v2:**
- **App:** http://localhost:3000
- **Mongo Express:** http://localhost:8081
- **HDFS NameNode:** http://localhost:9870

---

## 2) Arquitectura Docker Only

```
ventas.csv (20.000)
   │
   ├─► backend:3000 (Node 20 + Express)
   │      ├─ sirve public/ (index.html, app.js, style.css)
   │      ├─ API: /login, /register, /me, /logout
   │      ├─ API: /api/upload, /api/data, /api/analytics, /api/filters, /api/health
   │      └─ MongoDB: datastore.sales (20k) + users + sessions
   │
   ├─► mongodb:27017  (mongo:7) ──► mongo-express:8081
   │
   └─► hdfs: hdfs://namenode:9000  ──► namenode:9870 + datanode:9864
        └─ /datastore/ventas.csv  (copia Big Data)

Frontend (Chart.js) carga CSV local O via /api/upload → Mongo
Filtros → getPanelFilteredRows() debounce 140ms → 5 cuadros + 7 tablas reactivas
```

**5 Cuadros (reactivos a TODOS los filtros):**

1. **KPIs** - total ventas, transacciones, ticket prom, unidades, precio prom, ciudades + sparkline + deltas
2. **Tendencia** - mensual o por categoría + mejor mes + proyección lineal
3. **Ranking** - horizontal Top N productos (ordenable, más/menos)
4. **Geo** - barras ciudad / dona categoría
5. **Precio** - histograma buckets + scatter precio×cantidad

**16 Filtros para estudio sólido:**

- Globales: Año, Mes, Ciudad (legacy) + Búsqueda global (texto)
- Panel: Categoría, Ciudad, **Producto**, Año, Mes, **Fecha Desde/Hasta**, **Trimestre (Q1-Q4)**, **Día semana (Lun-Dom)**, **Orden, Top N, Ranking modo, Métrica (ventas/unidades/tickets)**
- Rangos: **Precio unitario**, **Cantidad/ticket**, **Venta total** (dual slider + number)
- **Selección por tabla:** clic en cualquier fila (producto/categoría/ciudad/mes) → filtra instantáneamente
- **Chips activos:** se ven arriba, clic × para quitar
- **Tiempo real:** ON inyecta 1 venta sintética cada 2.5s

**Tablas escogibles y reactivas (7):** Resumen, Top5, Período (mes), Categoría, ProductosTop, ProductosBottom, Sedes. Todas escuchan TODOS los filtros + selección.

---

## 3) Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| **Docker + Docker Compose** | 24+ / v2.20+ | Todo el stack |
| Git | 2.x | clonar |
| Navegador moderno | Chrome/Edge/Firefox | Panel |
| (Opcional) Node 20 | si quieres correr scripts fuera de Docker | `ingest-mongo.js` |

> **No necesitas** instalar Node, Wrangler, Hadoop o Mongo nativo. Docker lo trae todo. En Windows necesitas **Docker Desktop + WSL2**.

---

## 4) Instalación Windows 10/11 (PowerShell Administrador)

### 4.1 Docker

```powershell
winget install Docker.DockerDesktop --accept-source-agreements
# Reinicia Windows cuando pida, abre Docker Desktop, espera "Engine running"
docker --version
docker compose version
git --version
```
Si winget falla: https://www.docker.com/products/docker-desktop/ y https://git-scm.com/download/win

**WSL2 (si no lo tienes):**
```powershell
wsl --install
wsl --update
# Reinicia
```

### 4.2 Clonar

```powershell
cd $HOME\Documents
git clone <tu-repo-url> datastore
cd datastore\BIG_DATA
dir ventas.csv
dir public\index.html
dir backend\server.js
dir docker-compose.yml
```

### 4.3 Lanzamiento (único comando)

```powershell
docker compose up --build -d
# Espera 30-45s (mongo + backend + hdfs)
docker compose ps
# Debe verse:
# datastore-mongo      healthy
# datastore-backend    healthy (o starting -> healthy)
# datastore-namenode   healthy
# datastore-datanode   running
# datastore-mongo-express running

docker logs datastore-backend --tail 50
# Esperas: "✅ MongoDB conectado" y "✅ Backend escuchando en http://0.0.0.0:3000"

docker logs datastore-mongo --tail 20
docker logs datastore-namenode --tail 20
```

### 4.4 Verificar

```powershell
curl http://localhost:3000/api/health
# {"status":"OK","mongo":true,"sales":20000,...}

# Abrir en navegador
start http://localhost:3000
start http://localhost:8081
start http://localhost:9870

# Ingesta HDFS (opcional, ya está montado)
.\scripts\ingest-hdfs.bat .\ventas.csv
docker exec datastore-namenode hdfs dfs -ls -h /datastore
docker exec datastore-namenode hdfs dfs -cat /datastore/ventas.csv | head -5

# Login seed: admin / Admin123*
# En la web: Ingresar -> admin / Admin123* -> Dashboard
# O directo: "Cargar ventas.csv" -> selecciona BIG_DATA\ventas.csv -> 20k registros
# O "Cargar demo (sin archivo)" -> fetch automático
```

### 4.5 Comandos Windows útiles

```powershell
docker compose logs -f
docker compose logs backend -f
docker compose down        # apaga
docker compose down -v     # apaga y borra datos (¡cuidado!)
docker compose up --build -d   # reconstruye backend tras cambios
docker exec -it datastore-mongo mongosh -u datastore -p datastore123 --authenticationDatabase admin --eval "db.getSiblingDB('datastore').sales.countDocuments()"
```

---

## 5) Instalación CachyOS (Arch)

CachyOS = Arch optimizado, usa `pacman` y `yay`.

### 5.1 Dependencias

```bash
sudo pacman -Syu --noconfirm
sudo pacman -S --needed --noconfirm git docker docker-compose base-devel curl python

# Habilitar Docker
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# NOTA: newgrp docker puede fallar con "crypt failed: Invalid argument" en CachyOS.
# Solución: cerrar sesión y volver a entrar, o usar:
su -l $USER -c "docker ps"  # probar en el mismo terminal
# O en un nuevo terminal de login:
# cerrar sesión → volver a iniciar sesión → docker ps funciona sin sudo
docker --version
docker compose version
git --version
docker ps  # sin sudo

# yay (si no existe)
if ! command -v yay &>/dev/null; then
  git clone https://aur.archlinux.org/yay.git /tmp/yay && cd /tmp/yay && makepkg -si --noconfirm && cd -
fi
```

**Firewall (si usas firewalld):**
```bash
sudo firewall-cmd --add-port=3000/tcp --permanent --add-port=8081/tcp --permanent --add-port=9870/tcp --permanent
sudo firewall-cmd --reload
```

### 5.2 Clonar

```bash
mkdir -p ~/proyectos && cd ~/proyectos
git clone <tu-repo-url> datastore && cd datastore/BIG_DATA
ls -lh ventas.csv backend/server.js public/index.html docker-compose.yml
```

### 5.3 Lanzamiento

```bash
docker compose up --build -d
docker compose ps
docker logs -f datastore-backend  # Ctrl+C cuando veas "Backend escuchando"
# o
docker logs datastore-mongo --tail 20
curl http://localhost:3000/api/health | jq
xdg-open http://localhost:3000
xdg-open http://localhost:8081
xdg-open http://localhost:9870

# HDFS (opcional)
chmod +x scripts/ingest-hdfs.sh
./scripts/ingest-hdfs.sh ./ventas.csv
docker exec datastore-namenode hdfs dfs -ls -h /datastore
```

### 5.4 Comandos CachyOS útiles

```bash
docker compose logs -f backend
docker compose down
docker compose down -v  # borra volúmenes
docker compose up --build -d

docker exec -it datastore-mongo mongosh -u datastore -p datastore123 --authenticationDatabase admin --eval "db.getSiblingDB('datastore').sales.countDocuments()"
docker exec datastore-namenode hdfs dfs -cat /datastore/ventas.csv | head -5
```

---

## 6) Uso del Panel (estudio completo)

### 6.1 Cargar datos

1. **http://localhost:3000** → **Ingresar** → `admin` / `Admin123*` (seed automático, también puedes registrar otro en `/register`)
2. Dashboard → **Cargar ventas.csv** → selecciona `ventas.csv` (20k)
3. O **Cargar demo (sin archivo)** (hace fetch de `public/ventas.csv` montado)
4. Verás `20.000 registros` y `filterCount`

### 6.2 Filtros que dan estudio sólido (casos reales)

| Objetivo empresarial | Filtros a usar | Qué mirar |
|---|---|---|
| **Precio menor/mayor** | Slider 💲 `0-300` vs `1500-6000` | Cuadro5 histograma: volumen vs margen |
| **Ciudad más/menos** | Ciudad + Cuadro4 Geo + tabla Sedes (clic en Lima) | Lima 2576 tickets vs Juliaca; replica estrategia Lima |
| **Producto estrella vs cola** | Ranking `Más/Menos` + `Orden` + TopN | Disco SSD 2TB top vs Impresora A cola → stock y promo |
| **Temporal** | Fecha Desde/Hasta + Trimestre Q1-Q4 + Mes | Cuadro2: Q2 vs Q3, proyección |
| **Día semana** | Día semana = `Viernes` vs `Lunes` | Detecta pico fin de semana |
| **Ticket mayorista** | Cantidad `15-20` + Venta total `>50000` | Filtra mayoristas, Ticket prom alto |
| **Búsqueda quirúrgica** | Búsqueda `Laptop` + Producto=C + Categoría=Computadoras | Solo laptops, análisis fino |
| **Selección tabla** | Clic en fila Top5 → `Sel. Producto` chip | Filtra ese producto en TODOS los cuadros y tablas |

**Todos los filtros son cruzados y reactivos (<150ms):** cambias precio + fecha + ciudad y los 5 cuadros + 7 tablas + KPIs + insights se recalculan al instante.

**Chips activos:** arriba del panel ves `Categoría: Computadoras ×` `Sel. Producto: Laptop C ×` → clic × quita.

**Limpiar:** `↺ Limpiar todo` resetea 16 filtros + selección.

### 6.3 Tablas escogibles

- **Clic en cualquier fila** (Resumen no, pero Top5, Periodo, Categoría, Productos, Sedes sí) → esa fila se pinta azul con `●` y filtra TODO el dashboard por ese valor.
- Segundo clic en la misma fila → deselecciona.
- Combina con sliders: ej. clic `Lima` + precio `0-500` → solo Lima barato.

### 6.4 Tiempo real

Activa **Tiempo real: ON** (arriba panel). Cada 2.5s inyecta venta sintética (clon con jitter precio/cantidad) y TODOS los gráficos/tablas se actualizan. Ideal para demo gerencial. Off para análisis estático.

### 6.5 Exportar

- **📥 Exportar filtrados (CSV):** baja SOLO los registros visibles tras filtros (con Fecha, Producto, Cantidad, PrecioUnitario, Ventas, Ciudad) → Excel/PowerBI.
- **Reportes → Generar reporte:** con Año/Mes/Ciudad independientes + proyección 3 meses + CSV/HTML/PDF.

### 6.6 Diseño 2.0

- Glass topbar + sidebar oscuro con pills activas, cards con elevación y hover lift, gradientes, chips, responsive 3 breakpoints.
- **Responsive:** en móvil sidebar colapsa a 64px, filtros a 2 cols, panel a 1 col.

---

## 7) Puertos y Servicios

| Servicio | Puerto host | Dentro Docker | URL | Salud |
|---|---|---|---|---|
| **backend** | 3000 | 3000 | http://localhost:3000 | `wget http://localhost:3000/api/health` |
| mongodb | 27017 | 27017 | `mongodb://datastore:datastore123@localhost:27017` | `mongosh --eval "db.adminCommand('ping')"` |
| mongo-express | 8081 | 8081 | http://localhost:8081 | browser |
| namenode | 9870 | 9870 | http://localhost:9870 | `curl -f http://localhost:9870/` |
| datanode | 9864 | 9864 | - | - |

---

## 8) Troubleshooting (Windows y CachyOS)

| Problema | Causa | Solución |
|---|---|---|
| `port is already allocated` | Otro servicio usa 3000/27017/9870 | `docker compose down` + `lsof -i :3000` (CachyOS) o `netstat -ano | findstr 3000` (Win) y mata proceso |
 | `permission denied docker.sock` (CachyOS) | Usuario no en grupo docker o sesión no refrescada | `sudo usermod -aG docker $USER` → **cerrar sesión y volver a entrar** (no usar `newgrp docker` → `crypt failed`). Alternativa: `su -l $USER -c "docker ps"` en el mismo terminal |
| `Engine not running` (Win) | Docker Desktop no iniciado | Abre Docker Desktop, espera verde, `wsl --update` |
| `fetch failed /api/health` | Backend aún arrancando | Espera 15s, `docker logs backend --tail 20` debe decir "MongoDB conectado" |
| `CSV no detecta columnas` | CSV con `;` o cabeceras distintas | El parser soporta `,`/`;` y aliases (`Fecha`, `Precio`, `Ciudad`...), verifica 6 columnas |
| `mongosh not found` | Mongo no healthy | `docker inspect datastore-mongo --format '{{.State.Health.Status}}'` espera `healthy` |
| `namenode unhealthy` | Volumen corrupto o puerto 9000 | `docker compose down -v && docker compose up --build -d` (borra datos) |
| `ventas.csv 404` (demo) | Volumen no montado | Verifica `docker-compose.yml` tiene `./ventas.csv:/app/ventas.csv:ro` y `./public:/app/public:ro` |
| Tablas no filtran | No diste clic en fila correcta | Clic en primera columna (producto/categoría/ciudad/mes) → chip `Sel. ...` debe aparecer |

**Legacy Cloudflare:** `datastore-auth/` queda como referencia histórica, ya no se usa. Todo está en `backend/`. Si ves `wrangler` en docs viejas, ignóralo.

---

## 9) Estructura v2

```
BIG_DATA/
├── ventas.csv
├── docker-compose.yml          # 5 servicios: backend, mongodb, mongo-express, namenode, datanode
├── hadoop.env
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js               # Express + Mongo + multer + bcrypt + static
├── public/
│   ├── index.html              # 5 cuadros + 16 filtros + tablas escogibles
│   ├── app.js                  # getPanelFilteredRows + selección + chips + 13 charts
│   ├── style.css               # Diseño 2.0 renovado
│   └── ventas.csv              # copia para demo fetch
├── scripts/
│   ├── mongo-init.js
│   ├── ingest-mongo.js         # opcional fuera de Docker
│   ├── ingest-hdfs.sh / .bat
│   └── api-bridge/ (legacy)
├── datastore-auth/ (legacy v1, no usado)
├── INSTALACION.md  ← esta guía
└── README.md
```

---

## 10) Verificación Final (checklist v2)

- [ ] `docker --version` y `docker compose version` OK
- [ ] `docker compose up --build -d` → `docker compose ps` 5 servicios healthy/running
- [ ] `curl http://localhost:3000/api/health` → `{"status":"OK","mongo":true,"sales":20000}`
- [ ] `http://localhost:3000` abre landing renovada (gradiente lavanda)
- [ ] Login `admin` / `Admin123*` → Dashboard
- [ ] `Cargar ventas.csv` o `Cargar demo` → `20.000 registros` + chips
- [ ] Mover slider precio → 5 cuadros + 7 tablas se actualizan instantáneo
- [ ] Clic en fila Top5 `Laptop B` → chip `Sel. Producto: Laptop B` y TODO filtra por ese producto
- [ ] Cambiar `Fecha Desde` `2026-01-01` → `Fecha Hasta` `2026-03-31` + `Trimestre Q1` → filtra Q1
- [ ] `Día semana = Viernes` → solo viernes
- [ ] `↺ Limpiar todo` → vuelve a 20k
- [ ] `Tiempo real: ON` → dot verde pulsa y `lastUpdate` cambia cada 2.5s
- [ ] `📥 Exportar filtrados` → baja `datastore_panel_*.csv` con 7 columnas
- [ ] `http://localhost:8081` y `http://localhost:9870` abren

**¡Listo!** Stack 100% Docker, sin Cloudflare, diseño renovado, tablas escogibles y filtros completos para un estudio sólido en Windows y CachyOS.

---

## 11) Créditos

- DATASTORE S.A.C. — PIAD 625 · 2026 · v2.0 Docker Only
- Stack: Node 20 + Express 4 + MongoDB 7 + Hadoop HDFS 3.2.1 + Chart.js + Docker
- Datos: `ventas.csv` 20k — Fecha, Producto, Categoría, Cantidad, Precio, Ciudad
