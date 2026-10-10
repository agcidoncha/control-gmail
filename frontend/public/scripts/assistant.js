(() => {
  const form = document.querySelector('#assistantForm');
  const questionNode = document.querySelector('#assistantQuestion');
  const submitButton = document.querySelector('#assistantSubmit');
  const connectionStatus = document.querySelector('#assistantConnectionStatus');
  const messageNode = document.querySelector('#assistantMessage');
  const answerNode = document.querySelector('#assistantAnswer');
  if (!form || !questionNode || !submitButton || !connectionStatus || !messageNode || !answerNode) return;

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
    submitButton.disabled = true;
    answerNode.hidden = true;
    showMessage('Analizando los mensajes autorizados…');
    try {
      const response = await fetch('/assistant/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar al asistente.');
      renderAnswer(data.analysis);
      showMessage('Análisis completado.', 'success');
    } catch (error) {
      showMessage(error.message || 'No se pudo consultar al asistente.', 'error');
    } finally {
      submitButton.disabled = !canAsk;
    }
  });

  loadConnection();
})();
