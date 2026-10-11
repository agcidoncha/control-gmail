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
  if (!form || !questionNode || !submitButton || !connectionStatus || !messageNode || !answerNode || !analysisRangeNode || !analysisScopeNode || !customDatesNode || !analysisFromNode || !analysisToNode || !analysisCostNotice) return;
  const presetButtons = [...document.querySelectorAll('[data-assistant-prompt]')];

  const providerLabel = (provider) => provider === 'claude' ? 'Anthropic Claude' : 'OpenAI';
  let canAsk = false;

  function showMessage(value, type = '') {
    messageNode.textContent = value;
    messageNode.className = 'form-message' + (type ? ' ' + type : '');
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
      return { analysisFrom: analysisFromNode.value, analysisTo: analysisToNode.value, analysisScope: analysisScopeNode.value, days };
    }
    const days = Number(analysisRangeNode.value);
    if (!Number.isFinite(days) || days <= 0) throw new Error('Selecciona un periodo de análisis válido.');
    return { analysisDays: days, analysisScope: analysisScopeNode.value, days };
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

  function renderAnswer(analysis) {
    answerNode.replaceChildren();
    if (analysis.requiere_revision) {
      const note = document.createElement('div');
      note.className = 'review-note';
      note.textContent = '⚠ Requiere revisión humana';
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
    let selectedRange;
    try {
      selectedRange = analysisPayload();
    } catch (error) {
      showMessage(error.message || 'Revisa el periodo de análisis.', 'error');
      return;
    }
    if (selectedRange.days > 30 && !window.confirm(`Vas a analizar ${selectedRange.days} días de correo. Esto puede aumentar el consumo y el coste de IA. ¿Quieres continuar?`)) return;
    submitButton.disabled = true;
    answerNode.hidden = true;
    showMessage('Analizando los mensajes autorizados…');
    try {
      const response = await fetch('/assistant/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, ...selectedRange }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar al asistente.');
      renderAnswer(data.analysis);
      const range = data.analysisWindow;
      const scopeLabel = range?.scope === 'all'
        ? 'todos los mensajes'
        : range?.scope === 'spam'
          ? 'Spam'
          : 'bandeja y enviados';
      showMessage(range ? `Análisis completado: ${formatDate(range.from)} a ${formatDate(range.to)} · ${scopeLabel}.` : 'Análisis completado.', 'success');
    } catch (error) {
      showMessage(error.message || 'No se pudo consultar al asistente.', 'error');
    } finally {
      submitButton.disabled = !canAsk;
    }
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      questionNode.value = button.dataset.assistantPrompt || '';
      questionNode.focus();
    });
  });

  analysisRangeNode.addEventListener('change', updateAnalysisWindow);
  analysisScopeNode.addEventListener('change', updateAnalysisWindow);
  analysisFromNode.addEventListener('change', updateAnalysisWindow);
  analysisToNode.addEventListener('change', updateAnalysisWindow);
  updateAnalysisWindow();

  loadConnection();
})();
