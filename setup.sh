#!/usr/bin/env bash
# example .env:
#
# export NODE_ENV=production
# export POSTGRES_PASSWORD=nestrischamps
# export POSTGRES_USER=nestrischamps
# export POSTGRES_DB=nestrischamps
# export SESSION_SECRET=1234567890ABCDEF
# export FF_SAVE_GAME_FRAMES=1
# export TLS_CERT=certs/cert.pem
# export TLS_KEY=certs/key.pem

echo "Generating self signed cert"
&>/dev/null openssl req \
    -x509 \
    -newkey rsa:4096 \
    -keyout key.pem \
    -out cert.pem \
    -sha256 \
    -days 3650 \
    -nodes \
    -subj "/C=XX/ST=State/L=City/O=NTC/OU=NTC/CN=localhost"

echo "creating ./certs"
mkdir -p certs
mv ./*.pem certs/

source .env

echo "starting docker"
docker compose up -d

echo "waiting for db"
sleep 2

echo "setting up db"
>/dev/null docker exec nestrischamps-db-1 psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -f /setup/db.sql
