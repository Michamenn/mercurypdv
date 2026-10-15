import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ARQUIVOS = 5;

let arquivoAtual = null;
let contador = 0;

function rotacionar() {
  try {
    const atual = arquivoAtual;
    if (!atual || !fs.existsSync(atual)) return;
    if (fs.statSync(atual).size < MAX_BYTES) return;
    for (let i = MAX_ARQUIVOS - 1; i >= 1; i--) {
      const de = `${atual}.${i}`;
      const para = `${atual}.${i + 1}`;
      if (fs.existsSync(de)) fs.renameSync(de, para);
    }
    fs.renameSync(atual, `${atual}.1`);
  } catch { /* rotacao nunca derruba o servidor */ }
}

export function iniciarLogger() {
  fs.mkdirSync(config.logsDir, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  arquivoAtual = path.join(config.logsDir, `app-${hoje}.log`);
}

export function log(nivel, mensagem) {
  const linha = `${new Date().toISOString()} [${nivel}] ${mensagem}\n`;
  if (nivel === 'erro') process.stderr.write(linha);
  else process.stdout.write(linha);
  try {
    if (!arquivoAtual) iniciarLogger();
    fs.appendFileSync(arquivoAtual, linha);
    if (++contador % 200 === 0) rotacionar();
  } catch { /* disco cheio nao derruba o PDV */ }
}

export const logger = {
  info: (m) => log('info', m),
  erro: (m) => log('erro', m),
  seguranca: (m) => log('seguranca', m),
};
