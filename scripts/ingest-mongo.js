/**
 * Ingesta ventas.csv -> MongoDB (datastore.sales)
 * Uso: node ingest-mongo.js [rutaCSV] [mongoUrl]
 * Default: ./ventas.csv y mongodb://datastore:datastore123@localhost:27017/datastore?authSource=admin
 */
import fs from 'fs';
import { MongoClient } from 'mongodb';

const csvPath = process.argv[2] || '../ventas.csv';
const mongoUrl = process.argv[3] || process.env.MONGO_URL || 'mongodb://datastore:datastore123@localhost:27017/datastore?authSource=admin';

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());
  const idx = {
    fecha: headers.findIndex(h => /fecha/i.test(h)),
    producto: headers.findIndex(h => /producto/i.test(h)),
    categoria: headers.findIndex(h => /categor/i.test(h)),
    cantidad: headers.findIndex(h => /cantidad/i.test(h)),
    precio: headers.findIndex(h => /precio/i.test(h)),
    ciudad: headers.findIndex(h => /ciudad|sede/i.test(h)),
  };
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const cantidad = Number(cols[idx.cantidad]) || 0;
    const precio = Number(cols[idx.precio]) || 0;
    const [d, m, y] = (cols[idx.fecha] || '').split('/').map(Number);
    if (!y) continue;
    rows.push({
      date: new Date(y, m - 1, d),
      product: cols[idx.producto]?.trim() || 'Sin producto',
      category: cols[idx.categoria]?.trim() || 'Sin categoría',
      quantity: cantidad,
      price: precio,
      amount: cantidad * precio,
      location: cols[idx.ciudad]?.trim() || 'Sin sede',
      city: cols[idx.ciudad]?.trim() || 'Sin sede',
      source: 'ventas.csv',
      ingestedAt: new Date(),
    });
  }
  return rows;
}

async function main() {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const docs = parseCSV(text);
  console.log(`📄 CSV leído: ${docs.length} registros desde ${csvPath}`);
  const client = new MongoClient(mongoUrl);
  await client.connect();
  const db = client.db();
  const col = db.collection('sales');
  await col.deleteMany({});
  if (docs.length) {
    // batch 1000
    for (let i = 0; i < docs.length; i += 1000) {
      await col.insertMany(docs.slice(i, i + 1000), { ordered: false });
      console.log(` → insertados ${Math.min(i + 1000, docs.length)}/${docs.length}`);
    }
  }
  const stats = await col.aggregate([
    { $group: { _id: null, totalSales: { $sum: '$amount' }, totalQty: { $sum: '$quantity' }, count: { $sum: 1 } } },
  ]).toArray();
  console.log('✅ Ingesta MongoDB completada:', stats[0]);
  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
