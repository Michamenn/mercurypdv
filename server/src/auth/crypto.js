import crypto from 'node:crypto';

// scrypt (memory-hard) com salt aleatório por credencial + pepper de .env.
const MAXMEM = 256 * 1024 * 1024;

export function hashSegredo(segredo, pepper) {
  const salt = crypto.randomBytes(16);
  const derivado = crypto.scryptSync(`${segredo}|${pepper}`, salt, 64, { N: 32768, r: 8, p: 1, maxmem: MAXMEM });
  return `scrypt$32768$8$1$${salt.toString('base64')}$${derivado.toString('base64')}`;
}

export function verificarSegredo(segredo, armazenado, pepper) {
  try {
    if (typeof armazenado !== 'string') return false;
    const [alg, n, r, p, saltB64, hashB64] = armazenado.split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const esperado = Buffer.from(hashB64, 'base64');
    const derivado = crypto.scryptSync(`${segredo}|${pepper}`, salt, esperado.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
    return crypto.timingSafeEqual(derivado, esperado);
  } catch {
    return false;
  }
}

export function novoToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

export function novoId() {
  return crypto.randomUUID();
}

export function senhaForte(senha) {
  return typeof senha === 'string' && senha.length >= 10 && /[a-zA-Z]/.test(senha) && /\d/.test(senha);
}

export function pinValido(pin) {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}
