// Cliente HTTP v3: cookie de sessÃ£o (mesma origem) + header anti-CSRF + idempotÃªncia
let cbErroSessao = null;
export function aoPerderSessao(fn) { cbErroSessao = fn; }

export async function api(metodo, caminho, corpo, { idem, semCsrf } = {}) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (!semCsrf) headers['X-Requested-With'] = 'XMLHttpRequest';
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch('/api' + caminho, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    credentials: 'same-origin',
  });
  let dados = null;
  try { dados = await res.json(); } catch { /* sem corpo */ }
  if (res.status === 401 && cbErroSessao) cbErroSessao();
  if (!res.ok) {
    const e = new Error(dados?.erro ?? `Erro HTTP ${res.status}`);
    e.status = res.status;
    e.codigo = dados?.codigo;
    e.dados = dados;
    throw e;
  }
  return dados;
}

export const get = (c) => api('GET', c);
export const post = (c, b, o) => api('POST', c, b, o);
export const put = (c, b, o) => api('PUT', c, b, o);
export const del = (c, o) => api('DELETE', c, undefined, o);

// Dinheiro: centavos inteiros <-> exibiÃ§Ã£o pt-BR (nunca float para cÃ¡lculo server-side)
export const fmt = (centavos) => 'R$ ' + ((centavos ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const reaisParaCentavos = (texto) => {
  const t = String(texto ?? '').trim().replace(/\s/g, '');
  if (t === '') return 0;
  if (/[^0-9.,]/.test(t)) return null;
  // "1.234,56" (pt-BR: pontos = milhar, vírgula = decimal)
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) return Math.round(Number(t.replace(/\./g, '').replace(',', '.')) * 100);
  // "1,234.56" (en: vírgulas = milhar, ponto = decimal)
  if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(t)) return Math.round(Number(t.replace(/,/g, '')) * 100);
  // "1.500" / "1.234.567" (só pontos em grupos de 3): milhar
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Math.round(Number(t.replace(/\./g, '')) * 100);
  // "1,500" / "1,234,567" (só vírgulas em grupos de 3): milhar
  if (/^\d{1,3}(,\d{3})+$/.test(t)) return Math.round(Number(t.replace(/,/g, '')) * 100);
  // "12,34" / "12.34" / "12,5": decimal simples (1–2 casas) — numpad do Windows envia ponto
  if (/^\d{1,9}[.,]\d{1,2}$/.test(t)) return Math.round(Number(t.replace(',', '.')) * 100);
  // "1500": inteiro em reais
  if (/^\d{1,9}$/.test(t)) return Number(t) * 100;
  // "12," / "12.": separador solto no fim = valor inteiro
  if (/^\d{1,9}[.,]$/.test(t)) return Number(t.slice(0, -1)) * 100;
  return null;
};

// IdempotÃªncia estÃ¡vel por aÃ§Ã£o (venda/pagamento): BR-007
export function novaIdempotencia(prefixo) {
  return `${prefixo}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

