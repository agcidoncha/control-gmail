(() => {
  const accountNode = document.querySelector('#aiConnectionAccount');
  const companyNameNode = document.querySelector('#companyAiName');
  const companyStatusNode = document.querySelector('#companyAiStatus');
  const companyDescriptionNode = document.querySelector('#companyAiDescription');
  const personalNameNode = document.querySelector('#personalAiName');
  const personalStatusNode = document.querySelector('#personalAiStatus');
  const personalCard = document.querySelector('#personalAiConnection');
  const form = document.querySelector('#personalAiForm');
  const personalProviderNode = document.querySelector('#personalAiProvider');
  const keyNode = document.querySelector('#personalAiKey');
  const disconnectButton = document.querySelector('#disconnectPersonalAi');
  const messageNode = document.querySelector('#personalAiMessage');
  const adminControls = document.querySelector('#adminAiControls');
  const globalProviderNode = document.querySelector('#globalAiProvider');
  const globalProviderStatusNode = document.querySelector('#globalAiProviderStatus');
  const sharedUsersNode = document.querySelector('#sharedAiUsers');
  const adminMessageNode = document.querySelector('#adminAiMessage');
  if (!accountNode || !companyNameNode || !companyStatusNode || !companyDescriptionNode || !personalNameNode || !personalStatusNode || !personalCard || !form || !personalProviderNode || !keyNode || !disconnectButton || !messageNode || !adminControls || !globalProviderNode || !globalProviderStatusNode || !sharedUsersNode || !adminMessageNode) return;

  const providerLabel = (provider) => provider === 'claude' ? 'Claude' : 'OpenAI';
  const statusLabel = (status) => status === 'active' ? 'Activa' : status === 'not_configured' ? 'No configurada' : 'No conectada';

  function showMessage(value, type = '') {
    messageNode.textContent = value;
    messageNode.className = 'form-message' + (type ? ' ' + type : '');
  }

  function updatePersonalProviderOptions(data, personal) {
    const currentProvider = personal?.provider || '';
    const companyProvider = data.company?.provider || '';
    const isAdmin = data.role === 'admin';

    [...personalProviderNode.options].forEach((option) => {
      if (!option.value) return;
      const isDuplicateOfGlobal = isAdmin && option.value === companyProvider && option.value !== currentProvider;
      option.hidden = isDuplicateOfGlobal;
      option.disabled = isDuplicateOfGlobal;
    });

    personalProviderNode.value = currentProvider;
  }

  function render(data) {
    accountNode.textContent = data.account || 'Cuenta activa';
    personalCard.hidden = data.role === 'admin';
    companyNameNode.textContent = providerLabel(data.company.provider) + ' · ' + (data.company.model || 'modelo configurado');
    const canUseCompany = data.company.canUse;
    companyStatusNode.textContent = !canUseCompany ? 'Sin acceso' : statusLabel(data.company.status);
    companyStatusNode.className = 'status-pill' + (data.company.status !== 'active' || !canUseCompany ? ' status-warning' : '');
    companyDescriptionNode.textContent = !canUseCompany
      ? 'La conexión global está configurada, pero el administrador todavía no te ha concedido acceso.'
      : 'La administra la organización. Ningún usuario verá la clave global.';

    const personal = data.personal;
    personalNameNode.textContent = personal ? providerLabel(personal.provider) : 'No conectada';
    personalStatusNode.textContent = personal ? 'Conectada' : 'No conectada';
    personalStatusNode.className = 'status-pill' + (personal ? '' : ' status-neutral');
    disconnectButton.disabled = !personal;
    disconnectButton.textContent = personal ? 'Volver a conexión de empresa' : 'Desconectar conexión personal';
    disconnectButton.title = personal ? 'Borra tu conexión personal y vuelve a la conexión compartida de la empresa' : 'No hay una conexión personal que desconectar';
    updatePersonalProviderOptions(data, personal);
  }

  async function load() {
    const response = await fetch('/ai/connections');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las conexiones.');
    render(data);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('Guardando conexión cifrada…');
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const response = await fetch('/ai/connections/personal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: personalProviderNode.value, apiKey: keyNode.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar la conexión.');
      keyNode.value = '';
      await load();
      showMessage('Conexión personal guardada. La clave no se volverá a mostrar.', 'success');
    } catch (error) {
      showMessage(error.message || 'No se pudo guardar la conexión.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });

  disconnectButton.addEventListener('click', async () => {
    if (!window.confirm('¿Desconectar tu conexión personal?')) return;
    disconnectButton.disabled = true;
    try {
      const response = await fetch('/ai/connections/personal', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo desconectar.');
      await load();
      showMessage('Conexión personal desconectada.', 'success');
    } catch (error) {
      showMessage(error.message || 'No se pudo desconectar.', 'error');
    } finally {
      disconnectButton.disabled = false;
    }
  });

  function showAdminMessage(value, type = '') {
    adminMessageNode.textContent = value;
    adminMessageNode.className = 'form-message' + (type ? ' ' + type : '');
  }

  function renderSharedUsers(users) {
    sharedUsersNode.replaceChildren();
    if (!users.length) {
      sharedUsersNode.textContent = 'No hay usuarios registrados.';
      return;
    }
    users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'shared-ai-user';
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = user.canUseSharedAi;
      checkbox.disabled = user.role === 'admin';
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        try {
          const response = await fetch('/admin/ai/users/' + encodeURIComponent(user.email), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canUseSharedAi: checkbox.checked }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el permiso.');
          user.canUseSharedAi = data.canUseSharedAi;
          showAdminMessage('Permiso actualizado.', 'success');
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          showAdminMessage(error.message || 'No se pudo cambiar el permiso.', 'error');
        } finally {
          checkbox.disabled = user.role === 'admin';
        }
      });
      label.append(checkbox, document.createTextNode(user.email));
      const role = document.createElement('small');
      role.textContent = user.role === 'admin' ? 'Administrador · acceso permanente' : 'Comercial';
      row.append(label, role);
      sharedUsersNode.append(row);
    });
  }

  async function loadAdminSettings() {
    const response = await fetch('/admin/ai');
    if (response.status === 401 || response.status === 403) return;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la configuración global.');
    adminControls.hidden = false;
    globalProviderNode.value = data.activeProvider;
    const active = data.providers[data.activeProvider];
    globalProviderStatusNode.textContent = active.configured
      ? providerLabel(data.activeProvider) + ' disponible · ' + active.model
      : providerLabel(data.activeProvider) + ' no tiene clave configurada en .env';
    renderSharedUsers(data.users);
  }

  globalProviderNode.addEventListener('change', async () => {
    globalProviderNode.disabled = true;
    showAdminMessage('Guardando proveedor global…');
    try {
      const response = await fetch('/admin/ai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: globalProviderNode.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el proveedor global.');
      showAdminMessage('Proveedor global actualizado.', 'success');
      await load();
      await loadAdminSettings();
    } catch (error) {
      showAdminMessage(error.message || 'No se pudo cambiar el proveedor global.', 'error');
      await loadAdminSettings();
    } finally {
      globalProviderNode.disabled = false;
    }
  });

  Promise.all([
    load().catch((error) => showMessage(error.message || 'No se pudieron cargar las conexiones.', 'error')),
    loadAdminSettings().catch((error) => showAdminMessage(error.message || 'No se pudo cargar la configuración global.', 'error')),
  ]);
})();
