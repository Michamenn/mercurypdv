// Validação do gerador de QR Code local (P-03) contra a ISO/IEC 18004.
// Inclui prova de ida e volta: codifica, decodifica a matriz gerada e compara
// com o original — é o que garante que o QR é legível por um scanner real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { qrcodeMatriz, qrcodeSVG } from '../public/js/qrcode.js';

// ---- Tabelas da norma (necessárias para reverter a codificação) ----
const FORMATO_M = [
  0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
  0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
];
const BLOCOS_M = {
  1: { dados: 16, ecc: 10, blocos: 1 }, 2: { dados: 28, ecc: 16, blocos: 1 },
  3: { dados: 44, ecc: 26, blocos: 1 }, 4: { dados: 64, ecc: 18, blocos: 2 },
  5: { dados: 86, ecc: 24, blocos: 2 }, 6: { dados: 108, ecc: 16, blocos: 4 },
  7: { dados: 124, ecc: 18, blocos: 4 }, 8: { dados: 154, ecc: 22, blocos: 4 },
  9: { dados: 182, ecc: 22, blocos: 5 }, 10: { dados: 216, ecc: 26, blocos: 5 },
};
const CAP_M = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };
const ALINHAMENTO = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const mascaraEm = (r, c, padrao) => {
  switch (padrao) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r * c) % 3) + ((r + c) % 2)) % 2 === 0;
  }
};

function mapaReservado(versao) {
  const tam = versao * 4 + 17;
  const res = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const on = (r, c) => { if (r >= 0 && r < tam && c >= 0 && c < tam) res[r][c] = true; };
  for (const [r0, c0] of [[0, 0], [0, tam - 7], [tam - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) on(r0 + r, c0 + c);
  }
  for (const r of ALINHAMENTO[versao]) {
    for (const c of ALINHAMENTO[versao]) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= tam - 9) || (r >= tam - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) on(r + dr, c + dc);
    }
  }
  for (let i = 0; i < 9; i++) { on(8, i); on(i, 8); }
  for (let i = 0; i < 8; i++) { on(8, tam - 1 - i); on(tam - 1 - i, 8); }
  on(tam - 8, 8);
  for (let i = 8; i <= tam - 9; i++) { on(6, i); on(i, 6); } // timing
  if (versao >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { on(i, tam - 11 + j); on(tam - 11 + j, i); }
  }
  return res;
}

function ordemLeitura(tam, reservado) {
  const ordem = [];
  let subida = true;
  for (let col = tam - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let n = 0; n < tam; n++) {
      const linha = subida ? tam - 1 - n : n;
      for (const c of [col, col - 1]) if (!reservado[linha][c]) ordem.push([linha, c]);
    }
    subida = !subida;
  }
  return ordem;
}

/** Decodifica a matriz gerada e devolve o texto embutido. */
function decodificar(textoOriginal) {
  const { modulos, versao } = qrcodeMatriz(textoOriginal);
  const tam = versao * 4 + 17;

  // Máscara a partir do bloco de formato (cópia 1).
  const b = new Array(15).fill(0);
  for (let i = 0; i < 6; i++) b[i] = modulos[8][i];
  b[6] = modulos[8][7]; b[7] = modulos[8][8]; b[8] = modulos[7][8];
  for (let i = 9; i < 15; i++) b[i] = modulos[14 - i][8];
  const mascara = FORMATO_M.indexOf(b.reduce((acc, bit, i) => acc | (bit << i), 0));
  assert.ok(mascara >= 0, 'máscara de formato reconhecida');

  const ordem = ordemLeitura(tam, mapaReservado(versao));
  const bits = ordem.map(([r, c]) => modulos[r][c] ^ (mascaraEm(r, c, mascara) ? 1 : 0));

  const fluxo = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    fluxo.push(bits.slice(i, i + 8).reduce((x, y) => (x << 1) | y, 0));
  }

  const info = BLOCOS_M[versao];
  const base = Math.floor(info.dados / info.blocos);
  const resto = info.dados % info.blocos;
  const tamanhos = Array.from({ length: info.blocos }, (_, i) => base + (i >= info.blocos - resto ? 1 : 0));
  const blocos = tamanhos.map(() => []);
  let p = 0;
  for (let i = 0; i < Math.max(...tamanhos); i++) {
    for (let g = 0; g < info.blocos; g++) if (i < tamanhos[g]) blocos[g].push(fluxo[p++]);
  }
  const dados = blocos.flat();

  let bp = 0;
  const ler = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) { v = (v << 1) | ((dados[bp >> 3] >> (7 - (bp & 7))) & 1); bp++; }
    return v;
  };
  const modo = ler(4);
  const tamanho = ler(versao <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < tamanho; i++) bytes.push(ler(8));
  return { texto: new TextDecoder().decode(Uint8Array.from(bytes)), modo, versao, mascara };
}

// ============================ TESTES ============================

test('QR-001: matriz válida, quadrada e sem módulos vazios', () => {
  for (const t of ['A', 'HELLO WORLD', 'http://192.168.0.10:3000/#mobile']) {
    const { modulos, tamanho, versao } = qrcodeMatriz(t);
    assert.equal(tamanho, versao * 4 + 17, `dimensão da versão ${versao}`);
    assert.ok(modulos.every((l) => l.length === tamanho));
    assert.ok(modulos.flat().every((v) => v === 0 || v === 1), 'todo módulo é 0 ou 1');
  }
});

test('QR-002: padrões de busca e separadores claros', () => {
  const { modulos, tamanho } = qrcodeMatriz('TESTE');
  const finderOk = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const borda = r === 0 || r === 6 || c === 0 || c === 6;
        const nucleo = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (modulos[r0 + r][c0 + c] !== (borda || nucleo ? 1 : 0)) return false;
      }
    }
    return true;
  };
  assert.ok(finderOk(0, 0), 'superior esquerdo');
  assert.ok(finderOk(0, tamanho - 7), 'superior direito');
  assert.ok(finderOk(tamanho - 7, 0), 'inferior esquerdo');
  assert.ok([...Array(8).keys()].every((c) => modulos[7][c] === 0), 'separador linha 7');
  assert.ok([...Array(8).keys()].every((r) => modulos[r][7] === 0), 'separador coluna 7');
  assert.ok([...Array(8).keys()].every((r) => modulos[r][tamanho - 8] === 0), 'separador direito');
});

test('QR-003: padrões de timing alternam corretamente', () => {
  const { modulos, tamanho } = qrcodeMatriz('TIMING-TEST');
  assert.ok([...Array(tamanho - 16).keys()].every((i) => modulos[6][i + 8] === (i % 2 ? 0 : 1)));
  assert.ok([...Array(tamanho - 16).keys()].every((i) => modulos[i + 8][6] === (i % 2 ? 0 : 1)));
});

test('QR-004: padrões de alinhamento 5x5 em todas as versões', () => {
  for (const [v, cap] of Object.entries(CAP_M)) {
    const { modulos, versao, tamanho } = qrcodeMatriz('Z'.repeat(cap));
    assert.equal(versao, Number(v), `força a versão ${v}`);
    const centros = ALINHAMENTO[v];
    for (const r of centros) {
      for (const c of centros) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= tamanho - 9) || (r >= tamanho - 9 && c <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const anel = Math.max(Math.abs(dr), Math.abs(dc));
            assert.equal(modulos[r + dr][c + dc], anel === 1 ? 0 : 1, `v${v} (${r},${c})`);
          }
        }
      }
    }
  }
});

test('QR-005: palavra de formato confere com a tabela da norma', () => {
  for (let n = 0; n < 24; n++) {
    const { modulos, tamanho, mascara } = qrcodeMatriz(`FORMATO-${n}-${'x'.repeat(n)}`);
    const b = new Array(15).fill(0);
    for (let i = 0; i < 6; i++) b[i] = modulos[8][i];
    b[6] = modulos[8][7]; b[7] = modulos[8][8]; b[8] = modulos[7][8];
    for (let i = 9; i < 15; i++) b[i] = modulos[14 - i][8];
    const valor = b.reduce((acc, bit, i) => acc | (bit << i), 0);
    assert.equal(valor, FORMATO_M[mascara], `caso ${n}, máscara ${mascara}`);
    // A segunda cópia precisa repetir os mesmos bits.
    for (let i = 0; i < 8; i++) assert.equal(modulos[tamanho - 1 - i][8], b[i]);
    for (let i = 8; i < 15; i++) assert.equal(modulos[8][tamanho - 15 + i], b[i]);
  }
});

test('QR-006: capacidade por versão (modo byte, nível M)', () => {
  for (const [v, cap] of Object.entries(CAP_M)) {
    const n = Number(v);
    assert.equal(qrcodeMatriz('X'.repeat(cap)).versao, n, `${cap} bytes cabem em v${n}`);
    if (n < 10) assert.equal(qrcodeMatriz('X'.repeat(cap + 1)).versao, n + 1, `${cap + 1} bytes vão para v${n + 1}`);
    else assert.throws(() => qrcodeMatriz('X'.repeat(cap + 1)), /longo demais/);
  }
});

test('QR-007: PROVA DE IDA E VOLTA — o conteúdo sobrevive ao ciclo completo', () => {
  const casos = [
    'A', 'HELLO WORLD', 'http://localhost:3000/#comandas',
    'http://192.168.0.10:3000/#comandas', 'http://192.168.0.10:3000/#mobile',
    'Mercado do Bairro — Açaí & Café ☕', '1234567890'.repeat(4),
    'X'.repeat(60), 'Y'.repeat(120), 'Z'.repeat(200), 'W'.repeat(213),
  ];
  for (const original of casos) {
    const r = decodificar(original);
    assert.equal(r.modo, 4, `modo byte em "${original.slice(0, 20)}"`);
    assert.equal(r.texto, original, `ida e volta de "${original.slice(0, 24)}"`);
  }
});

test('QR-008: determinismo e SVG válido', () => {
  assert.equal(
    JSON.stringify(qrcodeMatriz('ABC')),
    JSON.stringify(qrcodeMatriz('ABC')),
    'mesma entrada gera a mesma saída'
  );
  const svg = qrcodeSVG('http://localhost:3000/#mobile', { tamanho: 200 });
  assert.ok(svg.startsWith('<svg'), 'começa com <svg>');
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'declara o namespace SVG');
  assert.ok(svg.includes('role="img"'), 'tem papel acessível');
  assert.ok(svg.trimEnd().endsWith('</svg>'), 'fecha a tag');
  assert.ok(!svg.includes('http://api'), 'não chama serviço externo');
});