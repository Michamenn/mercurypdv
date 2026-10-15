import { erro } from './errors.js';

export function texto(valor, campo, { minimo = 0, maximo = 255, obrigatorio = true, padrao = '' } = {}) {
  if (valor === undefined || valor === null) {
    if (obrigatorio) throw erro.validacao(`Campo "${campo}" e obrigatorio.`);
    return padrao;
  }
  if (typeof valor !== 'string') throw erro.validacao(`Campo "${campo}" deve ser texto.`);
  const t = valor.trim();
  if (obrigatorio && t.length < minimo) throw erro.validacao(`Campo "${campo}" deve ter ao menos ${minimo} caracteres.`);
  if (t.length > maximo) throw erro.validacao(`Campo "${campo}" deve ter no maximo ${maximo} caracteres.`);
  return t;
}

export function umDe(valor, campo, opcoes) {
  if (!opcoes.includes(valor)) throw erro.validacao(`Campo "${campo}" deve ser um de: ${opcoes.join(', ')}.`);
  return valor;
}

export function objeto(valor, campo) {
  if (valor === undefined || valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw erro.validacao(`Campo "${campo}" deve ser um objeto.`);
  }
  return valor;
}

export function lista(valor, campo, { maximo = 200 } = {}) {
  if (!Array.isArray(valor)) throw erro.validacao(`Campo "${campo}" deve ser uma lista.`);
  if (valor.length > maximo) throw erro.validacao(`Campo "${campo}" excede ${maximo} itens.`);
  return valor;
}

export function dataISO(valor, campo) {
  const t = texto(valor, campo, { maximo: 32 });
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw erro.validacao(`Campo "${campo}" nao e uma data valida.`);
  return d;
}

// Sanitiza texto livre (observacoes, motivos): remove caracteres de controle.
export function textoLivre(valor, campo, { maximo = 500 } = {}) {
  const t = texto(valor, campo, { maximo });
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
