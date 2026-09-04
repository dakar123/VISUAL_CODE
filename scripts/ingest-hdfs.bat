@echo off
REM Ingesta ventas.csv -> HDFS para Windows
set CSV_PATH=%1
if "%CSV_PATH%"=="" set CSV_PATH=..\ventas.csv
set CONTAINER=datastore-namenode
set HDFS_DEST=/datastore/ventas.csv

if not exist "%CSV_PATH%" (
  echo No se encontro %CSV_PATH%
  exit /b 1
)

echo Esperando namenode...
:wait
docker exec %CONTAINER% hdfs dfs -ls / >nul 2>&1
if errorlevel 1 (
  echo  intento...
  timeout /t 2 >nul
  goto wait
)

echo Creando directorio HDFS /datastore
docker exec %CONTAINER% hdfs dfs -mkdir -p /datastore
echo Subiendo %CSV_PATH% -> hdfs://%HDFS_DEST%
docker cp "%CSV_PATH%" %CONTAINER%:/tmp/ventas.csv
docker exec %CONTAINER% hdfs dfs -put -f /tmp/ventas.csv %HDFS_DEST%
docker exec %CONTAINER% hdfs dfs -ls -h /datastore/
echo Ingesta HDFS completada
echo Web UI: http://localhost:9870/explorer.html#/datastore
