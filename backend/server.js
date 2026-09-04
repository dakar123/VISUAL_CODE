import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId } from 'mongodb';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://datastore:datastore123@mongodb:27017/datastore?authSource=admin';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

console.log('🚀 Iniciando DATASTORE Backend Docker');
console.log('   MONGO_URL:', MONGO_URL.replace(/\/\/.*@/, '//***@'));

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static frontend - serve public
const publicPath = path.join(__dirname, 'public');
const altPublicPath = path.join(__dirname, '..', 'public');
let staticPath = publicPath;
if (!fs.existsSync(publicPath) && fs.existsSync(altPublicPath)) staticPath = altPublicPath;
console.log('📁 Static path:', staticPath, fs.existsSync(staticPath) ? 'OK' : 'NOT FOUND - se montará via volumen');

if (fs.existsSync(staticPath)) {
  app.use(express.static(staticPath, { extensions: ['html'] }));
}

// Multer for CSV upload (memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Mongo
let db, usersCol, salesCol, sessionsCol;
let mongoConnected = false;

async function connectMongo() {
  let attempts = 0;
  while (attempts < 30) {
    try {
      const client = new MongoClient(MONGO_URL);
      await client.connect();
      db = client.db();
      usersCol = db.collection('users');
      salesCol = db.collection('sales');
      sessionsCol = db.collection('sessions');
      await usersCol.createIndex({ username: 1 }, { unique: true });
      await salesCol.createIndex({ date: 1 });
      await salesCol.createIndex({ location: 1 });
      await salesCol.createIndex({ category: 1 });
      await salesCol.createIndex({ product: 1 });
      await salesCol.createIndex({ price: 1 });
      await salesCol.createIndex({ amount: 1 });
      await sessionsCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      mongoConnected = true;
      console.log('✅ MongoDB conectado:', db.databaseName);
      // seed admin if not exists
      const adminExists = await usersCol.findOne({ username: 'admin' });
      if (!adminExists) {
        const hash = await bcrypt.hash('Admin123*', 10);
        await usersCol.insertOne({ username: 'admin', password_hash: hash, createdAt: new Date() });
        console.log('👤 Usuario seed creado: admin / Admin123*');
      }
      // seed demo sales from ventas.csv if empty
      const salesCount = await salesCol.countDocuments();
      if (salesCount === 0) {
        const csvCandidates = [
          path.join(staticPath, 'ventas.csv'),
          path.join(__dirname, 'ventas.csv'),
          path.join(__dirname, '..', 'ventas.csv'),
          '/app/ventas.csv'
        ];
        for (const p of csvCandidates) {
          if (fs.existsSync(p)) {
            console.log('📄 Seed ventas.csv encontrado:', p);
            try {
              const text = fs.readFileSync(p, 'utf-8');
              const docs = parseCsvToDocs(text);
              if (docs.length) {
                await salesCol.insertMany(docs, { ordered: false });
                console.log(`   → Seed ${docs.length} registros insertados`);
              }
            } catch (e) { console.error('   Seed error:', e.message); }
            break;
          }
        }
      } else {
        console.log(`📊 Sales existentes: ${salesCount} registros`);
      }
      return;
    } catch (e) {
      attempts++;
      console.log(`⏳ Mongo intento ${attempts}/30: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('❌ No se pudo conectar a MongoDB tras 30 intentos - backend funcionará en modo memoria');
}
connectMongo();

// Helpers
function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function generateToken() {
  return toBase64Url(crypto.randomBytes(32));
}
function getSessionToken(req) {
  return req.cookies?.session || req.cookies?.['__Host-session'] || req.headers['x-session-token'] || null;
}
async function getCurrentUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  if (mongoConnected) {
    const sess = await sessionsCol.findOne({ token, expiresAt: { $gt: new Date() } });
    if (!sess) return null;
    const user = await usersCol.findOne({ _id: sess.userId });
    return user;
  }
  return null; // modo memoria no persiste sesión, pero igual permite demo sin auth
}
function csvRow(line, sep = ',') {
  const vals = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { vals.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  vals.push(cur.trim());
  return vals;
}
function normalized(v) { return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function findColumn(headers, aliases) {
  return headers.findIndex(h => aliases.some(a => normalized(h) === normalized(a) || normalized(h).includes(normalized(a))));
}
function parseAmount(v) {
  const t = String(v || '').replace(/S\/|\$|\s/g, '');
  if (t.includes(',') && t.includes('.')) return Number(t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')) || 0;
  return Number(t.replace(',', '.')) || 0;
}
function parseCsvDate(v) {
  const m = String(v || '').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}
function parseCsvToDocs(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const headers = csvRow(lines[0], sep);
  const cols = {
    date: findColumn(headers, ['fecha', 'date']),
    product: findColumn(headers, ['producto', 'product']),
    category: findColumn(headers, ['categoria', 'categoría', 'category']),
    quantity: findColumn(headers, ['cantidad', 'quantity']),
    amount: findColumn(headers, ['importe', 'venta', 'monto', 'total', 'precio']),
    location: findColumn(headers, ['ciudad', 'city', 'sede'])
  };
  if (Object.values(cols).some(i => i < 0)) throw new Error('Columnas requeridas no encontradas: ' + headers.join(','));
  const isPrice = normalized(headers[cols.amount]) === 'precio';
  const docs = [];
  for (const line of lines.slice(1)) {
    const row = csvRow(line, sep);
    const d = parseCsvDate(row[cols.date]);
    if (!d) continue;
    const qty = parseAmount(row[cols.quantity]);
    const raw = parseAmount(row[cols.amount]);
    const priceUnit = isPrice ? raw : (qty ? raw / qty : raw);
    const amount = isPrice ? qty * raw : raw;
    docs.push({
      date: d,
      product: row[cols.product] || 'Sin producto',
      category: row[cols.category] || 'Sin categoría',
      quantity: qty,
      price: priceUnit,
      amount: amount,
      location: row[cols.location] || 'Sin sede',
      city: row[cols.location] || 'Sin sede',
      createdAt: new Date()
    });
  }
  return docs;
}

// Auth routes (compat both /api/auth/* and legacy /login etc)
async function handleRegister(req, res) {
  const { username, password } = req.body || {};
  const u = String(username || '').trim().toLowerCase();
  const p = String(password || '');
  if (!/^[a-z0-9._-]{3,50}$/.test(u)) return res.status(400).json({ error: 'Usuario inválido (3-50, a-z 0-9 . _ -)' });
  if (p.length < 6 || p.length > 200) return res.status(400).json({ error: 'Contraseña 6-200 caracteres' });
  if (!mongoConnected) return res.status(503).json({ error: 'Mongo no conectado' });
  try {
    const hash = await bcrypt.hash(p, 10);
    await usersCol.insertOne({ username: u, password_hash: hash, createdAt: new Date() });
    return res.status(201).json({ success: true, user: u });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'El usuario ya existe' });
    return res.status(500).json({ error: e.message });
  }
}
async function handleLogin(req, res) {
  const { username, password } = req.body || {};
  const u = String(username || '').trim().toLowerCase();
  const p = String(password || '');
  if (!mongoConnected) {
    // modo demo sin mongo: acepta admin/Admin123*
    if (u === 'admin' && p === 'Admin123*') {
      const token = generateToken();
      res.cookie('session', token, { httpOnly: true, sameSite: 'Lax', maxAge: SESSION_DURATION_MS, path: '/' });
      return res.json({ success: true, user: u });
    }
    return res.status(503).json({ error: 'Mongo no conectado - usa admin/Admin123* en modo demo' });
  }
  const user = await usersCol.findOne({ username: u });
  if (!user || !(await bcrypt.compare(p, user.password_hash))) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const token = generateToken();
  await sessionsCol.insertOne({ token, userId: user._id, username: user.username, createdAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DURATION_MS) });
  res.cookie('session', token, { httpOnly: true, sameSite: 'Lax', maxAge: SESSION_DURATION_MS, path: '/' });
  res.cookie('__Host-session', token, { httpOnly: true, sameSite: 'Strict', maxAge: SESSION_DURATION_MS / 1000, path: '/', secure: false });
  return res.json({ success: true, user: user.username });
}
async function handleMe(req, res) {
  if (!mongoConnected) {
    const tok = getSessionToken(req);
    if (tok) return res.json({ authenticated: true, user: 'demo' });
    return res.status(401).json({ authenticated: false });
  }
  const user = await getCurrentUser(req);
  if (user) return res.json({ authenticated: true, user: user.username });
  return res.status(401).json({ authenticated: false });
}
async function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (mongoConnected && token) await sessionsCol.deleteOne({ token });
  res.clearCookie('session', { path: '/' });
  res.clearCookie('__Host-session', { path: '/' });
  // opcional: limpiar sales al cerrar sesión? el worker lo hacía, aquí no borramos para persistencia
  return res.json({ success: true });
}

// Register routes
app.post('/register', handleRegister);
app.post('/api/register', handleRegister);
app.post('/api/auth/register', handleRegister);

app.post('/login', handleLogin);
app.post('/api/login', handleLogin);
app.post('/api/auth/login', handleLogin);

app.get('/me', handleMe);
app.get('/api/me', handleMe);
app.get('/api/auth/me', handleMe);
app.get('/api/verify-session', handleMe);

app.post('/logout', handleLogout);
app.post('/api/logout', handleLogout);
app.post('/api/auth/logout', handleLogout);

// Health
app.get('/api/health', async (req, res) => {
  let salesCount = 0;
  if (mongoConnected) salesCount = await salesCol.countDocuments();
  res.json({ status: 'OK', mongo: mongoConnected, sales: salesCount, hdfs: 'hdfs://namenode:9000', version: '2.0-docker' });
});

// Upload CSV
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });
    const text = req.file.buffer.toString('utf-8');
    const docs = parseCsvToDocs(text);
    if (!docs.length) return res.status(400).json({ success: false, error: 'CSV vacío o sin filas válidas' });
    if (!mongoConnected) return res.status(503).json({ success: false, error: 'Mongo no conectado, datos solo en memoria (frontend)' });
    await salesCol.deleteMany({});
    // insert batch
    for (let i = 0; i < docs.length; i += 1000) {
      await salesCol.insertMany(docs.slice(i, i + 1000), { ordered: false });
    }
    const summary = await salesCol.aggregate([
      { $group: { _id: null, totalRecords: { $sum: 1 }, totalSales: { $sum: '$amount' }, totalQuantity: { $sum: '$quantity' } } }
    ]).toArray();
    // Intentar copiar a HDFS si está disponible (vía copia local, el docker-compose ya monta /datastore)
    try {
      const hdfsPath = '/tmp/ventas_backend.csv';
      fs.writeFileSync(hdfsPath, text);
      console.log('📄 CSV guardado temporal para HDFS:', hdfsPath);
    } catch {}
    res.json({ success: true, summary: summary[0] || { totalRecords: docs.length }, message: `Se procesaron ${docs.length} registros` });
  } catch (e) {
    console.error('upload error', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Helpers for filters
function buildMatch(query) {
  const match = {};
  const and = [];
  if (query.year && query.year !== 'all') and.push({ $expr: { $eq: [{ $year: '$date' }, Number(query.year)] } });
  if (query.month && query.month !== 'all') and.push({ $expr: { $eq: [{ $month: '$date' }, Number(query.month)] } });
  if (query.location && query.location !== 'all') match.location = query.location;
  if (query.city && query.city !== 'all') match.location = query.city;
  if (query.category && query.category !== 'all') match.category = query.category;
  if (query.product && query.product !== 'all') match.product = query.product;
  if (query.q) match.product = { $regex: query.q, $options: 'i' };
  if (query.priceMin || query.priceMax) {
    match.price = {};
    if (query.priceMin) match.price.$gte = Number(query.priceMin);
    if (query.priceMax) match.price.$lte = Number(query.priceMax);
    if (Object.keys(match.price).length === 0) delete match.price;
  }
  if (query.quantityMin || query.qtyMin) {
    match.quantity = match.quantity || {};
    if (query.quantityMin) match.quantity.$gte = Number(query.quantityMin);
    if (query.qtyMin) match.quantity.$gte = Number(query.qtyMin);
  }
  if (query.quantityMax || query.qtyMax) {
    match.quantity = match.quantity || {};
    if (query.quantityMax) match.quantity.$lte = Number(query.quantityMax);
    if (query.qtyMax) match.quantity.$lte = Number(query.qtyMax);
  }
  if (match.quantity && Object.keys(match.quantity).length === 0) delete match.quantity;
  if (query.amountMin) { match.amount = match.amount || {}; match.amount.$gte = Number(query.amountMin); }
  if (query.amountMax) { match.amount = match.amount || {}; match.amount.$lte = Number(query.amountMax); }
  if (match.amount && Object.keys(match.amount).length === 0) delete match.amount;
  if (query.dateFrom || query.dateTo) {
    match.date = {};
    if (query.dateFrom) match.date.$gte = new Date(query.dateFrom);
    if (query.dateTo) match.date.$lte = new Date(query.dateTo + 'T23:59:59');
    if (Object.keys(match.date).length === 0) delete match.date;
  }
  if (query.quarter && query.quarter !== 'all') {
    const q = Number(query.quarter);
    const qStart = (q - 1) * 3 + 1;
    const qEnd = q * 3;
    and.push({ $expr: { $and: [{ $gte: [{ $month: '$date' }, qStart] }, { $lte: [{ $month: '$date' }, qEnd] }] } });
  }
  if (query.weekday && query.weekday !== 'all') {
    const wd = Number(query.weekday) + 1;
    and.push({ $expr: { $eq: [{ $dayOfWeek: '$date' }, wd] } });
  }
  if (and.length) {
    return { ...match, $and: and };
  }
  return match;
}

// GET /api/data
app.get('/api/data', async (req, res) => {
  if (!mongoConnected) return res.json({ success: true, data: [], totalRecords: 0, note: 'Mongo no conectado - usa modo frontend local' });
  const match = buildMatch(req.query);
  const docs = await salesCol.find(match).sort({ date: -1 }).limit(5000).toArray();
  res.json({ success: true, data: docs, totalRecords: docs.length });
});
app.delete('/api/data', async (req, res) => {
  if (!mongoConnected) return res.json({ success: true, message: 'Sin mongo' });
  await salesCol.deleteMany({});
  res.json({ success: true, message: 'Datos eliminados' });
});

// GET /api/filters
app.get('/api/filters', async (req, res) => {
  if (!mongoConnected) return res.json({ success: true, years: [], locations: [], categories: [], products: [] });
  const yearsAgg = await salesCol.aggregate([{ $group: { _id: { $year: '$date' } } }, { $sort: { _id: 1 } }]).toArray();
  const years = yearsAgg.map(y => String(y._id)).filter(Boolean);
  const locations = await salesCol.distinct('location');
  const categories = await salesCol.distinct('category');
  const products = await salesCol.distinct('product');
  res.json({ success: true, years: years.sort(), locations: locations.sort(), categories: categories.sort(), products: products.sort() });
});

// GET /api/analytics
app.get('/api/analytics', async (req, res) => {
  if (!mongoConnected) return res.json({ success: true, data: { totalSales: 0, totalQuantity: 0, transactions: 0, averageSale: 0 } });
  const match = buildMatch(req.query);
  const totals = await salesCol.aggregate([
    { $match: match },
    { $group: { _id: null, totalSales: { $sum: '$amount' }, totalQuantity: { $sum: '$quantity' }, transactions: { $sum: 1 }, averageSale: { $avg: '$amount' }, avgPrice: { $avg: '$price' } } }
  ]).toArray();
  const categories = await salesCol.aggregate([{ $match: match }, { $group: { _id: '$category', value: { $sum: '$amount' }, qty: { $sum: '$quantity' } } }, { $sort: { value: -1 } }]).toArray();
  const products = await salesCol.aggregate([{ $match: match }, { $group: { _id: '$product', value: { $sum: '$quantity' }, sales: { $sum: '$amount' } } }, { $sort: { value: -1 } }]).toArray();
  const locations = await salesCol.aggregate([{ $match: match }, { $group: { _id: '$location', value: { $sum: '$amount' } } }, { $sort: { value: -1 } }]).toArray();
  const t = totals[0] || { totalSales: 0, totalQuantity: 0, transactions: 0, averageSale: 0, avgPrice: 0 };
  res.json({
    success: true,
    data: {
      totalSales: t.totalSales,
      totalQuantity: t.totalQuantity,
      transactions: t.transactions,
      averageSale: t.averageSale,
      avgPrice: t.avgPrice,
      categories: categories.map(c => ({ label: c._id, value: c.value, qty: c.qty })),
      products: products.map(p => ({ label: p._id, value: p.value, sales: p.sales })),
      locations: locations.map(l => ({ label: l._id, value: l.value })),
      topProduct: products[0]?._id || 'N/A',
      topLocation: locations[0]?._id || 'N/A'
    }
  });
});

// Fallback SPA
app.get('*', (req, res) => {
  const indexPath = path.join(staticPath, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('Frontend no encontrado - verifica volumen ./public');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend escuchando en http://0.0.0.0:${PORT}`);
  console.log(`   Salud: http://localhost:${PORT}/api/health`);
});
