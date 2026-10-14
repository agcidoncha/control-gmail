(() => {
  const accountNode = document.querySelector('#aiConnectionAccount');
  const companyNameNode = document.querySelector('#companyAiName');
  const companyStatusNode = document.querySelector('#companyAiStatus');
  const companyDescriptionNode = document.querySelector('#companyAiDescription');
  const personalNameNode = document.querySelector('#personalAiName');
  const personalStatusNode = document.querySelector('#personalAiStatus');
  const personalDescriptionNode = document.querySelector('#personalAiDescription');
  const personalCard = document.querySelector('#personalAiConnection');
  const form = document.querySelector('#personalAiForm');
  const personalProviderNode = document.querySelector('#personalAiProvider');
  const personalModelNode = document.querySelector('#personalAiModel');
  const keyNode = document.querySelector('#personalAiKey');
  const disconnectButton = document.querySelector('#disconnectPersonalAi');
  const messageNode = document.querySelector('#personalAiMessage');
  const adminControls = document.querySelector('#adminAiControls');
  const globalProviderNode = document.querySelector('#globalAiProvider');
  const globalModelNode = document.querySelector('#globalAiModel');
  const sharedUsersNode = document.querySelector('#sharedAiUsers');
  const adminMessageNode = document.querySelector('#adminAiMessage');
  if (!accountNode || !companyNameNode || !companyStatusNode || !companyDescriptionNode || !personalNameNode || !personalStatusNode || !personalDescriptionNode || !personalCard || !form || !personalProviderNode || !personalModelNode || !keyNode || !disconnectButton || !messageNode || !adminControls || !globalProviderNode || !globalModelNode || !sharedUsersNode || !adminMessageNode) return;

  const providerLabel = (provider) => provider === 'claude' ? 'Anthropic Claude' : provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const statusLabel = (status) => status === 'active' ? 'Activa' : status === 'not_configured' ? 'No configurada' : 'No conectada';
  let latestData = null;

  function renderModelOptions(node, models, selectedModel = '') {
    node.replaceChildren();
    if (!models?.length) {
      node.add(new Option('No hay modelos configurados', ''));
      node.disabled = true;
      return;
    }
    models.forEach((model) => node.add(new Option(model, model)));
    node.value = models.includes(selectedModel) ? selectedModel : models[0];
    node.disabled = false;
  }

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
    const personalProvider = data.providers?.[currentProvider];
    renderModelOptions(personalModelNode, personalProvider?.models ?? [], personal?.model || personalProvider?.model || '');
  }

  function render(data) {
    accountNode.textContent = data.account || 'Cuenta activa';
    personalCard.hidden = data.role === 'admin';
    companyNameNode.textContent = providerLabel(data.company.provider) + ' · ' + (data.company.model || 'modelo configurado');
    const canUseCompany = data.company.canUse;
    const personal = data.personal;
    const personalIsActive = data.activeConnection?.mode === 'user_personal';
    const companyIsActive = data.activeConnection?.mode === 'company_shared';
    companyStatusNode.textContent = personalIsActive ? 'Disponible' : !canUseCompany ? 'Sin acceso' : companyIsActive ? 'Activa' : statusLabel(data.company.status);
    companyStatusNode.className = 'status-pill' + (personalIsActive ? ' status-neutral' : data.company.status !== 'active' || !canUseCompany ? ' status-warning' : '');
    companyDescriptionNode.textContent = personalIsActive
      ? 'La conexión personal está activa para esta cuenta. La conexión de empresa queda disponible como alternativa.'
      : !canUseCompany
      ? 'La conexión global está configurada, pero el administrador todavía no te ha concedido acceso.'
      : 'La administra la organización. Ningún usuario verá la clave global y se usará mientras no haya una conexión personal.';

    personalNameNode.textContent = personal ? providerLabel(personal.provider) + ' · ' + (personal.model || data.providers?.[personal.provider]?.model || 'modelo configurado') : 'No conectada';
    personalStatusNode.textContent = personal ? 'Activa' : 'No conectada';
    personalStatusNode.className = 'status-pill' + (personal ? '' : ' status-neutral');
    personalDescriptionNode.textContent = personal
      ? 'Esta cuenta usa ahora su conexión personal. La clave se cifra en el servidor y no se muestra después de guardarla. Si la desconectas, volverás a la conexión de empresa.'
      : 'La clave se cifra en el servidor y solo se usará para tus peticiones. Nunca se muestra después de guardarla.';
    disconnectButton.disabled = !personal;
    disconnectButton.textContent = personal ? 'Volver a conexión de empresa' : 'Desconectar conexión personal';
    disconnectButton.title = personal ? 'Borra tu conexión personal y vuelve a la conexión compartida de la empresa' : 'No hay una conexión personal que desconectar';
    updatePersonalProviderOptions(data, personal);
  }

  async function load() {
    const response = await fetch('/ai/connections');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las conexiones.');
    latestData = data;
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
        body: JSON.stringify({ provider: personalProviderNode.value, model: personalModelNode.value, apiKey: keyNode.value }),
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

  function renderSharedUsers(users, data) {
    sharedUsersNode.replaceChildren();
    if (!users.length) {
      sharedUsersNode.textContent = 'No hay usuarios registrados.';
      return;
    }
    const adminGroup = document.createElement('section');
    adminGroup.className = 'shared-ai-user-group shared-ai-user-group-admin';
    const adminTitle = document.createElement('h5');
    adminTitle.textContent = 'Administrador';
    const adminRows = document.createElement('div');
    adminRows.className = 'shared-ai-user-group-rows';
    adminGroup.append(adminTitle, adminRows);

    const commercialGroup = document.createElement('section');
    commercialGroup.className = 'shared-ai-user-group shared-ai-user-group-commercial';
    const commercialTitle = document.createElement('h5');
    commercialTitle.textContent = 'Comerciales';
    const commercialRows = document.createElement('div');
    commercialRows.className = 'shared-ai-user-group-rows';
    commercialGroup.append(commercialTitle, commercialRows);

    users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'shared-ai-user';
      const heading = document.createElement('div');
      heading.className = 'shared-ai-user-heading';
      const identity = document.createElement('strong');
      identity.textContent = user.email;
      const role = document.createElement('small');
      role.textContent = user.role === 'admin' ? 'Administrador · acceso permanente' : 'Comercial';
      heading.append(identity, role);

      const controls = document.createElement('div');
      controls.className = 'shared-ai-user-controls';
      const accessLabel = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = user.aiAccessEnabled ?? user.canUseSharedAi;
      checkbox.disabled = user.role === 'admin';
      accessLabel.append(checkbox, document.createTextNode(user.role === 'admin' ? 'Administrador: acceso permanente' : 'Puede usar IA'));

      const providerLabelNode = document.createElement('label');
      providerLabelNode.textContent = 'Proveedor';
      const providerSelect = document.createElement('select');
      Object.entries(data.providers ?? {}).forEach(([provider, details]) => {
        const option = new Option(details.label, provider);
        option.disabled = !details.configured;
        providerSelect.add(option);
      });
      const isAdmin = user.role === 'admin';
      const hasAiAccess = isAdmin || (user.aiAccessEnabled ?? user.canUseSharedAi) === true;
      const selectedProvider = !isAdmin && hasAiAccess && user.aiProvider ? user.aiProvider : data.activeProvider;
      providerSelect.value = selectedProvider;
      providerLabelNode.append(providerSelect);

      const providerField = document.createElement('div');
      providerField.className = 'shared-ai-user-field';
      providerField.append(providerLabelNode);

      const modelLabelNode = document.createElement('label');
      modelLabelNode.textContent = 'Modelo';
      const modelSelect = document.createElement('select');
      const renderAssignedModels = (provider, selectedModel = '') => {
        const details = data.providers?.[provider];
        renderModelOptions(modelSelect, details?.models ?? [], selectedModel || (provider === data.activeProvider ? data.activeModel : details?.model));
      };
      renderAssignedModels(selectedProvider, !isAdmin && hasAiAccess && user.aiModel ? user.aiModel : data.activeModel);
      modelLabelNode.append(modelSelect);
      const modelField = document.createElement('div');
      modelField.className = 'shared-ai-user-field';
      modelField.append(modelLabelNode);
      controls.append(accessLabel, providerField, modelField);
      row.append(heading, controls);

      const syncAssignmentControls = () => {
        const canEditAssignment = !isAdmin && checkbox.checked;
        providerSelect.disabled = !canEditAssignment;
        modelSelect.disabled = !canEditAssignment;
        providerSelect.title = isAdmin
          ? 'El administrador siempre usa el proveedor global de la empresa'
          : canEditAssignment ? 'Proveedor asignado a este usuario' : 'Se usará el proveedor global de la empresa';
        modelSelect.title = isAdmin
          ? 'El administrador siempre usa el modelo global de la empresa'
          : canEditAssignment ? 'Modelo asignado a este usuario' : 'Se usará el modelo global de la empresa';
      };
      syncAssignmentControls();

      const saveUserSettings = async () => {
        const previous = { access: checkbox.checked, provider: providerSelect.value, model: modelSelect.value };
        checkbox.disabled = true;
        providerSelect.disabled = true;
        modelSelect.disabled = true;
        try {
          const response = await fetch('/admin/ai/users/' + encodeURIComponent(user.email), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ aiAccessEnabled: previous.access, provider: previous.provider, model: previous.model }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'No se pudo guardar la asignación.');
          user.aiAccessEnabled = result.aiAccessEnabled;
          user.canUseSharedAi = result.canUseSharedAi;
          user.aiProvider = result.aiProvider;
          user.aiModel = result.aiModel;
          showAdminMessage('Asignación de IA actualizada.', 'success');
        } catch (error) {
          checkbox.checked = previous.access;
          providerSelect.value = previous.provider;
          renderAssignedModels(previous.provider, previous.model);
          showAdminMessage(error.message || 'No se pudo guardar la asignación.', 'error');
        } finally {
          checkbox.disabled = user.role === 'admin';
          syncAssignmentControls();
        }
      };

      checkbox.addEventListener('change', () => {
        syncAssignmentControls();
        void saveUserSettings();
      });
      providerSelect.addEventListener('change', () => {
        renderAssignedModels(providerSelect.value);
        void saveUserSettings();
      });
      modelSelect.addEventListener('change', () => void saveUserSettings());
      (user.role === 'admin' ? adminRows : commercialRows).append(row);
    });
    if (adminRows.children.length) sharedUsersNode.append(adminGroup);
    if (commercialRows.children.length) sharedUsersNode.append(commercialGroup);
  }

  async function loadAdminSettings() {
    const response = await fetch('/admin/ai');
    if (response.status === 401 || response.status === 403) return;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar la configuración global.');
    adminControls.hidden = false;
    globalProviderNode.value = data.activeProvider;
    renderModelOptions(globalModelNode, data.providers[data.activeProvider]?.models ?? [], data.activeModel);
    renderSharedUsers(data.users, data);
  }

  async function saveGlobalSettings() {
    globalProviderNode.disabled = true;
    globalModelNode.disabled = true;
    showAdminMessage('Guardando proveedor y modelo global…');
    try {
      const response = await fetch('/admin/ai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: globalProviderNode.value, model: globalModelNode.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el proveedor global.');
      await load();
      await loadAdminSettings();
      showAdminMessage('');
    } catch (error) {
      showAdminMessage(error.message || 'No se pudo cambiar el proveedor global.', 'error');
      await loadAdminSettings();
    } finally {
      globalProviderNode.disabled = false;
      globalModelNode.disabled = false;
    }
  }

  globalProviderNode.addEventListener('change', () => {
    const provider = latestData?.providers?.[globalProviderNode.value];
    renderModelOptions(globalModelNode, provider?.models ?? [], provider?.model ?? '');
    void saveGlobalSettings();
  });
  globalModelNode.addEventListener('change', () => void saveGlobalSettings());
  personalProviderNode.addEventListener('change', () => {
    const provider = latestData?.providers?.[personalProviderNode.value];
    renderModelOptions(personalModelNode, provider?.models ?? [], provider?.model ?? '');
  });

  Promise.all([
    load().catch((error) => showMessage(error.message || 'No se pudieron cargar las conexiones.', 'error')),
    loadAdminSettings().catch((error) => showAdminMessage(error.message || 'No se pudo cargar la configuración global.', 'error')),
  ]);
})();
