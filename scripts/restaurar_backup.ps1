# Restauracao de backup do Lanchonete Pro
# IMPORTANTE: para o servidor antes de restaurar (scripts\parar_sistema.bat)
# Uso: .\restaurar_backup.ps1 -Arquivo "lanchonete-2026-10-12T10-00-00-000Z.sqlite"
#      .\restaurar_backup.ps1 -Arquivo "..." -Destino "D:\lanchonete-restaurada\banco.sqlite"
param(
  [Parameter(Mandatory = $true)][string]$Arquivo,
  [string]$Destino = ""
)

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

# servidor ativo? bloqueia
$ativo = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($ativo) {
  Write-Host "ERRO: o servidor esta ATIVO. Execute scripts\parar_sistema.bat antes de restaurar." -ForegroundColor Red
  exit 1
}

if (-not $Destino) { $Destino = Join-Path $raiz "data\lanchonete.sqlite" }

if (-not (Test-Path $Destino -PathType Leaf -ErrorAction SilentlyContinue) -and -not (Test-Path (Split-Path -Parent $Destino))) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destino) | Out-Null
}

Write-Host "Destino da restauracao: $Destino"
Write-Host "Backup: $Arquivo"
$conf = Read-Host "SOBRESCREVER o banco atual com este backup? Digite RESTAURAR para confirmar"
if ($conf -ne "RESTAURAR") { Write-Host "Cancelado."; exit 1 }

node --input-type=module -e "
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const origem = path.join(process.cwd(), 'backups', process.argv[2]);
if (!fs.existsSync(origem)) { console.error('Backup nao encontrado:', origem); process.exit(1); }
const v = new DatabaseSync(origem, { readOnly: true });
const chk = v.prepare('PRAGMA integrity_check').get();
v.close();
if (chk.integrity_check !== 'ok') { console.error('Backup corrompido:', chk.integrity_check); process.exit(1); }
fs.copyFileSync(origem, process.argv[3]);
const d = new DatabaseSync(process.argv[3], { readOnly: true });
const n = d.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n;
const u = d.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
d.close();
console.log('Restaurado com integridade OK. Pedidos:', n, '| Usuarios:', u);
" $Arquivo $Destino

if ($LASTEXITCODE -ne 0) { Write-Host "FALHA na restauracao." -ForegroundColor Red; exit 1 }
Write-Host "Restauracao concluida. Copia do banco anterior pode estar em backups\ (facca backup antes sempre)." -ForegroundColor Green
