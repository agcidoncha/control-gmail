(() => {
  const listNode = document.querySelector('#clients');
  const countNode = document.querySelector('#clientCount');
  const searchNode = document.querySelector('#clientSearch');
  const paginationNode = document.querySelector('#clientPagination');
  const previousNode = document.querySelector('#clientPrevious');
  const nextNode = document.querySelector('#clientNext');
  const pageStatusNode = document.querySelector('#clientPageStatus');
  const rangeForm = document.querySelector('#clientRangeForm');
  const dateModeNode = document.querySelector('#clientDateMode');
  const exactDateField = document.querySelector('#clientExactDateField');
  const exactDateNode = document.querySelector('#clientExactDate');
  const dateRangeFields = document.querySelector('#clientDateRangeFields');
  const dateFromNode = document.querySelector('#clientDateFrom');
  const dateToNode = document.querySelector('#clientDateTo');
  const rangeSummaryNode = document.querySelector('#clientRangeSummary');
  const applyRangeButton = document.querySelector('#applyClientRange');
  const resetRangeButton = document.querySelector('#resetClientRange');
  if (!listNode || !countNode || !searchNode || !paginationNode || !previousNode || !nextNode || !pageStatusNode || !rangeForm || !dateModeNode || !exactDateField || !exactDateNode || !dateRangeFields || !dateFromNode || !dateToNode || !rangeSummaryNode || !applyRangeButton || !resetRangeButton) return;

  let clients = [];
  let currentPage = 1;
  let rangeSource = 'default';
  const mailboxRangeStorageKey = 'commercial-mailbox-range-v1';
  const clientsRangeStorageKey = 'commercial-clients-range-v1';

  const text = (tag, value, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
    return node;
  };

  function showErrorNotice(error, fallback, title = 'No se pudo completar la acción') {
    const message = error?.message || fallback;
    if (typeof window.showAppNotice === 'function') window.showAppNotice(message, { title });
  }

  function formatDate(value) {
    if (!value) return 'Fecha desconocida';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatWindowDate(value) {
    if (!value) return '';
    const date = new Date(`${String(value).replaceAll('/', '-')}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function readStoredRange(key) {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function initialRange() {
    const ownRange = readStoredRange(clientsRangeStorageKey);
    if (ownRange) {
      rangeSource = 'clients';
      return ownRange;
    }
    const mailboxRange = readStoredRange(mailboxRangeStorageKey);
    if (mailboxRange) {
      rangeSource = 'mailbox';
      return mailboxRange;
    }
    rangeSource = 'default';
    return { mode: 'this-month', from: '', to: '' };
  }

  function applyRangeToFields(range) {
    dateModeNode.value = range.mode === 'day' || range.mode === 'range' ? range.mode : 'this-month';
    exactDateNode.value = dateModeNode.value === 'day' ? range.from || '' : '';
    dateFromNode.value = dateModeNode.value === 'range' ? range.from || '' : '';
    dateToNode.value = dateModeNode.value === 'range' ? range.to || '' : '';
    updateDateFields();
  }

  function getPresetDateRange() {
    const today = new Date();
    return { from: formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1)) };
  }

  function getDateRange() {
    if (dateModeNode.value === 'this-month') return getPresetDateRange();
    if (dateModeNode.value === 'day') {
      if (!exactDateNode.value) throw new Error('Selecciona el día que quieres consultar.');
      const today = formatDateInput(new Date());
      return exactDateNode.value === today
        ? { from: exactDateNode.value }
        : { from: exactDateNode.value, to: exactDateNode.value };
    }
    if (!dateFromNode.value && !dateToNode.value) throw new Error('Indica al menos una fecha para buscar el periodo.');
    if (dateFromNode.value && dateToNode.value && dateFromNode.value > dateToNode.value) {
      throw new Error('La fecha «Desde» no puede ser posterior a «Hasta».');
    }
    const today = formatDateInput(new Date());
    return { from: dateFromNode.value, to: dateToNode.value === today ? undefined : dateToNode.value };
  }

  function updateDateFields() {
    const mode = dateModeNode.value;
    exactDateField.hidden = mode !== 'day';
    dateRangeFields.hidden = mode !== 'range';
    applyRangeButton.hidden = mode === 'this-month';
    resetRangeButton.hidden = mode === 'this-month';
  }

  function saveClientRange(dateRange) {
    try {
      sessionStorage.setItem(clientsRangeStorageKey, JSON.stringify({
        mode: dateModeNode.value,
        from: dateRange.from || '',
        to: dateRange.to || '',
      }));
      rangeSource = 'clients';
    } catch {
      // La consulta sigue funcionando aunque el almacenamiento de sesión no esté disponible.
    }
  }

  function setRangeSummary(analysisWindow) {
    if (!analysisWindow) return;
    const from = formatWindowDate(analysisWindow.from);
    const to = formatWindowDate(analysisWindow.to);
    const prefix = dateModeNode.value === 'this-month' ? 'Este mes' : dateModeNode.value === 'day' ? 'Día concreto' : 'Periodo';
    rangeSummaryNode.textContent = `${prefix}: ${from} – ${to}${rangeSource === 'mailbox' ? ' · heredado de Bandeja comercial' : ''}`;
  }

  function formatDateHints(hints) {
    return Array.isArray(hints) && hints.length ? 'Fechas/plazos: ' + hints.join(', ') : '';
  }

  async function toggleHistory(card, clientEmail, button) {
    let historyNode = card.querySelector('.client-history');
    if (historyNode) {
      historyNode.hidden = !historyNode.hidden;
      button.textContent = historyNode.hidden ? 'Ver historial' : 'Ocultar historial';
      return;
    }
    button.textContent = 'Cargando…';
    try {
      const response = await fetch('/gmail/client-history?email=' + encodeURIComponent(clientEmail) + '&max=50');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar el historial.');
      historyNode = document.createElement('div');
      historyNode.className = 'client-history';
      if (!data.messages?.length) {
        historyNode.append(text('p', 'No hay mensajes históricos verificables para este cliente.', 'muted'));
      } else {
        data.messages.forEach((message) => {
          const item = document.createElement('article');
          item.className = 'client-history-message';
          item.append(text('strong', message.subject));
          item.append(text('small', message.from + (message.to ? ' → ' + message.to : '') + ' · ' + formatDate(message.date)));
          item.append(text('span', [message.body, formatDateHints(message.dateHints)].filter(Boolean).join('\n')));
          historyNode.append(item);
        });
      }
      card.append(historyNode);
      button.textContent = 'Ocultar historial';
    } catch (error) {
      button.textContent = 'Ver historial';
      const message = text('p', error.message || 'No se pudo cargar el historial.', 'muted');
      card.append(message);
      showErrorNotice(error, 'No se pudo cargar el historial.', 'No se pudo cargar el historial');
    }
  }

  function makeClientCard(client) {
    const card = document.createElement('article');
    card.className = 'client-card';
    const summary = document.createElement('div');
    summary.className = 'client-summary';
    summary.append(text('strong', client.email));
    summary.append(text('small', client.messages + (client.messages === 1 ? ' mensaje relacionado' : ' mensajes relacionados')));
    summary.append(text('p', 'Última actividad: ' + formatDate(client.latestDate)));
    card.append(summary);
    const actions = document.createElement('div');
    actions.className = 'client-actions';
    const historyButton = text('button', 'Ver historial');
    historyButton.type = 'button';
    historyButton.addEventListener('click', () => toggleHistory(card, client.email, historyButton));
    const aiLink = document.createElement('a');
    aiLink.href = '/consultar-ia?client=' + encodeURIComponent(client.email) + '&prompt=' + encodeURIComponent(`Interpreta las necesidades, preferencias y estado comercial de ${client.email} usando solo sus conversaciones.`);
    aiLink.textContent = 'Analizar necesidades';
    actions.append(historyButton, aiLink);
    card.append(actions);
    return card;
  }

  function render() {
    const query = searchNode.value.trim().toLowerCase();
    const filteredClients = clients.filter((client) => client.email.toLowerCase().includes(query));
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageClients = filteredClients.slice(start, start + pageSize);

    countNode.textContent = query
      ? `${filteredClients.length} de ${clients.length} clientes`
      : `${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'}`;
    listNode.replaceChildren();
    if (!filteredClients.length) {
      listNode.append(text('p', query ? 'No hay clientes que coincidan con la búsqueda.' : 'No hay clientes detectados en los mensajes revisados.', 'muted'));
    } else {
      pageClients.forEach((client) => listNode.append(makeClientCard(client)));
    }

    const showPagination = filteredClients.length > pageSize;
    paginationNode.hidden = !showPagination;
    if (showPagination) {
      pageStatusNode.textContent = `Página ${currentPage} de ${totalPages}`;
      previousNode.disabled = currentPage === 1;
      nextNode.disabled = currentPage === totalPages;
    }
  }

  async function load() {
    try {
      const dateRange = getDateRange();
      const params = new URLSearchParams({ max: '1000' });
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to) params.set('to', dateRange.to);
      rangeSummaryNode.textContent = 'Consultando periodo…';
      const response = await fetch('/gmail/insights?' + params.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los clientes.');
      clients = data.insights?.clients || [];
      setRangeSummary(data.analysisWindow);
      updateDateFields();
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      if (!clients.length) {
        countNode.textContent = '0 clientes';
        paginationNode.hidden = true;
        listNode.append(text('p', 'No hay clientes detectados en los mensajes revisados.', 'muted'));
        return;
      }
      render();
    } catch (error) {
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      countNode.textContent = 'No disponible';
      listNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los clientes.', 'muted'));
      showErrorNotice(error, 'No se pudieron cargar los clientes.', 'No se pudieron cargar los clientes');
    }
  }

  applyRangeToFields(initialRange());
  rangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const dateRange = getDateRange();
      saveClientRange(dateRange);
      currentPage = 1;
      await load();
    } catch (error) {
      rangeSummaryNode.textContent = error.message || 'Revisa las fechas seleccionadas.';
      showErrorNotice(error, 'Revisa las fechas seleccionadas.', 'No se puede aplicar el periodo');
    }
  });
  dateModeNode.addEventListener('change', async () => {
    updateDateFields();
    if (dateModeNode.value === 'this-month') {
      exactDateNode.value = '';
      dateFromNode.value = '';
      dateToNode.value = '';
      const dateRange = getDateRange();
      saveClientRange(dateRange);
      currentPage = 1;
      await load();
    } else {
      rangeSummaryNode.textContent = 'Pendiente de aplicar';
    }
  });
  [exactDateNode, dateFromNode, dateToNode].forEach((node) => node.addEventListener('change', () => {
    if (dateModeNode.value === 'day' || dateModeNode.value === 'range') rangeSummaryNode.textContent = 'Pendiente de aplicar';
  }));
  resetRangeButton.addEventListener('click', async () => {
    dateModeNode.value = 'this-month';
    exactDateNode.value = '';
    dateFromNode.value = '';
    dateToNode.value = '';
    const dateRange = getDateRange();
    saveClientRange(dateRange);
    currentPage = 1;
    updateDateFields();
    await load();
  });

  searchNode.addEventListener('input', () => {
    currentPage = 1;
    render();
  });
  previousNode.addEventListener('click', () => {
    currentPage -= 1;
    render();
  });
  nextNode.addEventListener('click', () => {
    currentPage += 1;
    render();
  });

  load();
})();
