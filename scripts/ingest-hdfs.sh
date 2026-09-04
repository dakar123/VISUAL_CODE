#!/usr/bin/env bash
set -e
# Ingesta ventas.csv -> HDFS (/datastore/ventas.csv)
# Requiere docker compose con namenode corriendo
# Uso: ./ingest-hdfs.sh [rutaCSV]

CSV_PATH="${1:-../ventas.csv}"
HDFS_DEST="/datastore/ventas.csv"
CONTAINER="datastore-namenode"

if [ ! -f "$CSV_PATH" ]; then
  echo "❌ No se encontró $CSV_PATH"
  exit 1
fi

# Esperar namenode
echo "⏳ Esperando namenode..."
for i in {1..30}; do
  if docker exec $CONTAINER hdfs dfs -ls / >/dev/null 2>&1; then
    break
  fi
  echo "  intento $i/30..."
  sleep 2
done

echo "📁 Creando directorio HDFS /datastore"
docker exec $CONTAINER hdfs dfs -mkdir -p /datastore

echo "📤 Subiendo $CSV_PATH -> hdfs://$HDFS_DEST"
docker cp "$CSV_PATH" $CONTAINER:/tmp/ventas.csv
docker exec $CONTAINER hdfs dfs -put -f /tmp/ventas.csv $HDFS_DEST
docker exec $CONTAINER hdfs dfs -ls -h /datastore/
docker exec $CONTAINER hdfs dfs -cat $HDFS_DEST | head -5

echo "✅ HDFS ingesta completada: hdfs://namenode:9000$HDFS_DEST"
echo "🌐 Web UI: http://localhost:9870/explorer.html#/datastore"
