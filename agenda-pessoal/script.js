/**
 * AGENDA PESSOAL - FRONTEND COM AUTENTICAÇÃO E ISOLAMENTO SQLITE
 * Suporte a Sessões Persistentes, Validação Estrita, Anti-Brute Force e Modo WAL
 */

document.addEventListener('DOMContentLoaded', () => {

  // Elementos de Autenticação
  const authOverlay = document.getElementById('auth-overlay');
  const mainApp = document.getElementById('main-app');
  const authAlert = document.getElementById('auth-alert');

  const tabLoginBtn = document.getElementById('tab-login-btn');
  const tabRegisterBtn = document.getElementById('tab-register-btn');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const recoverForm = document.getElementById('recover-form');

  const loginEmailInput = document.getElementById('login-email');
  const loginPassInput = document.getElementById('login-password');
  const loginRememberCheckbox = document.getElementById('login-remember');
  const btnLoginSubmit = document.getElementById('btn-login-submit');

  const regNameInput = document.getElementById('reg-name');
  const regEmailInput = document.getElementById('reg-email');
  const regPassInput = document.getElementById('reg-password');
  const btnRegSubmit = document.getElementById('btn-reg-submit');

  // Elementos de Recuperação de Senha
  const btnForgotPass = document.getElementById('btn-forgot-pass');
  const btnBackToLogin = document.getElementById('btn-back-to-login');
  const recoverEmailInput = document.getElementById('recover-email');
  const btnSendCode = document.getElementById('btn-send-code');
  const recoverStep1 = document.getElementById('recover-step-1');
  const recoverStep2 = document.getElementById('recover-step-2');
  const recoverCodeInput = document.getElementById('recover-code');
  const recoverNewPassInput = document.getElementById('recover-new-password');
  const btnSubmitReset = document.getElementById('btn-submit-reset');

  // Botões de Visualizar Senha
  const btnToggleLoginPass = document.getElementById('btn-toggle-login-pass');
  const btnToggleRegPass = document.getElementById('btn-toggle-reg-pass');
  const btnToggleRecPass = document.getElementById('btn-toggle-rec-pass');

  // Medidor de Força da Senha
  const passMeterFill = document.getElementById('pass-meter-fill');
  const passMeterLabel = document.getElementById('pass-meter-label');
  const ruleLen = document.getElementById('rule-len');
  const ruleUpper = document.getElementById('rule-upper');
  const ruleLower = document.getElementById('rule-lower');
  const ruleNum = document.getElementById('rule-num');
  const ruleSpec = document.getElementById('rule-spec');

  // Dados do Usuário Logado
  const userDisplayName = document.getElementById('user-display-name');
  const userDisplayEmail = document.getElementById('user-display-email');
  const userAvatarLetter = document.getElementById('user-avatar-letter');
  const btnLogout = document.getElementById('btn-logout');

  // Elementos da Agenda
  const agendaForm = document.getElementById('agenda-form');
  const inputTitle = document.getElementById('input-title');
  const inputDate = document.getElementById('input-date');
  const inputTime = document.getElementById('input-time');
  const inputCategory = document.getElementById('input-category');
  const inputDesc = document.getElementById('input-desc');
  const btnSave = document.getElementById('btn-save');

  const itemsList = document.getElementById('items-list');
  const emptyState = document.getElementById('empty-state');
  const searchInput = document.getElementById('search-input');
  const filterTabs = document.querySelectorAll('.filter-tab');

  const countTotal = document.getElementById('count-total');
  const countPending = document.getElementById('count-pending');
  const countDone = document.getElementById('count-done');
  const tabAllCount = document.getElementById('tab-all-count');
  const tabTodayCount = document.getElementById('tab-today-count');
  const tabPendingCount = document.getElementById('tab-pending-count');
  const tabDoneCount = document.getElementById('tab-done-count');

  const activeDateFilterBox = document.getElementById('active-date-filter');
  const filterDateLabel = document.getElementById('filter-date-label');
  const clearDateFilterBtn = document.getElementById('clear-date-filter');

  // =========================================================================
  // GESTÃO DE SESSÃO (LOCALSTORAGE vs SESSIONSTORAGE)
  // =========================================================================
  function getSavedToken() {
    return localStorage.getItem('agenda_auth_token') || sessionStorage.getItem('agenda_auth_token') || null;
  }

  function saveToken(token, persist) {
    if (persist) {
      localStorage.setItem('agenda_auth_token', token);
      sessionStorage.removeItem('agenda_auth_token');
    } else {
      sessionStorage.setItem('agenda_auth_token', token);
      localStorage.removeItem('agenda_auth_token');
    }
  }

  function clearSavedToken() {
    localStorage.removeItem('agenda_auth_token');
    sessionStorage.removeItem('agenda_auth_token');
  }

  let authToken = getSavedToken();
  let currentUser = null;
  let compromissos = [];
  let currentFilter = 'all';
  let selectedCalendarDate = null;
  let searchKeyword = '';

  // Data atual no Fuso Horário de São Paulo
  const todaySaoPaulo = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const todayStr = todaySaoPaulo;
  if (inputDate) {
    inputDate.value = todayStr;
    inputDate.min = todayStr; // Impede seleção de datas no passado no frontend
  }

  const currentDateBadge = document.getElementById('current-date-badge');
  if (currentDateBadge) {
    const options = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' };
    const formattedToday = new Date().toLocaleDateString('pt-BR', options);
    currentDateBadge.textContent = formattedToday.charAt(0).toUpperCase() + formattedToday.slice(1);
  }

  // =========================================================================
  // SISTEMA DE NOTIFICAÇÕES TOAST
  // =========================================================================
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = '✓';
    if (type === 'error') icon = '✕';
    if (type === 'info') icon = 'ℹ';

    toast.innerHTML = `<span style="font-size:16px;">${icon}</span> <span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =========================================================================
  // ALERTA DE AUTENTICAÇÃO
  // =========================================================================
  function showAuthAlert(htmlOrText, isError = true) {
    authAlert.innerHTML = htmlOrText;
    authAlert.className = `auth-alert ${isError ? 'error' : 'success'}`;
    authAlert.style.display = 'block';

    const btnGoto = document.getElementById('btn-goto-login');
    if (btnGoto) {
      btnGoto.addEventListener('click', () => {
        tabLoginBtn.click();
        if (regEmailInput) loginEmailInput.value = regEmailInput.value.trim();
        loginPassInput.focus();
      });
    }
  }

  function hideAuthAlert() {
    authAlert.style.display = 'none';
    authAlert.innerHTML = '';
  }

  // =========================================================================
  // BOTÕES DE VISUALIZAR SENHA
  // =========================================================================
  function setupPassToggle(btn, input) {
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      btn.textContent = isPass ? '🔒' : '👁️';
    });
  }
  setupPassToggle(btnToggleLoginPass, loginPassInput);
  setupPassToggle(btnToggleRegPass, regPassInput);
  setupPassToggle(btnToggleRecPass, recoverNewPassInput);

  // =========================================================================
  // NAVEGAÇÃO ENTRE ABAS
  // =========================================================================
  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    loginForm.style.display = 'flex';
    registerForm.style.display = 'none';
    if (recoverForm) recoverForm.style.display = 'none';
    hideAuthAlert();
  });

  tabRegisterBtn.addEventListener('click', () => {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    registerForm.style.display = 'flex';
    loginForm.style.display = 'none';
    if (recoverForm) recoverForm.style.display = 'none';
    hideAuthAlert();
  });

  if (btnForgotPass) {
    btnForgotPass.addEventListener('click', () => {
      loginForm.style.display = 'none';
      registerForm.style.display = 'none';
      if (recoverForm) {
        recoverForm.style.display = 'flex';
        recoverStep1.style.display = 'block';
        recoverStep2.style.display = 'none';
        if (loginEmailInput.value) recoverEmailInput.value = loginEmailInput.value;
      }
      hideAuthAlert();
    });
  }

  if (btnBackToLogin) {
    btnBackToLogin.addEventListener('click', () => {
      tabLoginBtn.click();
    });
  }

  // =========================================================================
  // MEDIDOR DE SENHA FORTE EM TEMPO REAL
  // =========================================================================
  regPassInput.addEventListener('input', () => {
    const val = regPassInput.value;

    const hasLen = val.length >= 8;
    const hasUpper = /[A-Z]/.test(val);
    const hasLower = /[a-z]/.test(val);
    const hasNum = /[0-9]/.test(val);
    const hasSpec = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(val);

    updateRuleState(ruleLen, hasLen);
    updateRuleState(ruleUpper, hasUpper);
    updateRuleState(ruleLower, hasLower);
    updateRuleState(ruleNum, hasNum);
    updateRuleState(ruleSpec, hasSpec);

    let score = 0;
    if (hasLen) score++;
    if (hasUpper) score++;
    if (hasLower) score++;
    if (hasNum) score++;
    if (hasSpec) score++;

    btnRegSubmit.disabled = score !== 5;

    const pct = (score / 5) * 100;
    passMeterFill.style.width = `${pct}%`;

    if (score <= 2) {
      passMeterFill.style.backgroundColor = '#EF4444';
      passMeterLabel.textContent = 'Senha Fraca (faltam requisitos)';
      passMeterLabel.style.color = '#EF4444';
    } else if (score === 3 || score === 4) {
      passMeterFill.style.backgroundColor = '#F59E0B';
      passMeterLabel.textContent = 'Senha Média (quase lá)';
      passMeterLabel.style.color = '#F59E0B';
    } else {
      passMeterFill.style.backgroundColor = '#10B981';
      passMeterLabel.textContent = 'Senha Forte e Segura!';
      passMeterLabel.style.color = '#10B981';
    }
  });

  function updateRuleState(el, isValid) {
    if (isValid) {
      el.classList.add('valid');
      el.querySelector('.rule-icon').textContent = '✓';
    } else {
      el.classList.remove('valid');
      el.querySelector('.rule-icon').textContent = '○';
    }
  }

  // =========================================================================
  // SUBMISSÃO DE CADASTRO
  // =========================================================================
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();

    const nome = regNameInput.value.trim();
    const email = regEmailInput.value.trim().toLowerCase();
    const senha = regPassInput.value;

    try {
      btnRegSubmit.disabled = true;
      btnRegSubmit.innerHTML = '<span>Criando conta segura...</span>';

      const res = await fetch('/api/auth/cadastro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, senha })
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          showAuthAlert(`Este e-mail já está cadastrado. <button type="button" class="auth-alert-action-btn" id="btn-goto-login">Entrar com este e-mail</button>`);
        } else {
          showAuthAlert(data.error || 'Erro ao criar conta.');
        }
        btnRegSubmit.disabled = false;
        btnRegSubmit.innerHTML = '<span>Criar Conta e Entrar</span>';
        return;
      }

      authToken = data.token;
      currentUser = data.usuario;
      saveToken(authToken, true); // Cadastro salva por padrão

      showToast('Conta criada com sucesso!');
      iniciarSessaoLogada();
    } catch (err) {
      showAuthAlert('Erro ao conectar ao servidor. Verifique sua conexão.');
      btnRegSubmit.disabled = false;
      btnRegSubmit.innerHTML = '<span>Criar Conta e Entrar</span>';
    }
  });

  // =========================================================================
  // SUBMISSÃO DE LOGIN
  // =========================================================================
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();

    const email = loginEmailInput.value.trim().toLowerCase();
    const senha = loginPassInput.value;
    const persist = loginRememberCheckbox ? loginRememberCheckbox.checked : false;

    try {
      btnLoginSubmit.disabled = true;
      btnLoginSubmit.innerHTML = '<span>Autenticando...</span>';

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      });
      const data = await res.json();

      if (!res.ok) {
        showAuthAlert(data.error || 'E-mail ou senha incorretos.');
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.innerHTML = '<span>Entrar na Agenda</span>';
        return;
      }

      authToken = data.token;
      currentUser = data.usuario;
      saveToken(authToken, persist);

      showToast(`Bem-vindo(a), ${currentUser.nome}!`);
      iniciarSessaoLogada();
    } catch (err) {
      showAuthAlert('Erro ao conectar ao servidor. Verifique sua conexão.');
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.innerHTML = '<span>Entrar na Agenda</span>';
    }
  });

  // =========================================================================
  // RECUPERAÇÃO DE SENHA
  // =========================================================================
  if (btnSendCode) {
    btnSendCode.addEventListener('click', async () => {
      const email = recoverEmailInput.value.trim().toLowerCase();
      if (!email) {
        showAuthAlert('Informe seu e-mail cadastrado.');
        return;
      }

      try {
        btnSendCode.disabled = true;
        btnSendCode.textContent = 'Gerando código...';

        const res = await fetch('/api/auth/recuperar-senha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (res.ok) {
          recoverStep1.style.display = 'none';
          recoverStep2.style.display = 'block';
          if (data.codigoSimulado) {
            showAuthAlert(`Código de recuperação: <strong>${data.codigoSimulado}</strong> (Válido por 15 min)`, false);
            recoverCodeInput.value = data.codigoSimulado;
          } else {
            showAuthAlert('Código gerado. Verifique seu e-mail e digite abaixo.', false);
          }
        } else {
          showAuthAlert(data.error || 'Erro ao solicitar recuperação.');
        }
      } catch (err) {
        showAuthAlert('Erro ao conectar ao servidor.');
      } finally {
        btnSendCode.disabled = false;
        btnSendCode.textContent = 'Solicitar Código de Recuperação';
      }
    });
  }

  if (recoverForm) {
    recoverForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = recoverEmailInput.value.trim().toLowerCase();
      const codigo = recoverCodeInput.value.trim();
      const novaSenha = recoverNewPassInput.value;

      try {
        btnSubmitReset.disabled = true;
        btnSubmitReset.textContent = 'Redefinindo senha...';

        const res = await fetch('/api/auth/redefinir-senha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, codigo, novaSenha })
        });
        const data = await res.json();

        if (res.ok) {
          showToast('Senha redefinida com sucesso! Faça login.');
          tabLoginBtn.click();
          loginEmailInput.value = email;
          loginPassInput.value = '';
          showAuthAlert('Senha alterada! Entre com a nova senha.', false);
        } else {
          showAuthAlert(data.error || 'Erro ao redefinir senha.');
        }
      } catch (err) {
        showAuthAlert('Erro ao conectar ao servidor.');
      } finally {
        btnSubmitReset.disabled = false;
        btnSubmitReset.textContent = 'Redefinir Senha e Entrar';
      }
    });
  }

  // =========================================================================
  // LOGOUT (LIMPEZA TOTAL DE SESSÃO)
  // =========================================================================
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
      } catch (e) {}

      clearSavedToken();
      authToken = null;
      currentUser = null;
      compromissos = [];

      authOverlay.style.display = 'flex';
      mainApp.style.display = 'none';
      loginPassInput.value = '';
      hideAuthAlert();
      showToast('Sessão encerrada com segurança.', 'info');
    });
  }

  // =========================================================================
  // VERIFICAR SESSÃO AO CARREGAR
  // =========================================================================
  async function verificarSessaoInicial() {
    authToken = getSavedToken();
    if (!authToken) {
      authOverlay.style.display = 'flex';
      mainApp.style.display = 'none';
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      if (!res.ok) throw new Error('Sessão expirada');
      const data = await res.json();
      currentUser = data.usuario;
      iniciarSessaoLogada();
    } catch (err) {
      clearSavedToken();
      authToken = null;
      authOverlay.style.display = 'flex';
      mainApp.style.display = 'none';
    }
  }

  function iniciarSessaoLogada() {
    authOverlay.style.display = 'none';
    mainApp.style.display = 'grid';

    if (currentUser) {
      userDisplayName.textContent = currentUser.nome;
      userDisplayEmail.textContent = currentUser.email;
      userAvatarLetter.textContent = currentUser.nome.charAt(0).toUpperCase();
    }

    carregarCompromissos();
  }

  // =========================================================================
  // CARREGAR COMPROMISSOS COM ISOLAMENTO SQLITE
  // =========================================================================
  async function carregarCompromissos() {
    if (!authToken) return;

    try {
      const res = await fetch('/api/compromissos', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.status === 401) {
        showToast('Sua sessão expirou. Faça login novamente.', 'error');
        btnLogout.click();
        return;
      }
      compromissos = await res.json();
    } catch (err) {
      compromissos = [];
      showToast('Erro ao carregar dados do banco.', 'error');
    }

    renderizarCompromissos();
    renderizarCalendario();
    atualizarContadores();
  }

  // =========================================================================
  // ADICIONAR NOVO COMPROMISSO (ANTI-DUPLO CLIQUE + PREVENÇÃO DE CONFLITO)
  // =========================================================================
  if (agendaForm) {
    agendaForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const titulo = inputTitle.value.trim();
      const data = inputDate.value;
      const horario = inputTime.value;
      const categoria = inputCategory.value;
      const descricao = inputDesc.value.trim();

      if (!titulo || !data) {
        showToast('Preencha pelo menos o título e a data.', 'error');
        return;
      }

      if (data < todayStr) {
        showToast('Não é permitido agendar em datas no passado.', 'error');
        return;
      }

      const payload = { titulo, data, horario, categoria, descricao };

      try {
        btnSave.disabled = true;
        btnSave.innerHTML = '<span>Salvando no banco...</span>';

        const res = await fetch('/api/compromissos', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify(payload)
        });

        const dataRes = await res.json();

        if (!res.ok) {
          showToast(dataRes.error || 'Erro ao salvar compromisso.', 'error');
          return;
        }

        compromissos.unshift(dataRes);
        agendaForm.reset();
        inputDate.value = todayStr;
        inputCategory.value = 'Lembrete';

        showToast('Compromisso agendado com sucesso!');
        renderizarCompromissos();
        renderizarCalendario();
        atualizarContadores();
      } catch (err) {
        showToast('Falha na comunicação com o servidor.', 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          <span>Salvar na Agenda</span>
        `;
      }
    });
  }

  // =========================================================================
  // ALTERNAR STATUS (CONCLUÍDO / PENDENTE)
  // =========================================================================
  async function toggleStatus(id) {
    const item = compromissos.find(c => c.id === id);
    if (!item) return;

    const novoStatus = item.concluido ? 0 : 1;
    item.concluido = novoStatus;

    try {
      await fetch(`/api/compromissos/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ concluido: novoStatus === 1 })
      });
      showToast(novoStatus ? 'Marcado como concluído!' : 'Marcado como pendente!');
    } catch (e) {
      showToast('Erro ao atualizar status no servidor.', 'error');
    }

    renderizarCompromissos();
    atualizarContadores();
  }

  // =========================================================================
  // EXCLUIR COMPROMISSO
  // =========================================================================
  async function excluirCompromisso(id) {
    if (!confirm('Deseja realmente remover este compromisso?')) return;

    try {
      const res = await fetch(`/api/compromissos/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      if (!res.ok) {
        showToast('Erro ao excluir no banco.', 'error');
        return;
      }

      compromissos = compromissos.filter(c => c.id !== id);
      showToast('Compromisso excluído.');
      renderizarCompromissos();
      renderizarCalendario();
      atualizarContadores();
    } catch (e) {
      showToast('Falha na comunicação com o servidor.', 'error');
    }
  }

  // =========================================================================
  // RENDERIZAÇÃO DA LISTA DE COMPROMISSOS
  // =========================================================================
  function renderizarCompromissos() {
    itemsList.innerHTML = '';

    let filtrados = compromissos;

    if (currentFilter === 'today') {
      filtrados = filtrados.filter(c => c.data === todayStr);
    } else if (currentFilter === 'pending') {
      filtrados = filtrados.filter(c => !c.concluido);
    } else if (currentFilter === 'done') {
      filtrados = filtrados.filter(c => c.concluido);
    }

    if (selectedCalendarDate) {
      filtrados = filtrados.filter(c => c.data === selectedCalendarDate);
    }

    if (searchKeyword) {
      const term = searchKeyword.toLowerCase();
      filtrados = filtrados.filter(c => 
        (c.titulo && c.titulo.toLowerCase().includes(term)) ||
        (c.descricao && c.descricao.toLowerCase().includes(term)) ||
        (c.categoria && c.categoria.toLowerCase().includes(term))
      );
    }

    if (filtrados.length === 0) {
      emptyState.style.display = 'block';
    } else {
      emptyState.style.display = 'none';

      filtrados.forEach(item => {
        const card = document.createElement('div');
        card.className = `agenda-item-card ${item.concluido ? 'is-done' : ''}`;
        card.setAttribute('data-id', item.id);

        const dataFormatada = formatarDataBrasileira(item.data);

        card.innerHTML = `
          <div class="item-checkbox-wrap">
            <button class="custom-checkbox" title="${item.concluido ? 'Marcar como pendente' : 'Marcar como concluído'}">
              ✓
            </button>
          </div>

          <div class="item-content">
            <div class="item-header-row">
              <span class="item-title">${escapeHTML(item.titulo)}</span>
              <span class="category-tag category-${escapeHTML(item.categoria || 'Geral')}">${escapeHTML(item.categoria || 'Geral')}</span>
            </div>

            ${item.descricao ? `<p class="item-desc">${escapeHTML(item.descricao)}</p>` : ''}

            <div class="item-meta-row">
              <span class="item-meta-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                ${dataFormatada}
              </span>
              ${item.horario ? `
                <span class="item-meta-item">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  ${escapeHTML(item.horario)}
                </span>
              ` : ''}
            </div>
          </div>

          <div class="item-actions">
            <button class="btn-delete-item" title="Excluir compromisso">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        `;

        card.querySelector('.custom-checkbox').addEventListener('click', () => toggleStatus(item.id));
        card.querySelector('.btn-delete-item').addEventListener('click', () => excluirCompromisso(item.id));

        itemsList.appendChild(card);
      });
    }
  }

  // =========================================================================
  // ATUALIZAR CONTADORES
  // =========================================================================
  function atualizarContadores() {
    const total = compromissos.length;
    const pendentes = compromissos.filter(c => !c.concluido).length;
    const concluidos = compromissos.filter(c => c.concluido).length;
    const hoje = compromissos.filter(c => c.data === todayStr).length;

    if (countTotal) countTotal.textContent = total;
    if (countPending) countPending.textContent = pendentes;
    if (countDone) countDone.textContent = concluidos;

    if (tabAllCount) tabAllCount.textContent = total;
    if (tabTodayCount) tabTodayCount.textContent = hoje;
    if (tabPendingCount) tabPendingCount.textContent = pendentes;
    if (tabDoneCount) tabDoneCount.textContent = concluidos;
  }

  // =========================================================================
  // MINI CALENDÁRIO INTERATIVO
  // =========================================================================
  let calDate = new Date();

  function renderizarCalendario() {
    const calDaysContainer = document.getElementById('calendar-days');
    const calMonthTitle = document.getElementById('calendar-month-year');
    if (!calDaysContainer || !calMonthTitle) return;

    calDaysContainer.innerHTML = '';

    const year = calDate.getFullYear();
    const month = calDate.getMonth();

    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    calMonthTitle.textContent = `${monthNames[month]} ${year}`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'cal-day empty';
      calDaysContainer.appendChild(emptyCell);
    }

    for (let day = 1; day <= lastDay; day++) {
      const dayCell = document.createElement('div');
      dayCell.className = 'cal-day';
      dayCell.textContent = day;

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      if (dateStr === todayStr) dayCell.classList.add('today');
      if (dateStr === selectedCalendarDate) dayCell.classList.add('selected');

      const hasEvents = compromissos.some(c => c.data === dateStr);
      if (hasEvents) dayCell.classList.add('has-events');

      dayCell.addEventListener('click', () => {
        if (selectedCalendarDate === dateStr) {
          selectedCalendarDate = null;
          activeDateFilterBox.style.display = 'none';
        } else {
          selectedCalendarDate = dateStr;
          activeDateFilterBox.style.display = 'flex';
          filterDateLabel.textContent = formatarDataBrasileira(dateStr);
        }
        renderizarCalendario();
        renderizarCompromissos();
      });

      calDaysContainer.appendChild(dayCell);
    }
  }

  const prevMonthBtn = document.getElementById('prev-month-btn');
  const nextMonthBtn = document.getElementById('next-month-btn');
  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      calDate.setMonth(calDate.getMonth() - 1);
      renderizarCalendario();
    });
  }
  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      calDate.setMonth(calDate.getMonth() + 1);
      renderizarCalendario();
    });
  }

  if (clearDateFilterBtn) {
    clearDateFilterBtn.addEventListener('click', () => {
      selectedCalendarDate = null;
      activeDateFilterBox.style.display = 'none';
      renderizarCalendario();
      renderizarCompromissos();
    });
  }

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.getAttribute('data-filter');
      renderizarCompromissos();
    });
  });

  // Debounce na busca
  let searchTimeout = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchKeyword = e.target.value.trim();
        renderizarCompromissos();
      }, 250);
    });
  }

  function formatarDataBrasileira(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    if (isoDate === todayStr) return `Hoje, ${d}/${m}`;
    return `${d}/${m}/${y}`;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Iniciar verificação de autenticação
  verificarSessaoInicial();

});
