// ============================================================
// Gerador de QR Code local (ISO/IEC 18004) — modo byte, versões 1..10,
// nível de correção M. Sem dependência externa e sem CDN, preservando a
// regra offline-first do sistema (ver testes 06-frontend-modulos e 18).
//
// Uso: qrcodeSVG(texto, { tamanho, margem, escurecer }) -> string SVG
// ============================================================

// Capacidade de dados (bytes) por versão, nível M.
const CAPACIDADE_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
// Nível M por versão: total de codewords, codewords de DADOS, codewords de
// ECC POR BLOCO e número de blocos. Tabela da ISO/IEC 18004.
// Invariante obrigatória: dados + blocos × ecc === total.
const BLOCOS_M = [
  null,
  { total: 26, dados: 16, ecc: 10, blocos: 1 },
  { total: 44, dados: 28, ecc: 16, blocos: 1 },
  { total: 70, dados: 44, ecc: 26, blocos: 1 },
  { total: 100, dados: 64, ecc: 18, blocos: 2 },
  { total: 134, dados: 86, ecc: 24, blocos: 2 },
  { total: 172, dados: 108, ecc: 16, blocos: 4 },
  { total: 196, dados: 124, ecc: 18, blocos: 4 },
  { total: 242, dados: 154, ecc: 22, blocos: 4 },
  { total: 292, dados: 182, ecc: 22, blocos: 5 },
  { total: 346, dados: 216, ecc: 26, blocos: 5 },
];

// Falha cedo e visível se a tabela estiver inconsistente: um QR silenciosamente
// errado é pior do que nenhum QR.
for (let v = 1; v <= 10; v++) {
  const b = BLOCOS_M[v];
  if (b.dados + b.blocos * b.ecc !== b.total) {
    throw new Error(`Tabela QR inválida na versão ${v}: ${b.dados} + ${b.blocos}×${b.ecc} ≠ ${b.total}`);
  }
}

// Padrão de alinhamento por versão (posições do centro dos padrões).
const ALINHAMENTO = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// Máscara de formato (nível M) pré-calculada pela especificação.
const FORMATO_M = [
  0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
  0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
  0b111011111000100, 0b111001011110011, 0b111110110101010, 0b111100010000101,
  0b110011000100111, 0b110001100011000, 0b110110001000001, 0b110100101110110,
];

// ---------- GF(256) para Reed-Solomon ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // polinômio gerador do QR
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function gerarECC(dados, tamanhoEcc) {
  const gerador = new Uint8Array(tamanhoEcc);
  gerador[tamanhoEcc - 1] = 1;
  for (let i = 0; i < tamanhoEcc - 1; i++) {
    for (let j = 0; j < tamanhoEcc; j++) {
      gerador[j] = gfMul(gerador[j], 2) ^ (j + 1 < tamanhoEcc ? gerador[j + 1] : 0);
    }
  }
  const resto = new Uint8Array(tamanhoEcc);
  for (const byte of dados) {
    const fator = byte ^ resto[0];
    resto.copyWithin(0, 1);
    resto[tamanhoEcc - 1] = 0;
    for (let i = 0; i < tamanhoEcc; i++) resto[i] ^= gfMul(gerador[i], fator);
  }
  return resto;
}

// ---------- Montagem dos codewords ----------
function montarCodewords(bytes, versao) {
  const info = BLOCOS_M[versao];
  const capacidade = CAPACIDADE_M[versao];
  if (bytes.length > capacidade) return null;

  const bits = [];
  const push = (valor, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };

  push(0b0100, 4);                 // modo byte
  push(bytes.length, versao <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  // Terminador (até 4 bits) + preenchimento até múltiplo de 8.
  const capacidadeBits = info.dados * 8;
  for (let i = 0; i < 4 && bits.length < capacidadeBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Bytes de preenchimento alternados 0xEC / 0x11.
  const preenchimento = [0xec, 0x11];
  let p = 0;
  while (codewords.length < info.dados) codewords.push(preenchimento[p++ % 2]);

  return codewords.slice(0, info.dados);
}

// Divide os codewords de dados em blocos o mais iguais possível.
// Convenção da norma: os blocos MENORES vêm primeiro.
// Ex.: versão 10-M -> 216 dados em 5 blocos => 43,43,43,43,44.
function dividirBlocos(dados, nBlocos) {
  const base = Math.floor(dados.length / nBlocos);
  const resto = dados.length % nBlocos;
  const blocos = [];
  let p = 0;
  for (let i = 0; i < nBlocos; i++) {
    const tamanho = base + (i >= nBlocos - resto ? 1 : 0);
    blocos.push(dados.slice(p, p + tamanho));
    p += tamanho;
  }
  return blocos;
}

function intercalarComECC(dados, versao) {
  const info = BLOCOS_M[versao];
  const nBlocos = info.blocos;
  const eccPorBloco = info.ecc;

  const blocosDados = dividirBlocos(dados, nBlocos);
  const blocosECC = blocosDados.map((b) => gerarECC(b, eccPorBloco));

  // Intercala os blocos de dados (pula os que já acabaram) e depois os de ECC.
  const saida = [];
  const maxDados = Math.max(...blocosDados.map((b) => b.length));
  for (let i = 0; i < maxDados; i++) {
    for (const b of blocosDados) if (i < b.length) saida.push(b[i]);
  }
  for (let i = 0; i < eccPorBloco; i++) {
    for (const b of blocosECC) saida.push(b[i]);
  }
  return saida;
}

// ---------- Construção da matriz ----------
function tamanhoMatriz(versao) {
  return versao * 4 + 17;
}

function criarMatriz(tam) {
  return {
    modulos: Array.from({ length: tam }, () => new Array(tam).fill(null)),
    reservado: Array.from({ length: tam }, () => new Array(tam).fill(false)),
  };
}

function reservarFuncao(m, versao) {
  const tam = m.modulos.length;
  const marcar = (r, c, v) => {
    if (r < 0 || r >= tam || c < 0 || c >= tam) return; // fora da matriz: ignora
    m.modulos[r][c] = v;
    m.reservado[r][c] = true;
  };

  // Padrões de busca (7x7) + separadores nos três cantos.
  // Atenção: o separador fica SEMPRE entre o padrão e o centro do símbolo,
  // então sua posição depende do canto — não é simplesmente "+7".
  const cantos = [
    { r0: 0, c0: 0, sepLinha: 7, sepCol: 7 },
    { r0: 0, c0: tam - 7, sepLinha: 7, sepCol: tam - 8 },
    { r0: tam - 7, c0: 0, sepLinha: tam - 8, sepCol: 7 },
  ];
  for (const { r0, c0, sepLinha, sepCol } of cantos) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const borda = r === 0 || r === 6 || c === 0 || c === 6;
        const nucleo = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        marcar(r0 + r, c0 + c, borda || nucleo ? 1 : 0);
      }
    }
    for (let i = 0; i < 8; i++) {
      marcar(sepLinha, c0 + i - (sepCol === 7 ? 0 : 1), 0);
      marcar(r0 + i - (sepLinha === 7 ? 0 : 1), sepCol, 0);
    }
  }

  // Padrões de timing: linha 6 e coluna 8 (exceto onde há função).
  for (let i = 8; i <= tam - 9; i++) {
    marcar(6, i, i % 2 === 0 ? 1 : 0);
    marcar(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Padrões de alinhamento (5x5), pulando os que colidem com os de busca.
  const centros = ALINHAMENTO[versao];
  for (const r of centros) {
    for (const c of centros) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= tam - 9) || (r >= tam - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const anel = Math.max(Math.abs(dr), Math.abs(dc));
          marcar(r + dr, c + dc, anel === 1 ? 0 : 1);
        }
      }
    }
  }

  // Reserva das áreas de formato (linha/coluna 8) e do módulo escuro.
  for (let i = 0; i < 9; i++) {
    if (m.modulos[8][i] === null) marcar(8, i, 0);
    if (m.modulos[i][8] === null) marcar(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (m.modulos[8][tam - 1 - i] === null) marcar(8, tam - 1 - i, 0);
    if (m.modulos[tam - 1 - i][8] === null) marcar(tam - 1 - i, 8, 0);
  }
  marcar(tam - 8, 8, 1); // módulo "escuro" obrigatório

  // Bloco de versão (versões >= 7).
  if (versao >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        marcar(i, tam - 11 + j, 0);
        marcar(tam - 11 + j, i, 0);
      }
    }
  }
}

function aplicarMascara(m, padrao) {
  const tam = m.modulos.length;
  const fn = (r, c) => {
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
  for (let r = 0; r < tam; r++) {
    for (let c = 0; c < tam; c++) {
      if (!m.reservado[r][c] && fn(r, c)) m.modulos[r][c] ^= 1;
    }
  }
}

function aplicarFormato(m, mascara) {
  const tam = m.modulos.length;
  const bits = FORMATO_M[mascara];
  // Cópia 1 (contorno do padrão superior esquerdo):
  //   bit 0..5 -> linha 8, colunas 0..5
  //   bit 6    -> (8,7)      bit 7 -> (8,8)      bit 8 -> (7,8)
  //   bit 9..14-> coluna 8, linhas 5..0
  // Cópia 2 (dividida entre os cantos inferior-esquerdo e superior-direito):
  //   bit 0..7 -> coluna 8, linhas size-1 .. size-8
  //   bit 8..14-> linha 8, colunas size-7 .. size-1
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;
    if (i < 6) m.modulos[8][i] = bit;
    else if (i === 6) m.modulos[8][7] = bit;
    else if (i === 7) m.modulos[8][8] = bit;
    else if (i === 8) m.modulos[7][8] = bit;
    else m.modulos[14 - i][8] = bit;

    if (i < 8) m.modulos[tam - 1 - i][8] = bit;
    else m.modulos[8][tam - 15 + i] = bit;
  }
}

function aplicarVersao(m, versao) {
  if (versao < 7) return;
  let dados = versao;
  for (let i = 0; i < 12; i++) {
    dados = (dados << 1) ^ ((dados >>> 11) * 0x1f25);
  }
  const bits = (versao << 12) | dados;
  const tam = m.modulos.length;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const a = Math.floor(i / 3), b = (i % 3) + tam - 11;
    m.modulos[b][a] = bit;
    m.modulos[a][b] = bit;
  }
}

// Sequência de leitura em zigue-zague, ignorando módulos reservados.
function sequênciaLeitura(tam, reservado) {
  const ordem = [];
  let subida = true;
  for (let col = tam - 1; col > 0; col -= 2) {
    if (col === 6) col--; // pula a coluna vertical de formato
    for (let n = 0; n < tam; n++) {
      const linha = subida ? tam - 1 - n : n;
      for (const c of [col, col - 1]) {
        if (!reservado[linha][c]) ordem.push([linha, c]);
      }
    }
    subida = !subida;
  }
  return ordem;
}

// Escolhe a máscara com melhor penalidade (regra da especificação).
function melhorMascara(m, ordem) {
  const bits = [];
  let melhor = 0, menorPenalidade = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    const teste = {
      modulos: m.modulos.map((l) => l.slice()),
      reservado: m.reservado.map((l) => l.slice()),
    };
    aplicarMascara(teste, mascara);
    let k = 0;
    for (const [r, c] of ordem) k = (k << 1) | teste.modulos[r][c];
    const penalidade = penalidadeMascara(teste.modulos, k);
    if (penalidade < menorPenalidade) { menorPenalidade = penalidade; melhor = mascara; }
    void bits;
  }
  return melhor;
}

function penalidadeMascara(modulos, bits) {
  const tam = modulos.length;
  let p = 0;
  // Regra 1: blocos de 5+ módulos iguais em linha/coluna.
  for (let r = 0; r < tam; r++) {
    let run = 1;
    for (let c = 1; c < tam; c++) {
      if (modulos[r][c] === modulos[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
      else run = 1;
    }
  }
  for (let c = 0; c < tam; c++) {
    let run = 1;
    for (let r = 1; r < tam; r++) {
      if (modulos[r][c] === modulos[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
      else run = 1;
    }
  }
  // Regra 2: blocos 2x2 iguais.
  for (let r = 0; r < tam - 1; r++) {
    for (let c = 0; c < tam - 1; c++) {
      const v = modulos[r][c];
      if (v === modulos[r][c + 1] && v === modulos[r + 1][c] && v === modulos[r + 1][c + 1]) p += 3;
    }
  }
  // Regra 3: padrão 1:1:3:1:1 com 4 módulos claros.
  const padrao = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reverso = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < tam; r++) {
    for (let c = 0; c <= tam - 11; c++) {
      let okA = true, okB = true;
      for (let i = 0; i < 11; i++) {
        if (modulos[r][c + i] !== padrao[i]) okA = false;
        if (modulos[r][c + i] !== reverso[i]) okB = false;
      }
      if (okA) p += 40;
      if (okB) p += 40;
    }
  }
  // Regra 4: desvio de proporção de módulos escuros.
  let escuros = 0;
  for (let i = 0; i < bits.toString(2).length; i++) if ((bits >> i) & 1) escuros++;
  const total = tam * tam;
  const proporcao = (escuros * 100) / total;
  p += Math.floor(Math.abs(proporcao - 50) / 5) * 10;
  return p;
}

/**
 * Gera a matriz de módulos (array de 0/1) para um texto.
 * @returns {{modulos:number[][], tamanho:number, versao:number}}
 */
export function qrcodeMatriz(texto) {
  const bytes = new TextEncoder().encode(String(texto));
  let versao = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= CAPACIDADE_M[v]) { versao = v; break; }
  }
  if (!versao) throw new Error(`Conteúdo longo demais para o QR local (máx. ${CAPACIDADE_M[10]} bytes).`);

  const dados = montarCodewords(bytes, versao);
  const fluxo = intercalarComECC(dados, versao);

  const tam = tamanhoMatriz(versao);
  const m = criarMatriz(tam);
  reservarFuncao(m, versao);

  const ordem = sequênciaLeitura(tam, m.reservado);
  ordem.forEach(([r, c], i) => {
    const byte = fluxo[Math.floor(i / 8)] ?? 0;
    m.modulos[r][c] = (byte >> (7 - (i % 8))) & 1;
  });

  const mascara = melhorMascara(m, ordem);
  aplicarMascara(m, mascara);
  aplicarFormato(m, mascara);
  aplicarVersao(m, versao);

  return { modulos: m.modulos, tamanho: tam, versao, mascara };
}

/**
 * Gera o QR Code como SVG (string), pronto para innerHTML.
 * @param {string} texto
 * @param {{tamanho?:number, margem?:number, escurecer?:string, clarear?:string}} opcoes
 */
export function qrcodeSVG(texto, opcoes = {}) {
  const { tamanho = 220, margem = 4, escurecer = '#000', clarear = '#fff' } = opcoes;
  const { modulos, tamanho: dim } = qrcodeMatriz(texto);
  const total = dim + margem * 2;
  const partes = [];
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      if (modulos[r][c]) partes.push(`M${c + margem} ${r + margem}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR Code de acesso">`
    + `<rect width="${total}" height="${total}" fill="${clarear}"/>`
    + `<path d="${partes.join('')}" fill="${escurecer}"/>`
    + `</svg>`;
}

export default qrcodeSVG;