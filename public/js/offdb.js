// IndexedDB: cache de catálogo + fila APENAS para transições KDS (idempotentes).
// Vendas/pagamentos NUNCA são executados offline (PWA-002).
const NOME = 'lanchonete-pro';
const VERSAO = 1;
let dbp = null;

function abrir() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOME, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('catalogo')) db.createObjectStore('catalogo');
      if (!db.objectStoreNames.contains('fila_kds')) db.createObjectStore('fila_kds', { keyPath: 'chave' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(loja, modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(loja, modo);
    const s = t.objectStore(loja);
    const saida = fn(s);
    t.oncomplete = () => resolve(saida?.result ?? saida);
    t.onerror = () => reject(t.error);
  });
}

export async function guardarCatalogo(dados) {
  await tx('catalogo', 'readwrite', (s) => s.put({ dados, em: Date.now() }, 'atual'));
}
export async function lerCatalogo() {
  const r = await tx('catalogo', 'readonly', (s) => s.get('atual'));
  return r?.result?.dados ?? null;
}

// Fila KDS: chave = pedido:de:para — deduplica retransmissões
export async function enfileirarKds(item) {
  await tx('fila_kds', 'readwrite', (s) => s.put(item));
}
export async function listarFilaKds() {
  const r = await tx('fila_kds', 'readonly', (s) => s.getAll());
  return r?.result ?? [];
}
export async function removerFilaKds(chave) {
  await tx('fila_kds', 'readwrite', (s) => s.delete(chave));
}

export async function drenarFilaKds(processar) {
  const itens = await listarFilaKds();
  for (const it of itens) {
    try {
      await processar(it);
      await removerFilaKds(it.chave);
    } catch (e) {
      // transição já aplicada no servidor = sucesso idempotente
      if (e.status === 409) { await removerFilaKds(it.chave); continue; }
      // outro erro: mantém na fila para próxima drenagem
      if (!navigator.onLine) break;
    }
  }
}
