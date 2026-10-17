// Tela de login: avatares + PIN pad tátil; senha para admin (fase 4/11)
import { ic } from '../icons.js';
import { get, post } from '../api.js';
import { toast, escapar } from '../ui.js';

export function render(raiz, mensagem, aoEntrar) {
  raiz.innerHTML = `
    <div class="tela-login">
      <div class="caixa-login">
        <section class="cartao">
          <h2 style="margin-top:0">${ic('pessoa')} Quem está operando?</h2>
          <div class="lista-usuarios" id="lista-usuarios"><div class="vazio">Carregando…</div></div>
        </section>
        <section class="cartao">
          <h2 style="margin-top:0">${ic('chave')} Acesso</h2>
          ${mensagem ? `<p style="color:var(--alerta)">${escapar(mensagem)}</p>` : ''}
          <div id="area-pin">
            <div class="display-valor" id="pin-display" aria-live="polite" aria-label="0 de 4 dígitos">○ ○ ○ ○</div>
            <p id="pin-erro" class="campo-erro" role="alert"></p>
            <div class="numpad" id="pin-pad">
              ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="btn" data-n="${n}">${n}</button>`).join('')}
              <button class="btn" data-n="C">C</button>
              <button class="btn" data-n="0">0</button>
              <button class="btn" data-n="<">⌫</button>
            </div>
            <button class="btn primario grande" id="pin-ok" style="width:100%;margin-top:10px" disabled>Entrar</button>
            <button class="btn ghost" id="modo-senha" style="width:100%;margin-top:6px">Entrar com e-mail/senha (admin)</button>
          </div>
          <form id="form-senha" style="display:none" autocomplete="off">
            <input id="login-usuario" class="btn ghost" placeholder="Usuário" style="width:100%;padding:12px;margin-bottom:8px;background:var(--canvas)" required />
            <input id="login-senha" type="password" placeholder="Senha" style="width:100%;padding:12px;margin-bottom:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />
            <button class="btn primario grande" style="width:100%">Entrar</button>
            <button type="button" class="btn ghost" id="voltar-pin" style="width:100%;margin-top:6px">Voltar ao PIN</button>
          </form>
          <form id="form-setup" style="display:none" autocomplete="off">
            <p><strong>Primeira execução:</strong> cadastre o administrador.</p>
            <input id="setup-nome" placeholder="Nome do administrador" style="width:100%;padding:12px;margin-bottom:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />
            <input id="setup-senha" type="password" placeholder="Mín. 10 caracteres" style="width:100%;padding:12px;margin-bottom:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />
            <input id="setup-pin" inputmode="numeric" maxlength="6" placeholder="PIN 4–6 dígitos (opcional)" style="width:100%;padding:12px;margin-bottom:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
            <p><small style="color:var(--texto-fraco)">A senha precisa ter no mínimo 10 caracteres, com letras e números.</small></p>
            <button class="btn primario grande" style="width:100%">Criar administrador</button>
          </form>
        </section>
      </div>
    </div>`;

  let selecionado = null;
  let pin = '';
  let autenticando = false;

  get('/auth/status').then((st) => {
    if (st.logo_path) {
      const topo = raiz.querySelector('.tela-login');
      const faixa = document.createElement('div');
      faixa.style.cssText = 'position:absolute;top:14px;left:0;right:0;text-align:center;pointer-events:none';
      faixa.innerHTML = `<img src="/${escapar(st.logo_path)}" alt="${escapar(st.empresa_nome ?? 'Logomarca')}" style="max-height:64px;max-width:220px;border-radius:10px" />`;
      topo.style.position = 'relative';
      topo.prepend(faixa);
    }
    if (st.setup_necessario) {
      raiz.querySelector('#area-pin').style.display = 'none';
      raiz.querySelector('#form-setup').style.display = 'block';
      raiz.querySelector('#form-setup').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await post('/auth/setup', {
            nome: raiz.querySelector('#setup-nome').value.trim(),
            senha: raiz.querySelector('#setup-senha').value,
            pin: raiz.querySelector('#setup-pin').value || undefined,
          });
          aoEntrar(r);
        } catch (err) { toast(err.message, 'erro'); }
      };
      return;
    }
    carregarUsuarios(st);
  }).catch(() => carregarUsuarios(null));

  function carregarUsuarios() {
    get('/auth/operadores').then((r) => {
      const lista = raiz.querySelector('#lista-usuarios');
      lista.innerHTML = r.usuarios.map((u) => `
        <button class="btn usuario-btn ${selecionado === u.nome ? 'selecionado' : ''}" data-nome="${escapar(u.nome)}" data-pin="${u.tem_pin ? 1 : 0}">
          <span class="avatar">${escapar(u.nome[0]?.toUpperCase() ?? '?')}</span>
          <span>${escapar(u.nome)}<br><small>${rotulo(u.cargo)}</small></span>
        </button>`).join('');
      lista.querySelectorAll('[data-nome]').forEach((b) => {
        b.onclick = () => {
          selecionado = b.dataset.nome;
          lista.querySelectorAll('[data-nome]').forEach((x) => x.classList.remove('selecionado'));
          b.classList.add('selecionado');
          if (b.dataset.pin === '0') {
            raiz.querySelector('#modo-senha').click();
            raiz.querySelector('#login-usuario').value = selecionado;
          }
        };
      });
    }).catch(() => {
      raiz.querySelector('#lista-usuarios').innerHTML = '<div class="vazio">Usuários por PIN indisponíveis. Use senha.</div>';
      raiz.querySelector('#modo-senha').click();
    });
  }

  function rotulo(cargo) { return { admin: 'Administrador', caixa: 'Caixa', garcom: 'Garçom', cozinha: 'Cozinha' }[cargo] ?? cargo; }

  const display = raiz.querySelector('#pin-display');
  const btnOk = raiz.querySelector('#pin-ok');
  function refletir() {
    // PIN visual (spec): círculos preenchidos + vazios — 4 a 6 dígitos.
    const cheios = '●'.repeat(pin.length);
    const vazios = '○'.repeat(Math.max(0, 4 - pin.length));
    display.textContent = (cheios + vazios).split('').join(' ');
    display.setAttribute('aria-label', `${pin.length} de ${Math.max(4, pin.length)} dígitos`);
    btnOk.disabled = pin.length < 4 || autenticando;
  }
  raiz.querySelectorAll('#pin-pad [data-n]').forEach((b) => {
    b.onclick = () => {
      const n = b.dataset.n;
      if (n === 'C') pin = '';
      else if (n === '<') pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += n;
      const erro = raiz.querySelector('#pin-erro');
      if (erro) erro.textContent = ''; // erro anterior some ao digitar de novo
      refletir();
    };
  });
  btnOk.onclick = async () => {
    if (!selecionado) { toast('Selecione seu usuário', 'erro'); return; }
    if (autenticando) return; // trava duplo toque (o rate limit conta cada tentativa)
    autenticando = true;
    btnOk.disabled = true;
    btnOk.textContent = 'Autenticando…';
    try {
      const r = await post('/auth/login', { usuario: selecionado, pin });
      aoEntrar(r);
    } catch (e) {
      pin = '';
      const erro = raiz.querySelector('#pin-erro');
      if (erro) erro.textContent = e.message ?? 'PIN incorreto, tente novamente';
      try { navigator.vibrate?.([120]); } catch { /* vibração é opcional por API */ }
      toast(e.message, 'erro');
      refletir();
    } finally {
      autenticando = false;
      btnOk.textContent = 'Entrar';
      refletir(); // restaura o disabled conforme o PIN
    }
  };

  raiz.querySelector('#modo-senha').onclick = () => {
    raiz.querySelector('#area-pin').style.display = 'none';
    raiz.querySelector('#form-senha').style.display = 'block';
    raiz.querySelector('#login-usuario').focus();
  };
  raiz.querySelector('#voltar-pin').onclick = () => {
    raiz.querySelector('#form-senha').style.display = 'none';
    raiz.querySelector('#area-pin').style.display = 'block';
  };
  let entrandoSenha = false;
  raiz.querySelector('#form-senha').onsubmit = async (e) => {
    e.preventDefault();
    if (entrandoSenha) return; // rate limit conta cada tentativa: sem duplo envio
    entrandoSenha = true;
    const btn = e.target.querySelector('.btn.primario');
    const rotulo = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Autenticando…'; }
    try {
      const r = await post('/auth/login', {
        usuario: raiz.querySelector('#login-usuario').value.trim(),
        senha: raiz.querySelector('#login-senha').value,
      });
      aoEntrar(r);
    } catch (err) { toast(err.message, 'erro'); }
    finally {
      entrandoSenha = false;
      if (btn) { btn.disabled = false; btn.textContent = rotulo; }
    }
  };
}
