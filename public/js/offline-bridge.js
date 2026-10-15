// Ponte offline: POST seguro para drenagem de fila (só usada para KDS idempotente)
import { api } from './api.js';
export async function post(caminho, corpo) {
  return api('POST', caminho, corpo);
}
