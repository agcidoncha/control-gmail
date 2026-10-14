(() => {
  const form = document.querySelector('#assistantForm');
  const questionNode = document.querySelector('#assistantQuestion');
  const submitButton = document.querySelector('#assistantSubmit');
  const connectionStatus = document.querySelector('#assistantConnectionStatus');
  const messageNode = document.querySelector('#assistantMessage');
  const answerNode = document.querySelector('#assistantAnswer');
  const analysisRangeNode = document.querySelector('#analysisRange');
  const analysisScopeNode = document.querySelector('#analysisScope');
  const customDatesNode = document.querySelector('#analysisCustomDates');
  const analysisFromNode = document.querySelector('#analysisFrom');
  const analysisToNode = document.querySelector('#analysisTo');
  const analysisCostNotice = document.querySelector('#analysisCostNotice');
  const clientNode = document.querySelector('#assistantClient');
  const clientSearchNode = document.querySelector('#assistantClientSearch');
  const clientResultsNode = document.querySelector('#assistantClientResults');
  const clientStatusNode = document.querySelector('#assistantClientStatus');
  const loadingModal = document.querySelector('#assistantLoadingModal');
  const loadingDescription = document.querySelector('#assistantLoadingDescription');
  if (!form || !questionNode || !submitButton || !connectionStatus || !messageNode || !answerNode || !analysisRangeNode || !analysisScopeNode || !customDatesNode || !analysisFromNode || !analysisToNode || !analysisCostNotice || !clientNode || !clientSearchNode || !clientResultsNode || !clientStatusNode || !loadingModal || !loadingDescription) return;
  const presetButtons = [...document.querySelectorAll('[data-assistant-prompt]')];

  const providerLabel = (provider) => provider === 'claude'
    ? 'Anthropic Claude'
    : provider === 'deepseek'
      ? 'DeepSeek'
      : 'OpenAI';
  const allClientsValue = '__all__';
  let detectedClients = [];
  const selectedClient = () => clientNode.value && clientNode.value !== allClientsValue ? clientNode.value : undefined;
  let canAsk = false;
  let confirmedSubmission = false;
  const requestedClient = new URLSearchParams(window.location.search).get('client')?.trim().toLowerCase() || '';

  function showMessage(value, type = '') {
    messageNode.textContent = value;
    messageNode.className = 'form-message' + (type ? ' ' + type : '');
  }

  function showLoadingMessage(value) {
    messageNode.textContent = '';
    messageNode.className = 'form-message';
    loadingDescription.textContent = value;
    loadingModal.hidden = false;
    document.documentElement.classList.add('assistant-loading-open');
  }

  function hideLoadingMessage() {
    loadingModal.hidden = true;
    document.documentElement.classList.remove('assistant-loading-open');
  }

  function setConnectionStatus(data) {
    const personal = data.personal;
    const company = data.company;
    const connection = personal || (company?.canUse && company.status === 'active' ? company : null);
    canAsk = Boolean(connection);
    submitButton.disabled = !canAsk;

    if (!connection) {
      connectionStatus.textContent = 'Sin conexión IA';
      connectionStatus.className = 'status-pill status-warning';
      showMessage('Conecta una clave personal o solicita al administrador acceso a la conexión global.');
      return;
    }

    connectionStatus.textContent = providerLabel(connection.provider) + (personal ? ' · personal' : ' · empresa');
    connectionStatus.className = 'status-pill';
    showMessage('Conexión disponible para esta cuenta.', 'success');
  }

  const presetQuestion = new URLSearchParams(window.location.search).get('prompt');
  if (presetQuestion) questionNode.value = presetQuestion;

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value + 'T00:00:00');
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function customRangeDays() {
    if (!analysisFromNode.value || !analysisToNode.value) return null;
    const from = new Date(analysisFromNode.value + 'T00:00:00Z');
    const to = new Date(analysisToNode.value + 'T00:00:00Z');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }

  function updateAnalysisWindow() {
    const isCustom = analysisRangeNode.value === 'custom';
    customDatesNode.hidden = !isCustom;
    analysisFromNode.required = isCustom;
    analysisToNode.required = isCustom;
    const days = isCustom ? customRangeDays() : Number(analysisRangeNode.value);
    if (isCustom && !days) {
      analysisCostNotice.textContent = 'Elige una fecha inicial y una fecha final válidas.';
      analysisCostNotice.className = 'analysis-cost-notice warning';
      return;
    }
    const scopeWarning = analysisScopeNode.value === 'all'
      ? ' Se incluirán también mensajes archivados.'
      : analysisScopeNode.value === 'spam'
        ? ' Se consultará la carpeta Spam.'
        : '';
    if (days > 30 || analysisScopeNode.value !== 'mailbox') {
      analysisCostNotice.textContent = `Se analizarán aproximadamente ${days} días.${scopeWarning} Esto puede enviar más contexto al modelo y aumentar el consumo y el coste de IA.`;
      analysisCostNotice.className = 'analysis-cost-notice warning';
    } else {
      analysisCostNotice.textContent = 'Por defecto se analizan los últimos 30 días para controlar el consumo de IA.';
      analysisCostNotice.className = 'analysis-cost-notice';
    }
  }

  function analysisPayload() {
    if (analysisRangeNode.value === 'custom') {
      const days = customRangeDays();
      if (!days) throw new Error('Indica un rango de fechas válido para el análisis.');
      return { analysisFrom: analysisFromNode.value, analysisTo: analysisToNode.value, analysisScope: analysisScopeNode.value, clientEmail: selectedClient(), days };
    }
    const days = Number(analysisRangeNode.value);
    if (!Number.isFinite(days) || days <= 0) throw new Error('Selecciona un periodo de análisis válido.');
    return { analysisDays: days, analysisScope: analysisScopeNode.value, clientEmail: selectedClient(), days };
  }

  function confirmAnalysis(selectedRange) {
    const scopeLabel = selectedRange.analysisScope === 'all'
      ? 'todos los mensajes'
      : selectedRange.analysisScope === 'spam'
        ? 'la carpeta Spam'
        : 'bandeja de entrada y enviados';
    const clientLabel = selectedRange.clientEmail ? ` exclusivamente para ${selectedRange.clientEmail}` : '';
    return window.confirm(`Esta acción consultará la IA y puede consumir crédito. Se revisarán ${selectedRange.days} días de ${scopeLabel}${clientLabel}. ¿Quieres ejecutar el análisis ahora?`);
  }

  function addList(parent, title, values) {
    if (!Array.isArray(values) || values.length === 0) return;
    const heading = document.createElement('h4');
    heading.textContent = title;
    parent.append(heading);
    const list = document.createElement('ul');
    values.forEach((value) => {
      const item = document.createElement('li');
      item.textContent = String(value);
      list.append(item);
    });
    parent.append(list);
  }

  function formatAnalysisScope(scope) {
    return scope === 'all' ? 'todos los mensajes (incluye archivados)' : scope === 'spam' ? 'Spam' : 'bandeja y enviados';
  }

  function renderAnswer(analysis, context = {}) {
    answerNode.replaceChildren();
    const toolbar = document.createElement('div');
    toolbar.className = 'assistant-answer-toolbar';
    const printButton = document.createElement('button');
    printButton.type = 'button';
    printButton.className = 'assistant-print-button';
    printButton.textContent = 'Imprimir / guardar PDF';
    printButton.title = 'Abre la ventana de impresión para imprimir o guardar la consulta como PDF';
    printButton.addEventListener('click', () => window.print());
    toolbar.append(printButton);
    answerNode.append(toolbar);

    const printMeta = document.createElement('p');
    printMeta.className = 'assistant-print-meta';
    const range = context.analysisWindow;
    const period = range?.from && range?.to
      ? `${formatDate(range.from)} a ${formatDate(range.to)}`
      : context.selectedRange?.days
        ? `últimos ${context.selectedRange.days} días`
        : 'periodo seleccionado';
    const client = context.selectedRange?.clientEmail || 'todos los clientes';
    printMeta.textContent = `Consulta comercial · Cliente: ${client} · Periodo: ${period} · Alcance: ${formatAnalysisScope(range?.scope || context.selectedRange?.analysisScope)}`;
    answerNode.append(printMeta);

    const printQuestion = document.createElement('p');
    printQuestion.className = 'assistant-print-question';
    const questionLabel = document.createElement('strong');
    questionLabel.textContent = 'Consulta: ';
    printQuestion.append(questionLabel, document.createTextNode(context.question || 'Análisis comercial solicitado'));
    answerNode.append(printQuestion);

    if (analysis.requiere_revision) {
      const note = document.createElement('div');
      note.className = 'review-note';
      const icon = document.createElement('img');
      icon.src = '/icons/home/alert-triangle.svg';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = 'Requiere revisión humana';
      note.append(icon, label);
      answerNode.append(note);
    }
    const title = document.createElement('h3');
    title.textContent = 'Resultado del análisis';
    answerNode.append(title);
    const response = document.createElement('p');
    response.textContent = analysis.respuesta || 'Sin respuesta.';
    answerNode.append(response);
    addList(answerNode, 'Hechos', analysis.hechos);
    addList(answerNode, 'Inferencias', analysis.inferencias);
    addList(answerNode, 'Acciones propuestas', analysis.acciones_propuestas);

    if (Array.isArray(analysis.fuentes) && analysis.fuentes.length) {
      const heading = document.createElement('h4');
      heading.textContent = 'Fuentes';
      answerNode.append(heading);
      analysis.fuentes.forEach((source) => {
        const sourceNode = document.createElement('div');
        sourceNode.className = 'source';
        const subject = document.createElement('strong');
        subject.textContent = source.asunto || 'Mensaje';
        const reason = document.createElement('small');
        reason.textContent = source.motivo || '';
        sourceNode.append(subject, reason);
        answerNode.append(sourceNode);
      });
    }
    answerNode.hidden = false;
  }

  async function loadConnection() {
    try {
      const response = await fetch('/ai/connections');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo comprobar la conexión IA.');
      setConnectionStatus(data);
    } catch (error) {
      connectionStatus.textContent = 'Error de conexión';
      connectionStatus.className = 'status-pill status-warning';
      showMessage(error.message || 'No se pudo comprobar la conexión IA.', 'error');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = questionNode.value.trim();
    if (!question || !canAsk) return;
    if (!clientNode.value) {
      showMessage('Selecciona un cliente antes de lanzar el análisis. También puedes elegir el análisis general.', 'error');
      return;
    }
    let selectedRange;
    try {
      selectedRange = analysisPayload();
    } catch (error) {
      showMessage(error.message || 'Revisa el periodo de análisis.', 'error');
      return;
    }
    if (!confirmedSubmission && !confirmAnalysis(selectedRange)) return;
    confirmedSubmission = false;
    submitButton.disabled = true;
    answerNode.hidden = true;
    showLoadingMessage('Actualizando Gmail y preparando el análisis…');
    let analysisCompleted = false;
    try {
      const response = await fetch('/assistant/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, ...selectedRange }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar al asistente.');
      renderAnswer(data.analysis, { selectedRange, analysisWindow: data.analysisWindow, question });
      const range = data.analysisWindow;
      const scopeLabel = range?.scope === 'all'
        ? 'todos los mensajes'
        : range?.scope === 'spam'
          ? 'Spam'
          : 'bandeja y enviados';
      const clientLabel = selectedRange.clientEmail ? ` · Cliente: ${selectedRange.clientEmail}` : '';
      showMessage(range ? `Análisis completado: ${formatDate(range.from)} a ${formatDate(range.to)} · ${scopeLabel}${clientLabel}.` : 'Análisis completado.', 'success');
      analysisCompleted = true;
    } catch (error) {
      showMessage(error.message || 'No se pudo consultar al asistente.', 'error');
    } finally {
      hideLoadingMessage();
      submitButton.disabled = !canAsk;
      if (analysisCompleted) messageNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      questionNode.value = button.dataset.assistantPrompt || '';
      if (!canAsk) {
        showMessage('Conecta una clave IA antes de iniciar el análisis.', 'error');
        questionNode.focus();
        return;
      }
      let selectedRange;
      try {
        selectedRange = analysisPayload();
      } catch (error) {
        showMessage(error.message || 'Revisa el periodo de análisis.', 'error');
        return;
      }
      if (!confirmAnalysis(selectedRange)) return;
      confirmedSubmission = true;
      form.requestSubmit();
      questionNode.focus();
    });
  });

  analysisRangeNode.addEventListener('change', updateAnalysisWindow);
  analysisScopeNode.addEventListener('change', updateAnalysisWindow);
  analysisFromNode.addEventListener('change', updateAnalysisWindow);
  analysisToNode.addEventListener('change', updateAnalysisWindow);
  clientNode.addEventListener('change', () => {
    if (selectedClient()) {
      clientStatusNode.textContent = `La próxima consulta se limitará a ${selectedClient()}.`;
    } else if (clientNode.value === allClientsValue) {
      clientStatusNode.textContent = 'Se analizará el conjunto disponible de conversaciones.';
    } else {
      clientStatusNode.textContent = 'Selecciona un cliente o el análisis general.';
    }
  });
  function renderClientOptions(searchTerm = '') {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const selectedValue = clientNode.value;
    const matchingClients = detectedClients.filter((client) => client.email.toLowerCase().includes(normalizedSearch));
    clientNode.replaceChildren();

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Selecciona un cliente';
    emptyOption.disabled = true;
    clientNode.append(emptyOption);

    const allOption = document.createElement('option');
    allOption.value = allClientsValue;
    allOption.textContent = 'Todos los clientes (análisis general)';
    clientNode.append(allOption);

    matchingClients.forEach((client) => {
      const option = document.createElement('option');
      option.value = client.email;
      option.textContent = `${client.email} (${client.messages} ${client.messages === 1 ? 'mensaje' : 'mensajes'})`;
      clientNode.append(option);
    });

    clientResultsNode.replaceChildren();
    clientResultsNode.hidden = !normalizedSearch;
    const addClientResult = (value, label, detail, selected = false) => {
      const result = document.createElement('button');
      result.type = 'button';
      result.className = 'assistant-client-result' + (selected ? ' is-selected' : '');
      result.setAttribute('role', 'option');
      result.setAttribute('aria-selected', selected ? 'true' : 'false');
      const name = document.createElement('span');
      name.textContent = label;
      const count = document.createElement('small');
      count.textContent = detail;
      result.append(name, count);
      result.addEventListener('click', () => {
        clientNode.value = value;
        clientSearchNode.value = value === allClientsValue ? '' : label;
        clientNode.dispatchEvent(new Event('change', { bubbles: true }));
        renderClientOptions(clientSearchNode.value);
      });
      clientResultsNode.append(result);
    };

    if (!normalizedSearch) {
      // La opción de análisis general permanece únicamente en el selector completo.
    } else if (!matchingClients.length) {
      const empty = document.createElement('p');
      empty.className = 'assistant-client-result-empty';
      empty.textContent = 'No hay clientes que coincidan con esa búsqueda.';
      clientResultsNode.append(empty);
    } else {
      const visibleClients = matchingClients.slice(0, 20);
      visibleClients.forEach((client) => addClientResult(client.email, client.email, `${client.messages} ${client.messages === 1 ? 'mensaje' : 'mensajes'}`, selectedValue === client.email));
      if (matchingClients.length > visibleClients.length) {
        const more = document.createElement('p');
        more.className = 'assistant-client-result-empty';
        more.textContent = `Mostrando ${visibleClients.length} de ${matchingClients.length}. Sigue escribiendo para afinar la búsqueda.`;
        clientResultsNode.append(more);
      }
    }

    if (selectedValue === allClientsValue || matchingClients.some((client) => client.email === selectedValue)) {
      clientNode.value = selectedValue;
    } else {
      clientNode.value = '';
    }
    clientSearchNode.setAttribute('aria-label', `${matchingClients.length} clientes coinciden con la búsqueda`);
  }

  clientSearchNode.addEventListener('input', () => {
    if (clientNode.value !== allClientsValue) clientNode.value = '';
    renderClientOptions(clientSearchNode.value);
  });
  updateAnalysisWindow();

  loadConnection();

  async function loadClients() {
    try {
      const response = await fetch('/gmail/insights?max=1000&refresh=1');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los clientes.');
      detectedClients = (data.insights?.clients || []).sort((left, right) => left.email.localeCompare(right.email));
      renderClientOptions();
      const clients = detectedClients;
      if (requestedClient && clients.some((client) => client.email.toLowerCase() === requestedClient)) {
        clientNode.value = requestedClient;
        clientSearchNode.value = requestedClient;
        renderClientOptions(requestedClient);
      }
      clientStatusNode.textContent = clients.length
        ? clientNode.value
          ? selectedClient()
            ? `La consulta está preparada para ${selectedClient()}.`
            : 'Selecciona un cliente para limitar el análisis o elige el análisis general.'
          : `${clients.length} clientes detectados. Puedes escribir en el selector para localizar uno.`
        : 'No hay clientes detectados en el periodo revisado.';
    } catch (error) {
      clientStatusNode.textContent = error.message || 'No se pudieron cargar los clientes.';
    }
  }

  loadClients();
})();
