// Gera os ícones PNG do PWA (192/512 + maskable) 100% em Node nativo.
// PNG = assinatura + IHDR + IDAT (zlib.deflateSync) + IEND, com CRC32 manual.
// Zero dependências, zero build, alinhado ao offline-first do projeto.
//
// Uso: node scripts/gerar-icones.js
// Saída: public/icons/icon-{192,512}.png e icon-maskable-{192,512}.png
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'public', 'icons');

// ---------- PNG (formato mínimo: RGBA 8-bit, filtro None) ----------
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([len, corpo, crc]);
}
function montarPng(largura, altura, rgba) {
  const stride = largura * 4;
  const bruto = Buffer.alloc((stride + 1) * altura);
  for (let y = 0; y < altura; y++) {
    bruto[y * (stride + 1)] = 0; // filtro None por linha
    rgba.copy(bruto, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;   // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(bruto, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Desenho: marca do Mercury (hambúrguer branco sobre #F97316) ----------
const LARANJA = [249, 115, 22]; // #F97316
const BRANCO = [255, 255, 255];

// Coordenadas normalizadas [0..1] do glifo (o glifo ocupa o quadrado todo).
function dentroDoGlyph(nx, ny) {
  // Pão superior: meia elipse (domo)
  const dx = (nx - 0.5) / 0.27;
  const dy = (ny - 0.40) / 0.145;
  if (dx * dx + dy * dy <= 1 && ny <= 0.40) return true;
  // Carne: barra central
  if (nx >= 0.20 && nx <= 0.80 && ny >= 0.50 && ny <= 0.565) return true;
  // Pão inferior: barra arredondada
  if (nx >= 0.21 && nx <= 0.79 && ny >= 0.635 && ny <= 0.72) return true;
  return false;
}

// Retângulo arredondado (ícone "any" com cantos transparentes).
function dentroDoArredondado(x, y, s, raio) {
  if (x < raio && y < raio) return (x - raio) ** 2 + (y - raio) ** 2 <= raio * raio;
  if (x >= s - raio && y < raio) return (x - (s - raio)) ** 2 + (y - raio) ** 2 <= raio * raio;
  if (x < raio && y >= s - raio) return (x - raio) ** 2 + (y - (s - raio)) ** 2 <= raio * raio;
  if (x >= s - raio && y >= s - raio) return (x - (s - raio)) ** 2 + (y - (s - raio)) ** 2 <= raio * raio;
  return true;
}

// maskable: fundo laranja em sangria total (o SO recorta o círculo);
//           glifo confinado à zona segura central.
// any:       cantos arredondados transparentes, glifo em 80% da área.
function gerarIcone(s, { maskable }) {
  const rgba = Buffer.alloc(s * s * 4);
  const raio = Math.round(s * 0.18);
  const escala = maskable ? 0.62 : 0.80;
  const AMOSTRAS = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]; // 2×2 = anti-aliasing
  for (let py = 0; py < s; py++) {
    for (let px = 0; px < s; px++) {
      let fundo = 0, glyph = 0;
      for (const [ox, oy] of AMOSTRAS) {
        const x = px + ox, y = py + oy;
        const dentroFundo = maskable ? true : dentroDoArredondado(x, y, s, raio);
        if (!dentroFundo) continue;
        fundo++;
        const nx = 0.5 + (x / s - 0.5) / escala;
        const ny = 0.5 + (y / s - 0.5) / escala;
        if (dentroDoGlyph(nx, ny)) glyph++;
      }
      const covFundo = fundo / 4;
      const covGlyph = glyph / 4;
      // Laranja com alpha pela cobertura do fundo (maskable = opaco).
      let r = LARANJA[0], g = LARANJA[1], b = LARANJA[2];
      let a = maskable ? 255 : Math.round(255 * covFundo);
      // Glifo branco misturado pela cobertura.
      if (covGlyph > 0) {
        r = Math.round(LARANJA[0] + (BRANCO[0] - LARANJA[0]) * covGlyph);
        g = Math.round(LARANJA[1] + (BRANCO[1] - LARANJA[1]) * covGlyph);
        b = Math.round(LARANJA[2] + (BRANCO[2] - LARANJA[2]) * covGlyph);
        if (!maskable) a = Math.round(255 * Math.max(covFundo, covGlyph));
      }
      const i = (py * s + px) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return montarPng(s, s, rgba);
}

// ---------- Execução ----------
mkdirSync(DESTINO, { recursive: true });
const ARQUIVOS = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
];
for (const [nome, s, maskable] of ARQUIVOS) {
  const buf = gerarIcone(s, { maskable });
  const caminho = path.join(DESTINO, nome);
  writeFileSync(caminho, buf);
  // Prova mínima de sanidade: assinatura + dimensões no IHDR.
  const okAssinatura = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const okDimensoes = buf.readUInt32BE(16) === s && buf.readUInt32BE(20) === s;
  console.log(`${okAssinatura && okDimensoes ? 'OK ' : 'ERRO'} ${nome} (${s}x${s}${maskable ? ' maskable' : ''}) ${buf.length} bytes`);
  if (!okAssinatura || !okDimensoes) process.exitCode = 1;
}
console.log(`Ícones gerados em ${DESTINO}`);
