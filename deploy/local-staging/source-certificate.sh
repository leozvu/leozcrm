#!/bin/sh
# This file must stay LF-only because Alpine executes it from a Windows bind mount.
set -eu

if [ -s /certs/ca/source-cert.pem ] && [ -s /certs/server/source-key.pem ]; then
  chown 1000:1000 /certs/server/source-key.pem /certs/ca/source-cert.pem
  chmod 600 /certs/server/source-key.pem
  chmod 644 /certs/ca/source-cert.pem
  exit 0
fi

apk add --no-cache openssl >/dev/null
umask 077
mkdir -p /certs/ca /certs/server
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 30 \
  -subj '/CN=repositoryrealms-source.local' \
  -addext 'subjectAltName=DNS:repositoryrealms-source.local,DNS:localhost,IP:127.0.0.1' \
  -keyout /certs/server/source-key.pem \
  -out /certs/ca/source-cert.pem >/dev/null 2>&1
chown 1000:1000 /certs/server/source-key.pem /certs/ca/source-cert.pem
chmod 600 /certs/server/source-key.pem
chmod 644 /certs/ca/source-cert.pem
