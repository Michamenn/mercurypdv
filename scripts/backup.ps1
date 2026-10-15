# Backup manual do Lanchonete Pro (chama a ferramenta oficial VACUUM INTO)
# Uso: .\backup.ps1 [-Motivo "texto"]
param([string]$Motivo = "manual")

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

node -e "import('./server/src/tools/backup.js').then(m => { const { abrirBanco } = await import('./server/src/db/connection.js'); })" 2>$null
node --input-type=module -e "
import { abrirBanco } from './server/src/db/connection.js';
import { criarBackup } from './server/src/tools/backup.js';
import { config } from './server/src/config.js';
const db = abrirBanco(config.dbPath);
const r = criarBackup(db, { motivo: process.argv[2] ?? 'manual' });
console.log('Backup OK:', r.arquivo, '| integridade:', r.integrity, '| bytes:', r.bytes);
db.close();
" $Motivo

if ($LASTEXITCODE -ne 0) { Write-Host "FALHA no backup. Verifique logs." -ForegroundColor Red; exit 1 }
Write-Host "Backup concluido com verificacao de integridade." -ForegroundColor Green
