const SESSION_DURATION = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 100000;
const SESSION_COOKIE = "__Host-session";
const MAX_ATTEMPTS = 3;
const BLOCK_TIME = 5 * 60;

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derivePasswordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function encodePassword(password) {
  const salt = randomBytes(16);
  const hash = await derivePasswordHash(password, salt);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, iterations, saltText, hashText] = String(encoded).split("$");
  if (algorithm !== "pbkdf2-sha256" || Number(iterations) !== PBKDF2_ITERATIONS || !saltText || !hashText) return false;
  const candidate = await derivePasswordHash(password, fromBase64Url(saltText));
  return equalBytes(candidate, fromBase64Url(hashText));
}

function cookieHeader(token, maxAge = SESSION_DURATION) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; Path=/; Max-Age=${maxAge}; SameSite=Strict`;
}

function readSessionToken(request) {
  const cookies = request.headers.get("Cookie") || "";
  return cookies.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] || null;
}

async function parseJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function createSession(env, userId) {
  const token = toBase64Url(randomBytes(32));
  await env.SESSIONS.put(token, JSON.stringify({ userId }), { expirationTtl: SESSION_DURATION });
  return token;
}

async function currentUser(request, env) {
  const token = readSessionToken(request);
  if (!token) return null;
  const session = await env.SESSIONS.get(token, "json");
  if (!session?.userId) return null;
  return env.datastore_db.prepare("SELECT id, username FROM users WHERE id = ?").bind(session.userId).first();
}

async function requireUser(request, env) {
  return currentUser(request, env);
}

function csvRow(line, separator = ",") {
  const values = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; }
    else if (char === separator && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function normalized(value) { return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function findColumn(headers, aliases) {
  return headers.findIndex(header => aliases.some(alias => normalized(header) === normalized(alias) || normalized(header).includes(normalized(alias))));
}
function parseAmount(value) {
  const text = String(value || "").replace(/S\/|\$|\s/g, "");
  if (text.includes(",") && text.includes(".")) return Number(text.lastIndexOf(",") > text.lastIndexOf(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "")) || 0;
  return Number(text.replace(",", ".")) || 0;
}
function parseCsvDate(value) {
  const match = String(value || "").match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}

async function apiHandler(request, env, path) {
  if (path === "/api/health" && request.method === "GET") return json({ status: "OK", database: "D1" });
  if (["/api/login", "/api/verify-session", "/api/logout"].includes(path)) return handleApiAuth(request, env, path);
  const user = await requireUser(request, env);
  if (!user) return json({ success: false, error: "Sesión requerida" }, 401);
  if (path === "/api/upload" && request.method === "POST") return uploadSales(request, env);
  if (path === "/api/data" && request.method === "GET") return getSales(request, env);
  if (path === "/api/analytics" && request.method === "GET") return getAnalytics(request, env);
  if (path === "/api/filters" && request.method === "GET") return getFilters(env);
  if (path === "/api/data" && request.method === "DELETE") {
    await env.datastore_db.prepare("DELETE FROM sales").run();
    return json({ success: true, message: "Datos eliminados correctamente" });
  }
  return json({ success: false, error: "Endpoint no encontrado" }, 404);
}

async function handleApiAuth(request, env, path) {
  if (path === "/api/login" && request.method === "POST") return login(request, env);
  if (path === "/api/verify-session" && request.method === "GET") {
    const user = await currentUser(request, env);
    return json({ success: true, isLoggedIn: Boolean(user), user: user?.username || null }, user ? 200 : 401);
  }
  if (path === "/api/logout" && request.method === "POST") return logout(request, env);
  return json({ success: false, error: "Método no permitido" }, 405);
}

async function login(request, env) {
  const body = await parseJson(request); const username = String(body?.username || "").trim().toLowerCase(); const password = String(body?.password || "");
  const blocked = await env.SESSIONS.get(`blocked:${username}`, "json");
  if (blocked) return json({ success: false, message: "Demasiados intentos. Espera 5 minutos.", blocked: true }, 429);
  const user = await env.datastore_db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").bind(username).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    const key = `attempts:${username}`; const attempts = Number(await env.SESSIONS.get(key) || 0) + 1;
    await env.SESSIONS.put(key, String(attempts), { expirationTtl: BLOCK_TIME });
    if (attempts >= MAX_ATTEMPTS) await env.SESSIONS.put(`blocked:${username}`, JSON.stringify({ blocked: true }), { expirationTtl: BLOCK_TIME });
    return json({ success: false, message: "Usuario o contraseña incorrectos.", remaining: Math.max(0, MAX_ATTEMPTS - attempts) }, 401);
  }
  await env.SESSIONS.delete(`attempts:${username}`); const token = await createSession(env, user.id);
  return json({ success: true, user: user.username }, 200, { "Set-Cookie": cookieHeader(token) });
}

async function logout(request, env) {
  const token = readSessionToken(request); if (token) await env.SESSIONS.delete(token);
  await env.datastore_db.prepare("DELETE FROM sales").run();
  return json({ success: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
}

async function uploadSales(request, env) {
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File)) return json({ success: false, error: "No se recibió ningún archivo CSV" }, 400);
  const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean); if (lines.length < 2) return json({ success: false, error: "El CSV está vacío" }, 400);
  const separator = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ","; const headers = csvRow(lines[0], separator);
  const columns = { date: findColumn(headers, ["fecha", "date"]), product: findColumn(headers, ["producto", "product"]), category: findColumn(headers, ["categoría", "categoria", "category"]), quantity: findColumn(headers, ["cantidad", "quantity"]), amount: findColumn(headers, ["importe", "venta", "monto", "total", "precio"]), location: findColumn(headers, ["ciudad", "city", "sede"]) };
  if (Object.values(columns).some(index => index < 0)) return json({ success: false, error: "Columnas requeridas no encontradas", availableHeaders: headers }, 400);
  await env.datastore_db.prepare("DELETE FROM sales").run(); const statements = [];
  for (const line of lines.slice(1)) { const row = csvRow(line, separator); const date = parseCsvDate(row[columns.date]); if (!date) continue; const quantity = parseAmount(row[columns.quantity]); const rawAmount = parseAmount(row[columns.amount]); const amount = normalized(headers[columns.amount]) === "precio" ? quantity * rawAmount : rawAmount; statements.push(env.datastore_db.prepare("INSERT INTO sales (date, product, category, quantity, amount, location) VALUES (?, ?, ?, ?, ?, ?)").bind(date, row[columns.product] || "Sin producto", row[columns.category] || "Sin categoría", quantity, amount, row[columns.location] || "Sin sede")); if (statements.length === 50) { await env.datastore_db.batch(statements.splice(0)); } }
  if (statements.length) await env.datastore_db.batch(statements);
  const summary = await env.datastore_db.prepare("SELECT COUNT(*) totalRecords, COALESCE(SUM(amount),0) totalSales, COALESCE(SUM(quantity),0) totalQuantity FROM sales").first();
  return json({ success: true, summary, message: `Se procesaron ${summary.totalRecords} registros correctamente` });
}

function filters(request) { const url = new URL(request.url); return { year: url.searchParams.get("year"), month: url.searchParams.get("month"), location: url.searchParams.get("location") }; }
function where(filters, params) { let clause = " WHERE 1=1"; if (filters.year && filters.year !== "all") { clause += " AND strftime('%Y', date) = ?"; params.push(filters.year); } if (filters.month && filters.month !== "all") { clause += " AND strftime('%m', date) = ?"; params.push(String(filters.month).padStart(2, "0")); } if (filters.location && filters.location !== "all") { clause += " AND location = ?"; params.push(filters.location); } return clause; }
async function getSales(request, env) { const params = []; const result = await env.datastore_db.prepare(`SELECT * FROM sales${where(filters(request), params)} ORDER BY date DESC`).bind(...params).all(); return json({ success: true, data: result.results, totalRecords: result.results.length }); }
async function getFilters(env) { const years = await env.datastore_db.prepare("SELECT DISTINCT strftime('%Y', date) year FROM sales ORDER BY year DESC").all(); const locations = await env.datastore_db.prepare("SELECT DISTINCT location FROM sales ORDER BY location").all(); return json({ success: true, years: years.results.map(row => row.year), locations: locations.results.map(row => row.location) }); }
async function getAnalytics(request, env) { const params = []; const clause = where(filters(request), params); const totals = await env.datastore_db.prepare(`SELECT COALESCE(SUM(amount),0) totalSales, COALESCE(SUM(quantity),0) totalQuantity, COUNT(*) transactions, COALESCE(AVG(amount),0) averageSale FROM sales${clause}`).bind(...params).first(); const categories = await env.datastore_db.prepare(`SELECT category label, SUM(amount) value FROM sales${clause} GROUP BY category ORDER BY value DESC`).bind(...params).all(); const products = await env.datastore_db.prepare(`SELECT product label, SUM(quantity) value FROM sales${clause} GROUP BY product ORDER BY value DESC`).bind(...params).all(); const locations = await env.datastore_db.prepare(`SELECT location label, SUM(amount) value FROM sales${clause} GROUP BY location ORDER BY value DESC`).bind(...params).all(); return json({ success: true, data: { ...totals, categories: categories.results, products: products.results, locations: locations.results, topProduct: products.results[0]?.label || "N/A", topLocation: locations.results[0]?.label || "N/A" } }); }

async function handleApi(request, env, path) {
  if (path === "/register" && request.method === "POST") {
    const body = await parseJson(request);
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!/^[a-z0-9._-]{3,50}$/.test(username) || password.length < 8 || password.length > 200) {
      return json({ error: "Usuario inválido o contraseña de 8 a 200 caracteres" }, 400);
    }
    try {
      await env.datastore_db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").bind(username, await encodePassword(password)).run();
      return json({ success: true }, 201);
    } catch { return json({ error: "El usuario ya existe" }, 409); }
  }

  if (path === "/login" && request.method === "POST") {
    const body = await parseJson(request);
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const user = await env.datastore_db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").bind(username).first();
    if (!user || !(await verifyPassword(password, user.password_hash))) return json({ error: "Credenciales inválidas" }, 401);
    const token = await createSession(env, user.id);
    return json({ success: true, user: user.username }, 200, { "Set-Cookie": cookieHeader(token) });
  }

  if (path === "/me" && request.method === "GET") {
    const user = await currentUser(request, env);
    return user ? json({ authenticated: true, user: user.username }) : json({ authenticated: false }, 401);
  }

  if (path === "/logout" && request.method === "POST") {
    const token = readSessionToken(request);
    if (token) await env.SESSIONS.delete(token);
    await env.datastore_db.prepare("DELETE FROM sales").run();
    return json({ success: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return apiHandler(request, env, url.pathname);
    if (["/register", "/login", "/me", "/logout"].includes(url.pathname)) {
      return (await handleApi(request, env, url.pathname)) || json({ error: "Método no permitido" }, 405);
    }
    return env.ASSETS.fetch(request);
  },
};
