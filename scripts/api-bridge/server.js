import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL || 'mongodb://datastore:datastore123@localhost:27017/datastore?authSource=admin';
const PORT = 3000;
let db;

async function connect() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db();
  console.log('✅ Conectado a MongoDB', MONGO_URL.replace(/\/\/.*@/, '//***@'));
}
await connect();

// Filtros comunes: ?year=2026&month=5&city=Lima&category=Computadoras&priceMin=0&priceMax=5000&q=texto&sort=ventas_desc
function buildMatch(q) {
  const match = {};
  if (q.year && q.year !== 'all') match.$expr = { $eq: [{ $year: '$date' }, Number(q.year)] };
  // month filter se aplica aparte si year ya usa $expr, combinamos con $and
  const and = [];
  if (q.year && q.year !== 'all') and.push({ $expr: { $eq: [{ $year: '$date' }, Number(q.year)] } });
  if (q.month && q.month !== 'all') and.push({ $expr: { $eq: [{ $month: '$date' }, Number(q.month)] } });
  if (q.city && q.city !== 'all') match.location = q.city;
  if (q.category && q.category !== 'all') match.category = q.category;
  if (q.q) match.product = { $regex: q.q, $options: 'i' };
  if (q.priceMin || q.priceMax) match.price = {};
  if (q.priceMin) match.price.$gte = Number(q.priceMin);
  if (q.priceMax) match.price.$lte = Number(q.priceMax);
  if (q.qtyMin || q.qtyMax) match.quantity = {};
  if (q.qtyMin) match.quantity.$gte = Number(q.qtyMin);
  if (q.qtyMax) match.quantity.$lte = Number(q.qtyMax);
  // limpiar vacíos
  if (match.price && Object.keys(match.price).length === 0) delete match.price;
  if (match.quantity && Object.keys(match.quantity).length === 0) delete match.quantity;
  if (and.length) {
    return and.length === 1 ? { ...match, ...and[0] } : { ...match, $and: and };
  }
  return match;
}

app.get('/api/health', (req, res) => res.json({ status: 'OK', mongo: !!db }));

app.get('/api/filters', async (req, res) => {
  const years = await db.collection('sales').aggregate([{ $group: { _id: { $year: '$date' } } }, { $sort: { _id: 1 } }]).toArray();
  const cities = await db.collection('sales').distinct('location');
  const categories = await db.collection('sales').distinct('category');
  res.json({ years: years.map(y => String(y._id)), cities: cities.sort(), categories: categories.sort() });
});

app.get('/api/analytics', async (req, res) => {
  const match = buildMatch(req.query);
  const pipeline = [{ $match: match }];
  const totals = await db.collection('sales').aggregate([...pipeline, { $group: { _id: null, totalSales: { $sum: '$amount' }, totalQty: { $sum: '$quantity' }, count: { $sum: 1 }, avgSale: { $avg: '$amount' }, avgPrice: { $avg: '$price' } } }]).toArray();
  const byCat = await db.collection('sales').aggregate([...pipeline, { $group: { _id: '$category', value: { $sum: '$amount' }, qty: { $sum: '$quantity' } } }, { $sort: { value: -1 } }]).toArray();
  const byProd = await db.collection('sales').aggregate([...pipeline, { $group: { _id: '$product', value: { $sum: '$quantity' }, sales: { $sum: '$amount' } } }, { $sort: { value: -1 } }]).toArray();
  const byCity = await db.collection('sales').aggregate([...pipeline, { $group: { _id: '$location', value: { $sum: '$amount' } } }, { $sort: { value: -1 } }]).toArray();
  res.json({ totals: totals[0] || {}, categories: byCat, products: byProd, cities: byCity });
});

app.listen(PORT, () => console.log(`🚀 API bridge en http://localhost:${PORT}`));
