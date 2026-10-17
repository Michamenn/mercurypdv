import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

function carregarEnvFile() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const linha of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function gerarEnvSeAusente() {
  const p = path.join(ROOT, '.env');
  if (fs.existsSync(p)) return;
  const pepper = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(p,
    '# Gerado automaticamente na primeira execucao. SEGREDO - nao compartilhar, nao versionar.\n' +
    `LP_PEPPER=${pepper}\n`, 'utf8');
}

gerarEnvSeAusente();
const arquivo = carregarEnvFile();
const env = (chave, padrao) => process.env[chave] ?? arquivo[chave] ?? padrao;

export const config = {
  porta: Number(env('LP_PORTA', '3000')),
  host: env('LP_HOST', '0.0.0.0'),
  dbPath: path.resolve(ROOT, env('LP_DB_PATH', 'data/lanchonete.sqlite')),
  pepper: String(env('LP_PEPPER', '')),
  backupsDir: path.resolve(ROOT, env('LP_BACKUP_DIR', 'backups')),
  logsDir: path.resolve(ROOT, env('LP_LOG_DIR', 'logs')),
  sessaoHoras: Number(env('LP_SESSAO_HORAS', '12')),
  sessaoInatividadeMin: Number(env('LP_SESSAO_INATIVIDADE_MIN', '30')),
  backupIntervaloHoras: Number(env('LP_BACKUP_INTERVALO_HORAS', '6')),
  backupRetencao: Number(env('LP_BACKUP_RETENCAO', '30')),
  ambiente: env('LP_AMBIENTE', 'producao'),
  // 1.3.1: endereço público da instalação (AWS/EC2, ALB, Elastic Beanstalk ou
  // VPS). Usado no QR Code "online" do painel e no módulo de conexão mobile.
  urlPublica: String(env('LP_URL_PUBLICA', '')).replace(/\/+$/, ''),
};

// Pepper obrigatorio: se ausente/curto no .env existente, gera e acrescenta.
if (!config.pepper || config.pepper.length < 32) {
  const p = path.join(ROOT, '.env');
  config.pepper = crypto.randomBytes(32).toString('hex');
  fs.appendFileSync(p, `\nLP_PEPPER=${config.pepper}\n`, 'utf8');
}
