// Exportação CSV (1.3.1): compatível com Excel pt-BR.
// - Separador ";" (padrão do Excel em português)
// - BOM UTF-8 para acentuação correta ao abrir direto no Excel
// - Campos entre aspas quando contêm ;, quebra ou aspas (RFC 4180 adaptado)

const BOM = '\uFEFF';

function escaparCampo(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  if (/[;"\r\n]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

// gerarCSV(['Coluna A', 'Coluna B'], [[v1, v2], [v3, v4]]) -> "Coluna A;Coluna B\r\n..."
export function gerarCSV(cabecalho, linhas) {
  const partes = [];
  if (Array.isArray(cabecalho) && cabecalho.length) {
    partes.push(cabecalho.map(escaparCampo).join(';'));
  }
  for (const linha of (linhas ?? [])) {
    if (!Array.isArray(linha)) continue;
    partes.push(linha.map(escaparCampo).join(';'));
  }
  return BOM + partes.join('\r\n') + '\r\n';
}

// Centavos inteiros -> "R$ 1.234,56" (texto amigável ao Excel pt-BR).
export function centavosParaCsv(centavos) {
  const negativo = centavos < 0;
  const v = Math.abs(Number(centavos) || 0);
  const reais = Math.floor(v / 100).toLocaleString('pt-BR');
  const cents = String(v % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}${reais},${cents}`;
}

// Converte objeto de pares { chave: valorCentavos } em linhas [rotulo, valor].
export function paresMoedaCSV(obj) {
  return Object.entries(obj ?? {}).map(([chave, valor]) => [chave, centavosParaCsv(valor)]);
}
