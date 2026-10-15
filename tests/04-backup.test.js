// Testes de backup, integridade e restauração (BKP-*, TESTE 14)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { iniciarServidorTeste, cliente, semear } from './helpers.js';

test('BKP-001/002: backup online consistente com integrity_check + retenção', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 30000 });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 2 }] }, { idem: 'bkp-1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'dinheiro', valor_centavos: 5000 }, { idem: 'bkp-1p' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});

    // backup via endpoint (admin)
    const r = await s.adminCli.post('/backups', {});
    assert.equal(r.status, 201);
    assert.equal(r.corpo.integrity, 'ok');
    assert.ok(r.corpo.bytes > 0);
    assert.ok(fs.existsSync(path.join(sv.dir, 'backups', r.corpo.arquivo)));

    // permissão: caixa não faz backup
    const negado = await s.caixaCli.post('/backups', {});
    assert.equal(negado.status, 403);

    // listagem + histórico
    const lista = await s.adminCli.get('/backups');
    assert.equal(lista.corpo.backups.length, 1);
    assert.equal(lista.corpo.historico.length, 1);
    assert.equal(lista.corpo.historico[0].motivo, 'manual');

    // retenção: arquivo antigo é removido
    const configMod = await import('../server/src/config.js');
    const antigo = path.join(sv.dir, 'backups', 'lanchonete-antigo.sqlite');
    fs.writeFileSync(antigo, 'x');
    const tempoAntigo = new Date(Date.now() - (configMod.config.backupRetencao + 5) * 24 * 3600_000);
    fs.utimesSync(antigo, tempoAntigo, tempoAntigo);
    const r2 = await s.adminCli.post('/backups', {});
    assert.equal(r2.status, 201);
    assert.ok(!fs.existsSync(antigo), 'retenção removeu backup antigo');
  } finally { await sv.fechar(); }
});

test('BKP-003: restauração em banco SEPARADO preserva dados (sem tocar produção)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 0 });
    const v = await s.caixaCli.post('/pedidos/balcao', { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 1 }] }, { idem: 'res-1' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/pagamentos`, { forma: 'pix', valor_centavos: 2500 }, { idem: 'res-1p' });
    await s.caixaCli.post(`/pedidos/${v.corpo.id}/fechar`, {});

    const backup = await s.adminCli.post('/backups', {});
    assert.equal(backup.corpo.integrity, 'ok');

    // restaura em destino separado
    const { restaurarBackup } = await import('../server/src/tools/backup.js');
    const destino = path.join(os.tmpdir(), `lp-restauro-${Date.now()}.sqlite`);
    const resultado = restaurarBackup(sv.db, backup.corpo.arquivo, destino, { usuarioId: 1 });
    assert.equal(resultado.integrity, 'ok');

    // abre a cópia restaurada e confere os dados
    const { DatabaseSync } = await import('node:sqlite');
    const copia = new DatabaseSync(destino, { readOnly: true });
    const pedidos = copia.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE status = ?').get('fechado');
    assert.equal(pedidos.n, 1);
    const pagos = copia.prepare('SELECT SUM(valor_centavos) AS t FROM pagamentos WHERE estornado = 0').get().t;
    assert.equal(pagos, 2500);
    const usuarios = copia.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
    assert.equal(usuarios, 5);
    copia.close();
    fs.rmSync(destino, { force: true });

    // restauração sobre o banco EM USO é bloqueada (proteção de produção)
    assert.throws(() => restaurarBackup(sv.db, backup.corpo.arquivo, sv.dbPath, { usuarioId: 1 }));

    // backup corrompido é detectado
    const configMod = await import('../server/src/config.js');
    fs.writeFileSync(path.join(sv.dir, 'backups', 'lanchonete-corrompido.sqlite'), 'arquivo lixo');
    assert.throws(() => restaurarBackup(sv.db, 'lanchonete-corrompido.sqlite', path.join(os.tmpdir(), 'lp-x.sqlite')));
  } finally { await sv.fechar(); }
});
