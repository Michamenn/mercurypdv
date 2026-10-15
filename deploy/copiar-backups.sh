#!/usr/bin/env bash
# Exporta os backups do volume 'vol_backups' para C:\BackupsMercuryPDV (visivel no Windows).
# Execute DENTRO do WSL2:  bash ~/mercurypdv/deploy/copiar-backups.sh
set -euo pipefail

DESTINO="/mnt/c/BackupsMercuryPDV"
mkdir -p "$DESTINO"

docker run --rm \
  -v mercury-pdv_vol_backups:/backups:ro \
  -v "$DESTINO":/destino \
  alpine sh -c 'cp /backups/*.sqlite /destino/ 2>/dev/null || true; ls -la /destino'

echo "[OK] Backups copiados para C:\\BackupsMercuryPDV"
