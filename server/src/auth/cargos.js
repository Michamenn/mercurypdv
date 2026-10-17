// Cargos e helpers compartilhados de autorização.
//
// O cargo "proprietario" (Proprietário) é equivalente ao "admin" em TODAS as
// permissões, inclusive no step-up de operações sensíveis. A única exceção é o
// painel do desenvolvedor, que deixa de ser decidido pelo cargo e passa a ser
// controlado pela flag `pode_painel_dev` (admin = 1; todos os demais = 0).
//
// Centralizar aqui evita repetir a lista em cada ponto que hoje trata
// `cargo === 'admin'` de forma especial.
export const CARGOS_GESTAO = ['admin', 'proprietario'];

export const CARGOS_VALIDOS = ['admin', 'proprietario', 'caixa', 'garcom', 'cozinha'];

export function ehGestao(cargo) {
  return CARGOS_GESTAO.includes(cargo);
}

// Só o cargo "admin" do sistema administra contas de Administrador. O
// Proprietário tem `pode_gerenciar_usuarios`, mas NÃO pode criar um admin,
// elevar alguém a admin, nem editar/desativar/excluir/resetar credenciais/
// desbloquear uma conta admin — senão escalaria privilégio e entraria no painel
// dev por essa conta nova.
export function ehAdmin(cargo) {
  return cargo === 'admin';
}
