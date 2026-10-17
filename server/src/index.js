import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { abrirBanco } from './db/connection.js';
import { migrar } from './db/migrations.js';
import { iniciarLogger, logger } from './core/logger.js';
import { HubWS } from './ws/hub.js';
import { criarRouter } from './routes/api.js';
import { validarSessao, extrairTokenDoCookie } from './auth/sessions.js';
import { criarBackup } from './tools/backup.js';
import * as crypto from './auth/crypto.js';

process.on('uncaughtException', (e) => logger.erro(`uncaughtException: ${e.stack ?? e.message}`));
process.on('unhandledRejection', (e) => logger.erro(`unhandledRejection: ${e?.stack ?? String(e)}`));

iniciarLogger();
logger.info(`=== Mercury PDV 1.3.1 iniciando (Node ${process.version}) ===`);

const db = abrirBanco(config.dbPath);
migrar(db);
logger.info(`Banco pronto: ${config.dbPath} (migrações aplicadas)`);

const hub = new HubWS(db, logger);
hub.setValidador((token) => validarSessao(db, token));

const app = express();
app.disable('x-powered-by');

// Cabeçalhos de segurança básicos (rede local; sem CDN externo).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Estático: SOMENTE public/ (data/, backups/ e logs/ nunca são servidos).
// PDV em LAN: sem cache HTTP de assets — atualizações aplicam no refresh.
const publicDir = path.join(ROOT, 'public');
app.use(express.static(publicDir, { index: 'index.html', etag: true, maxAge: 0, setHeaders: (res) => {
  res.setHeader('Cache-Control', 'no-cache');
} }));

app.use('/api', criarRouter({ db, hub, crypto, pepper: config.pepper, configApp: config, logger }));

app.use((err, _req, res, _next) => {
  logger.erro(`static: ${err.message}`);
  res.status(500).json({ erro: 'Erro interno.', codigo: '500_INTERNO' });
});

const server = http.createServer(app);
hub.anexar(server);

// Healthcheck simples (sem dados sensíveis).
app.get('/health', (_req, res) => res.json({ ok: true, versao: '1.3.1', tempo: new Date().toISOString() }));

server.listen(config.porta, config.host, () => {
  logger.info(`Servidor HTTP+WS em http://${config.host}:${config.porta} (ambiente: ${config.ambiente})`);
});

// Backup automático periódico (falha não derruba o servidor).
let timerBackup = null;
if (config.backupIntervaloHoras > 0) {
  timerBackup = setInterval(() => {
    try {
      const r = criarBackup(db, { motivo: 'automatico' });
      logger.info(`Backup automático OK: ${r.arquivo} (${r.bytes} bytes, integrity=${r.integrity})`);
    } catch (e) {
      logger.erro(`Backup automático FALHOU: ${e.message}`);
    }
  }, config.backupIntervaloHoras * 3600_000);
  timerBackup.unref?.();
}

// Encerramento controlado: para de aceitar conexões, fecha WS, checkpoint do WAL.
let encerrando = false;
function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  logger.info(`Encerrando (${sinal})...`);
  clearInterval(timerBackup);
  hub.fechar();
  server.close(() => {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.close(); } catch { /* noop */ }
    logger.info('Servidor encerrado com segurança.');
    process.exit(0);
  });
  // saída forçada se algo prender o close
  setTimeout(() => {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); db.close(); } catch { /* noop */ }
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGHUP', () => encerrar('SIGHUP'));

export { app, server, db, hub };
