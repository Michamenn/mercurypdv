// Modo Kiosque — atalho do Windows que abre o PDV no navegador com
// --kiosk-printing: o cupom sai direto para a impressora padrão, sem o
// diálogo de impressão. Criado/removido pelo próprio servidor (que roda no
// PC do caixa na rede local) via PowerShell — imune a aspas e espaços nos
// caminhos, porque o script vai em EncodedCommand (UTF-16LE).
import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

const NOME_LNK = 'Mercury PDV - Modo Kiosque.lnk';

function candidatosNavegador() {
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const lad = process.env['LOCALAPPDATA'] ?? '';
  return [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Edge é Chromium e também aceita --kiosk-printing (reserva).
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
}

export async function localizarNavegador() {
  if (process.platform !== 'win32') return null;
  for (const c of candidatosNavegador()) {
    try { await access(c); return c; } catch { /* tenta o próximo */ }
  }
  return null;
}

function executarPs(script) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    exec(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${b64}`,
      { windowsHide: true, timeout: 20000 },
      (e, stdout, stderr) => {
        if (e) {
          e.message = `${e.message}${stderr ? ` | ${String(stderr).trim()}` : ''}`.trim();
          reject(e);
        } else resolve(String(stdout ?? '').trim());
      });
  });
}

async function pastaDesktop() {
  return executarPs("[Environment]::GetFolderPath('Desktop')");
}

const aspasPs = (s) => String(s).replace(/'/g, "''");

// Estado atual: existe atalho? qual navegador será usado?
export async function estadoAtalhoKiosque() {
  if (process.platform !== 'win32') {
    return { plataforma: process.platform, suportado: false, navegador: null, atalho: null, existe: false };
  }
  const navegador = await localizarNavegador();
  const desktop = await pastaDesktop();
  const atalho = desktop ? path.join(desktop, NOME_LNK) : null;
  let existe = false;
  if (atalho) {
    try { await access(atalho); existe = true; } catch { existe = false; }
  }
  return { plataforma: 'win32', suportado: Boolean(navegador), navegador, atalho, existe };
}

export async function criarAtalhoKiosque({ porta = 3000 } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('O Modo Kiosque cria um atalho do Windows — disponível quando o servidor roda no PC do caixa (rede local).');
  }
  const navegador = await localizarNavegador();
  if (!navegador) {
    throw new Error('Google Chrome (ou Microsoft Edge) não encontrado nos caminhos padrão. Instale o navegador e tente de novo.');
  }
  const desktop = await pastaDesktop();
  if (!desktop) throw new Error('Não foi possível localizar a pasta Área de Trabalho.');
  const destino = path.join(desktop, NOME_LNK);
  const portaNum = Number(porta) || 3000;
  const script = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$lnk = $ws.CreateShortcut('${aspasPs(destino)}')`,
    `$lnk.TargetPath = '${aspasPs(navegador)}'`,
    `$lnk.Arguments = '--kiosk-printing http://localhost:${portaNum}'`,
    `$lnk.WorkingDirectory = (Split-Path '${aspasPs(navegador)}')`,
    `$lnk.IconLocation = '${aspasPs(navegador)},0'`,
    "$lnk.Description = 'Mercury PDV - impressao silenciosa (cupom vai direto para a impressora padrao)'",
    '$lnk.Save()',
  ].join('; ');
  await executarPs(script);
  return { atalho: destino, navegador, url: `http://localhost:${portaNum}` };
}

export async function removerAtalhoKiosque() {
  if (process.platform !== 'win32') {
    throw new Error('Disponível apenas quando o servidor roda no Windows.');
  }
  const desktop = await pastaDesktop();
  const destino = desktop ? path.join(desktop, NOME_LNK) : null;
  if (!destino) throw new Error('Não foi possível localizar a pasta Área de Trabalho.');
  let existe = true;
  try { await access(destino); } catch { existe = false; }
  if (existe) {
    await executarPs(`Remove-Item -LiteralPath '${aspasPs(destino)}' -Force`);
  }
  return { atalho: destino, removido: existe };
}
