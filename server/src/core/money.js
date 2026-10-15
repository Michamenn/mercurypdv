// Dinheiro SEMPRE em centavos inteiros (BRL). Nenhum float monetario e armazenado ou aceito.
import { erro } from './errors.js';

// Aceita inteiro (centavos) ou string "12,34"/"12.34" -> 1234 centavos.
export function paraCentavos(valor) {
  if (typeof valor === 'number') {
    if (!Number.isInteger(valor) || valor < 0) return null;
    return valor;
  }
  if (typeof valor === 'string') {
    const t = valor.trim();
    if (/^\d{1,9}([.,]\d{1,2})?$/.test(t)) {
      const [reais, cents = ''] = t.replace(',', '.').split('.');
      return Number(reais) * 100 + Number(cents.padEnd(2, '0'));
    }
  }
  return null;
}

export function formatar(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function assertCentavos(valor, campo, { minimo = 0 } = {}) {
  const c = paraCentavos(valor);
  if (c === null || c < minimo) throw erro.validacao(`Valor monetario invalido em "${campo}". Use centavos inteiros ou "12,34".`);
  return c;
}

export function assertInt(valor, campo, { minimo = 0, maximo = 2147483647 } = {}) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) {
    throw erro.validacao(`Campo "${campo}" deve ser inteiro entre ${minimo} e ${maximo}.`);
  }
  return n;
}
