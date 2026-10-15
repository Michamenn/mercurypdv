# Relatório de Segurança e Riscos Residuais

Data: 2026-10-12 · Responsável: Security/Integrator · Base: OWASP ASVS (nível adaptado a aplicação LAN)

## 1. Controles implementados (com evidência)

| Controle | Implementação | Evidência (teste) |
|---|---|---|
| Hash de credenciais com salt + pepper | scrypt N=32768/r=8/p=1, salt por usuário, pepper em `.env` (gerado na 1ª execução, fora de `public/`) | `01-auth.test.js` AUTH-001 |
| Sem credenciais padrão | Setup abre APENAS com 0 usuários; após o 1º admin fecha para sempre | AUTH-001 (403 no 2º setup) |
| Bloqueio progressivo | 5 falhas → 1 min, dobra até teto 30 min; contador persistente no banco + limiter por IP (30/min) | AUTH-002 (PIN correto bloqueado durante lockout) |
| Sessão revogável server-side | Token opaco 256 bits, armazenado só como SHA-256; logout e desativação revogam; 12 h absoluta + 30 min inatividade | AUTH-004/005 |
| CSRF | Cookie `httpOnly` `SameSite=Lax` + header custom obrigatório em toda mutação | AUTH-003 (403 sem header) |
| RBAC negação por padrão | Toda rota protegida consulta `permissoes` do BANCO pelo cargo do usuário autenticado; cargo/valores do cliente nunca são lidos | RBAC-001/002 (garçom/caixa/cozinha barrados em 12 tentativas diretas) |
| Step-up admin | Sangria/suprimento do caixa, cancelamento pós-envio, estorno e painel dev exigem senha de um admin válido | RBAC step-up tests |
| Sem senha mestra/backdoor | DIV-005: dev = cargo admin + reautenticação. Nenhuma credencial universal existe no código | `grep` auditável |
| SQL injection | 100% consultas parametrizadas (prepared statements); sem concatenação de entrada | Revisão de código + tests de entrada malformada |
| XSS | Frontend usa `escapar()` em todo dado interpolado; sem `innerHTML` com dado bruto do usuário; cabeçalhos `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` | Revisão de código |
| Auditoria append-only | Triggers no SQLite ABORTAM UPDATE/DELETE em `auditoria`, `caixa_movimentacoes`, `estoque_movimentacoes` | DB-006 (throws verificados) |
| Segredos fora do repositório | `.env` com pepper gerado; nunca dentro de `public/` (única raiz estática) | Estrutura de diretórios |
| Logs sem segredos | Auditoria registra ação/valores/IP, nunca PIN/senha/token | DB-006 + revisão |
| Validação de entrada | Tipos, faixas, tamanhos e formatos validados em todos os endpoints (422) | RBAC "entrada malformada" (5 casos) |
| Totais server-side | Browser nunca é fonte de verdade: `total_centavos` do cliente é ignorado; fechar exige saldo 0 calculado no servidor | PDV-002/005 + concorrência |
| Idempotência | `Idempotency-Key` UNIQUE em pedidos/itens/pagamentos; UNIQUE composto em baixa de estoque | PDV-006, EST-002 |
| Integridade de backup | `VACUUM INTO` (cópia consistente) + `integrity_check` na cópia; restauração em uso é bloqueada | BKP-001..003 |
| Exposição mínima de rede | `public/` é a única raiz estática; `data/`, `backups/`, `logs/` fora; `x-powered-by` removido; firewall restrito ao perfil privado (script pronto) | Estrutura + scripts/firewall.ps1 |

## 2. Riscos residuais (aceitos com mitigação — decisão do responsável)

| ID | Risco | Mitigação existente | Recomendação |
|---|---|---|---|
| R-01 | **PIN de 4–6 dígitos tem entropia baixa** (ataque offline com acesso ao arquivo do banco) | scrypt memory-hard + pepper secreto (quebra exige `.env` E banco) + rate limit online | Se o banco sair da máquina, troque todos os PINs; considere PIN de 6 dígitos |
| R-02 | **Rede local é confiada** — dispositivo Wi-Fi comprometido pode atacar a API | Autenticação + RBAC + CSRF em todo endpoint; HTTP (sem TLS) na LAN | Para LAN hostil, use TLS com certificado local (pendente P-03) |
| R-03 | **Sessão em cookie sem TLS** pode ser capturada por sniffing na rede | Cookie httpOnly; rede privada; logout por turno | TLS local resolve (P-03) |
| R-04 | **Backups não criptografados** contêm todos os dados | Diretório separado; retenção; integridade verificada | Criptografar cópias externas (ex.: BitLocker no destino) |
| R-05 | **Ator físico com acesso ao Windows** do caixa tem poder de acesso ao arquivo SQLite | NTFS + conta Windows dedicada; não há backdoor no app, mas acesso ao SO implica acesso ao arquivo | Política de SO fora do escopo; documentada |
| R-06 | **Estoque pode ficar negativo** (política AD-004: venda nunca bloqueada por ficha) | Alertas em tempo real + histórico completo | Ajuste fichas/inventário com frequência |
| R-07 | **Impressão depende do driver** do Windows (não testada em hardware real aqui) | Preview fiel 58/80 mm + `window.print()` | Homologar na impressora térmica do cliente (checklist H-09) |
| R-08 | **Dependências**: express 5.3.0, ws 8.22.0 | Instalação mínima (2 deps); `npm audit` executado (ver 04-testes) | Manter atualização trimestral |

## 3. Limites declarados

- Não há integração com provedores de pagamento: PIX/cartão são **lançados pelo operador**; o sistema não "confirma" transações de terceiros.
- Sem emissão fiscal (BR-002). Recibos são de conferência.
- A segurança física do servidor Windows e do roteador é pré-condição fora do escopo do software.
