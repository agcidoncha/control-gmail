(() => {
  const messagesNode = document.querySelector('#messages');
  const mailboxNode = document.querySelector('#messageMailbox');
  const searchNode = document.querySelector('#messageSearch');
  const mailboxTitleNode = document.querySelector('#mailboxTitle');
  const mailboxSubtitleNode = document.querySelector('#mailboxSubtitle');
  const messageToolsNode = document.querySelector('.message-tools');
  const countNode = document.querySelector('#mailboxCount');
  const syncStatusNode = document.querySelector('#mailboxSyncStatus');
  const refreshButton = document.querySelector('#mailboxRefreshButton');
  const paginationStatusNodes = [...document.querySelectorAll('[data-mailbox-pagination-status]')];
  const pageNumberContainers = [...document.querySelectorAll('[data-mailbox-page-numbers]')];
  const rangeForm = document.querySelector('#messageRangeForm');
  const periodPromptNode = document.querySelector('#messagePeriodPrompt');
  const rangeInfoButton = document.querySelector('#messageRangeInfoButton');
  const rangeInfoModal = document.querySelector('#messageRangeInfoModal');
  const rangeInfoClose = document.querySelector('#messageRangeInfoClose');
  const rangeInfoIntroNode = document.querySelector('#messageRangeInfoDescription > p');
  const rangeInfoViewsNode = document.querySelector('#messageRangeInfoViews');
  const rangeInfoClientPeriodNode = document.querySelector('#messageRangeInfoClientPeriod');
  const pageSizeField = document.querySelector('#messagePageSizeField');
  const dateModeNode = document.querySelector('#messageDateMode');
  const exactDateField = document.querySelector('#messageExactDateField');
  const exactDateNode = document.querySelector('#messageExactDate');
  const dateRangeFields = document.querySelector('#messageDateRangeFields');
  const dateFromNode = document.querySelector('#messageDateFrom');
  const dateToNode = document.querySelector('#messageDateTo');
  const syncWindowNode = document.querySelector('#messageSyncWindow');
  const applyRangeButton = document.querySelector('#applyMessageRange');
  const clearRangeButton = document.querySelector('#clearMessageRange');
  const previousPageButtons = [...document.querySelectorAll('[data-mailbox-pagination="previous"]')];
  const nextPageButtons = [...document.querySelectorAll('[data-mailbox-pagination="next"]')];
  const archivedNoticeNode = document.querySelector('#archivedMailboxNotice');
  const undoNode = document.querySelector('#mailboxUndo');
  const undoMessageNode = document.querySelector('#mailboxUndoMessage');
  const undoButton = document.querySelector('#mailboxUndoButton');
  const messagesViewNode = document.querySelector('#mailboxMessagesView');
  const clientsViewNode = document.querySelector('#mailboxClientsView');
  const viewSwitchNode = document.querySelector('.mailbox-view-switch');
  const messagesTab = document.querySelector('#mailboxMessagesTab');
  const clientsTab = document.querySelector('#mailboxClientsTab');
  const clientSearchNode = document.querySelector('#mailboxClientSearch');
  const clientCountNode = document.querySelector('#mailboxClientCount');
  const clientPeriodModeNode = document.querySelector('#mailboxClientPeriodMode');
  const clientCustomPeriodButton = document.querySelector('#mailboxClientCustomPeriodButton');
  const clientResetPeriodButton = document.querySelector('#mailboxClientResetPeriodButton');
  const clientRangeForm = document.querySelector('#mailboxClientRangeForm');
  const clientDateModeNode = document.querySelector('#mailboxClientDateMode');
  const clientExactDateField = document.querySelector('#mailboxClientExactDateField');
  const clientExactDateNode = document.querySelector('#mailboxClientExactDate');
  const clientDateRangeFields = document.querySelector('#mailboxClientDateRangeFields');
  const clientDateFromNode = document.querySelector('#mailboxClientDateFrom');
  const clientDateToNode = document.querySelector('#mailboxClientDateTo');
  const applyClientRangeButton = document.querySelector('#applyMailboxClientRange');
  const clientRangeSummaryNode = document.querySelector('#mailboxClientRangeSummary');
  const clientStatusNode = document.querySelector('#mailboxClientStatus');
  const clientsListNode = document.querySelector('#mailboxClients');
  const clientPaginationNode = document.querySelector('#mailboxClientPagination');
  const clientPageNumbersNode = document.querySelector('#mailboxClientPageNumbers');
  const clientPageStatusNode = document.querySelector('#mailboxClientPageStatus');
  const clientPreviousButton = document.querySelector('[data-mailbox-client-pagination="previous"]');
  const clientNextButton = document.querySelector('[data-mailbox-client-pagination="next"]');
  const composeButton = document.querySelector('#composeMessageButton');
  const composeForm = document.querySelector('#composeMessageForm');
  const composeTitle = document.querySelector('#composeTitle');
  const composeTo = document.querySelector('#composeTo');
  const composeSubject = document.querySelector('#composeSubject');
  const composeBody = document.querySelector('#composeBody');
  const composeThreadId = document.querySelector('#composeThreadId');
  const composeReplyToMessageId = document.querySelector('#composeReplyToMessageId');
  const cancelComposeButton = document.querySelector('#cancelComposeButton');
  const composeStatus = document.querySelector('#composeStatus');
  const composePreview = document.querySelector('#composePreview');
  const previewTo = document.querySelector('#previewTo');
  const previewSubject = document.querySelector('#previewSubject');
  const previewBody = document.querySelector('#previewBody');
  const editComposeButton = document.querySelector('#editComposeButton');
  const confirmComposeButton = document.querySelector('#confirmComposeButton');
  let messages = [];
  let nextPageToken = null;
  let pageTokenHistory = [];
  let currentPageIndex = 0;
  let totalPageCount = null;
  let resultsTruncated = false;
  let loadingMessages = false;
  let messageRequestId = 0;
  let messagesError = '';
  let messageSearchTimer = null;
  let hasAppliedRange = false;
  let undoState = null;
  let undoTimer = null;
  let syncing = false;
  let activeView = new URLSearchParams(window.location.search).get('view') === 'clients' ? 'clients' : 'messages';
  let clients = [];
  let clientPage = 1;
  let clientsLoading = false;
  let clientRequestId = 0;
  let clientsPendingRangeKey = '';
  let clientsError = '';
  let clientsLoadedRangeKey = '';
  let clientsAnalysisWindow = null;
  let serverSearchQuery = '';
  let clientHasCustomRange = false;
  let clientCustomRange = null;
  let clientRangeEditing = false;
  let syncTimer = null;
  const syncIntervalMs = 10 * 60 * 1000;
  const mailboxRangeStorageKey = 'commercial-mailbox-range-v1';

  function saveMailboxRange(dateRange) {
    try {
      sessionStorage.setItem(mailboxRangeStorageKey, JSON.stringify({
        mode: dateModeNode.value,
        from: dateRange.from || '',
        to: dateRange.to || '',
      }));
    } catch {
      // La navegación sigue funcionando aunque el almacenamiento de sesión no esté disponible.
    }
  }

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getPresetDateRange(mode) {
    const today = new Date();
    return { from: formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1)) };
  }

  function getDateRange() {
    const mode = dateModeNode.value;
    if (!mode) throw new Error('Selecciona el periodo que quieres consultar.');
    if (mode === 'this-month') return getPresetDateRange(mode);
    if (mode === 'day') {
      if (!exactDateNode.value) throw new Error('Selecciona el día que quieres consultar.');
      const today = formatDateInput(new Date());
      return exactDateNode.value === today
        ? { from: exactDateNode.value }
        : { from: exactDateNode.value, to: exactDateNode.value };
    }
    if (!dateFromNode.value || !dateToNode.value) throw new Error('Indica las fechas «Desde» y «Hasta» para buscar el periodo.');
    if (dateFromNode.value && dateToNode.value && dateFromNode.value > dateToNode.value) {
      throw new Error('La fecha «Desde» no puede ser posterior a «Hasta».');
    }
    const today = formatDateInput(new Date());
    return {
      from: dateFromNode.value,
      to: dateToNode.value === today ? undefined : dateToNode.value,
    };
  }

  function getClientDateRange() {
    const mode = clientDateModeNode.value;
    if (!mode) throw new Error('Selecciona el periodo de clientes que quieres consultar.');
    if (mode === 'this-month') return getPresetDateRange(mode);
    if (mode === 'day') {
      if (!clientExactDateNode.value) throw new Error('Selecciona el día de clientes que quieres consultar.');
      const today = formatDateInput(new Date());
      return clientExactDateNode.value === today
        ? { from: clientExactDateNode.value }
        : { from: clientExactDateNode.value, to: clientExactDateNode.value };
    }
    if (!clientDateFromNode.value || !clientDateToNode.value) throw new Error('Indica las fechas «Desde» y «Hasta» para buscar los clientes.');
    if (clientDateFromNode.value && clientDateToNode.value && clientDateFromNode.value > clientDateToNode.value) {
      throw new Error('La fecha «Desde» de clientes no puede ser posterior a «Hasta».');
    }
    const today = formatDateInput(new Date());
    return {
      from: clientDateFromNode.value,
      to: clientDateToNode.value === today ? undefined : clientDateToNode.value,
    };
  }

  function updateClientDateFields() {
    const mode = clientDateModeNode.value;
    clientExactDateField.hidden = mode !== 'day';
    clientDateRangeFields.hidden = mode !== 'range';
    applyClientRangeButton.hidden = !mode;
  }

  function updateDateFields() {
    const mode = dateModeNode.value;
    pageSizeField.hidden = false;
    if (syncWindowNode) {
      syncWindowNode.hidden = true;
      syncWindowNode.textContent = '';
    }
    exactDateField.hidden = mode !== 'day';
    dateRangeFields.hidden = mode !== 'range';
    applyRangeButton.hidden = !mode;
    clearRangeButton.hidden = !mode;
  }

  function formatClientDate(value) {
    if (!value) return 'Fecha desconocida';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function setClientRangeSummary(analysisWindow) {
    if (!clientRangeSummaryNode || !analysisWindow) return;
    clientsAnalysisWindow = analysisWindow;
    const from = formatSyncWindowDate(analysisWindow.from);
    const to = formatSyncWindowDate(analysisWindow.to);
    const mode = clientHasCustomRange ? clientDateModeNode.value : dateModeNode.value;
    const prefix = clientHasCustomRange
      ? 'Periodo propio'
      : mode === 'this-month' ? 'Este mes' : mode === 'day' ? 'Día concreto' : 'Periodo';
    clientRangeSummaryNode.textContent = `${prefix}: ${from} – ${to}`;
  }

  function resetViewTabLabels() {
    messagesTab.textContent = 'Mensajes';
    clientsTab.textContent = 'Clientes';
  }

  function renderClientPagination(filteredClients) {
    if (!clientPaginationNode || !clientPageNumbersNode || !clientPageStatusNode || !clientPreviousButton || !clientNextButton) return;
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
    clientPage = Math.min(clientPage, totalPages);
    const visibleStart = Math.min(Math.max(clientPage - 2, 1), Math.max(1, totalPages - 4));
    const visibleEnd = Math.min(totalPages, visibleStart + 4);
    clientPageNumbersNode.replaceChildren();
    for (let page = visibleStart; page <= visibleEnd; page += 1) {
      const button = text('button', String(page), 'mailbox-page-number' + (page === clientPage ? ' is-current' : ''));
      button.type = 'button';
      button.dataset.mailboxClientPage = String(page);
      button.setAttribute('aria-label', 'Ir a la página ' + page);
      button.setAttribute('aria-current', page === clientPage ? 'page' : 'false');
      button.disabled = clientsLoading || page === clientPage;
      clientPageNumbersNode.append(button);
    }
    clientPaginationNode.hidden = filteredClients.length <= pageSize;
    clientPreviousButton.hidden = totalPages <= 1;
    clientNextButton.hidden = totalPages <= 1;
    clientPreviousButton.disabled = clientsLoading || clientPage === 1;
    clientNextButton.disabled = clientsLoading || clientPage === totalPages;
    clientPageStatusNode.textContent = totalPages > 1 ? `Página ${clientPage} de ${totalPages}` : '';
  }

  function makeMailboxClientCard(client) {
    const card = document.createElement('article');
    card.className = 'mailbox-client-card';
    const summary = document.createElement('div');
    summary.className = 'mailbox-client-summary';
    summary.append(text('strong', client.email));
    summary.append(text('small', `${client.messages} ${client.messages === 1 ? 'mensaje relacionado' : 'mensajes relacionados'} · Última actividad: ${formatClientDate(client.latestDate)}`));
    card.append(summary);
    const actions = document.createElement('div');
    actions.className = 'mailbox-client-actions';
    const messagesButton = text('button', 'Ver mensajes');
    messagesButton.type = 'button';
    messagesButton.addEventListener('click', async () => {
      if (clientHasCustomRange && clientsAnalysisWindow) {
        const from = clientsAnalysisWindow.from.replaceAll('/', '-');
        const to = clientsAnalysisWindow.to.replaceAll('/', '-');
        dateModeNode.value = from === to ? 'day' : 'range';
        exactDateNode.value = from;
        dateFromNode.value = from;
        dateToNode.value = to;
        updateDateFields();
      }
      mailboxNode.value = 'all';
      searchNode.value = client.email;
      serverSearchQuery = `{from:${client.email} to:${client.email}}`;
      currentPageIndex = 0;
      pageTokenHistory = [];
      setActiveView('messages', { load: false });
      await reloadMessages();
      searchNode.focus();
    });
    const aiLink = document.createElement('a');
    const analysisParams = new URLSearchParams({ client: client.email, prompt: `Interpreta las necesidades, preferencias y estado comercial de ${client.email} usando solo sus conversaciones.` });
    if (clientsAnalysisWindow) {
      analysisParams.set('from', clientsAnalysisWindow.from.replaceAll('/', '-'));
      analysisParams.set('to', clientsAnalysisWindow.to.replaceAll('/', '-'));
    }
    aiLink.href = '/consultar-ia?' + analysisParams.toString();
    aiLink.textContent = 'Analizar necesidades';
    actions.append(messagesButton, aiLink);
    card.append(actions);
    return card;
  }

  function renderClients() {
    if (!clientsListNode || !clientCountNode || !clientSearchNode) return;
    if (clientPeriodModeNode) clientPeriodModeNode.textContent = clientRangeEditing
      ? 'Selecciona un periodo personalizado'
      : clientHasCustomRange ? 'Clientes con periodo personalizado' : 'Clientes alineados con Mensajes';
    if (clientCustomPeriodButton) clientCustomPeriodButton.hidden = clientHasCustomRange || clientRangeEditing;
    if (clientResetPeriodButton) clientResetPeriodButton.hidden = !clientHasCustomRange;
    if (clientRangeForm) clientRangeForm.hidden = !clientRangeEditing;
    if (!hasAppliedRange && !clientHasCustomRange) {
      resetViewTabLabels();
      clientCountNode.textContent = 'Sin periodo seleccionado';
      clientsListNode.replaceChildren(text('p', 'Elige un periodo arriba y pulsa «Aplicar» para consultar los clientes.', 'muted'));
      if (clientPaginationNode) clientPaginationNode.hidden = true;
      return;
    }
    if (clientsLoading || clientsError) {
      clientCountNode.textContent = clientsLoading ? 'Consultando…' : 'No disponible';
      clientsTab.textContent = 'Clientes';
      clientsListNode.replaceChildren(text('p', clientsLoading ? 'Buscando clientes en Gmail…' : clientsError, 'muted'));
      clientPaginationNode.hidden = true;
      return;
    }
    const query = clientSearchNode.value.trim().toLowerCase();
    const filteredClients = clients.filter((client) => client.email.toLowerCase().includes(query));
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(filteredClients.length / pageSize));
    clientPage = Math.min(clientPage, totalPages);
    const pageClients = filteredClients.slice((clientPage - 1) * pageSize, clientPage * pageSize);
    clientsTab.textContent = `Clientes (${filteredClients.length})`;
    clientCountNode.textContent = query ? `${filteredClients.length} de ${clients.length} clientes` : `${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'}`;
    clientsListNode.replaceChildren();
    if (!filteredClients.length) {
      clientsListNode.append(text('p', query ? 'No hay clientes que coincidan con la búsqueda.' : 'No hay clientes detectados en este periodo.', 'muted'));
    } else {
      pageClients.forEach((client) => clientsListNode.append(makeMailboxClientCard(client)));
    }
    renderClientPagination(filteredClients);
  }

  async function loadClients(force = false) {
    if (!clientsListNode || !clientSearchNode) return;
    if (!hasAppliedRange && !clientHasCustomRange) {
      renderClients();
      return;
    }
    let dateRange;
    try {
      dateRange = clientHasCustomRange ? clientCustomRange : getDateRange();
    } catch (error) {
      clientStatusNode.textContent = error.message || 'Pulsa «Aplicar» para consultar este periodo.';
      clients = [];
      renderClients();
      return;
    }
    const rangeKey = [clientHasCustomRange ? 'custom' : dateModeNode.value, dateRange.from || '', dateRange.to || ''].join('|');
    if (clientsLoading && clientsPendingRangeKey === rangeKey) return;
    if (!force && clientsLoadedRangeKey === rangeKey) {
      renderClients();
      return;
    }
    const requestId = ++clientRequestId;
    clientsPendingRangeKey = rangeKey;
    clientsLoading = true;
    clientsError = '';
    clientPage = 1;
    clientStatusNode.textContent = 'Consultando clientes del periodo…';
    renderClients();
    try {
      const params = new URLSearchParams({ max: '1000' });
      if (dateRange.from) params.set('from', dateRange.from);
      if (dateRange.to) params.set('to', dateRange.to);
      const data = await fetchJson('/gmail/insights?' + params.toString());
      if (requestId !== clientRequestId) return;
      clients = data.insights?.clients || [];
      clientsLoadedRangeKey = rangeKey;
      setClientRangeSummary(data.analysisWindow);
      clientStatusNode.textContent = clientHasCustomRange
        ? 'Clientes detectados a partir del periodo personalizado.'
        : 'Clientes detectados a partir de los mensajes del periodo seleccionado.';
      if (data.insights?.truncated) clientStatusNode.textContent += ' Resultado parcial: la consulta está limitada. Acota el periodo para revisar más contactos.';
      renderClients();
    } catch (error) {
      if (requestId !== clientRequestId) return;
      clients = [];
      clientsError = error.message || 'No se pudieron cargar los clientes.';
      clientStatusNode.textContent = error.message || 'No se pudieron cargar los clientes.';
      renderClients();
      showErrorNotice(error, 'No se pudieron cargar los clientes.', 'No se pudieron cargar los clientes');
    } finally {
      if (requestId === clientRequestId) {
        clientsLoading = false;
        clientsPendingRangeKey = '';
        renderClients();
      }
    }
  }

  function setActiveView(view, options = {}) {
    activeView = view === 'clients' && mailboxNode.value !== 'trash' ? 'clients' : 'messages';
    const clientsActive = activeView === 'clients';
    messagesViewNode.hidden = clientsActive;
    clientsViewNode.hidden = !clientsActive;
    messagesTab.classList.toggle('is-active', !clientsActive);
    clientsTab.classList.toggle('is-active', clientsActive);
    messagesTab.setAttribute('aria-selected', String(!clientsActive));
    clientsTab.setAttribute('aria-selected', String(clientsActive));
    const url = new URL(window.location.href);
    if (clientsActive) url.searchParams.set('view', 'clients');
    else url.searchParams.delete('view');
    window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
    if (clientsActive && options.load !== false) loadClients();
  }

  function updateMailboxModeUi() {
    const isTrashMailbox = mailboxNode.value === 'trash';
    if (mailboxTitleNode) mailboxTitleNode.textContent = isTrashMailbox ? 'Papelera' : 'Mensajes de la bandeja';
    if (mailboxSubtitleNode) mailboxSubtitleNode.textContent = isTrashMailbox
      ? 'Revisa y recupera los correos eliminados de Gmail.'
      : 'Busca, revisa y gestiona tus correos de Gmail.';
    if (searchNode) searchNode.placeholder = mailboxNode.value === 'appArchived'
      ? 'Buscar en esta página…'
      : isTrashMailbox ? 'Buscar asunto, remitente o contenido…' : 'Buscar cliente, empresa o asunto…';
    if (composeButton) composeButton.hidden = isTrashMailbox;
    if (rangeInfoIntroNode) rangeInfoIntroNode.textContent = isTrashMailbox
      ? 'La papelera no consulta Gmail al entrar. Primero eliges qué periodo quieres revisar y pulsas «Aplicar».'
      : 'La bandeja no consulta Gmail al entrar. Primero eliges qué periodo quieres revisar y pulsas «Aplicar».';
    if (rangeInfoViewsNode) rangeInfoViewsNode.hidden = isTrashMailbox;
    if (rangeInfoClientPeriodNode) rangeInfoClientPeriodNode.hidden = isTrashMailbox;
  }

  function resetMessageView() {
    window.clearTimeout(messageSearchTimer);
    messageRequestId += 1;
    loadingMessages = false;
    messagesError = '';
    clientRequestId += 1;
    clientsLoading = false;
    clientsPendingRangeKey = '';
    clientsError = '';
    messages = [];
    nextPageToken = null;
    pageTokenHistory = [];
    currentPageIndex = 0;
    totalPageCount = null;
    resultsTruncated = false;
    paginationStatusNodes.forEach((node) => { node.textContent = ''; });
    render();
  }

  function showPendingRangeChange() {
    if (periodPromptNode) periodPromptNode.textContent = 'Hay cambios sin aplicar. Pulsa «Aplicar» para actualizar la bandeja.';
  }

  async function reloadMessages() {
    resetMessageView();
    await load();
  }

  const queryParams = new URLSearchParams(window.location.search);
  const requestedReply = queryParams.get('reply');
  let replyOpened = false;
  const requestedMailbox = queryParams.get('mailbox') || (requestedReply ? 'sent' : null);
  if (requestedMailbox && [...mailboxNode.options].some((option) => option.value === requestedMailbox)) {
    mailboxNode.value = requestedMailbox;
  }

  function clearUndo() {
    undoState = null;
    undoButton.disabled = false;
    undoNode.hidden = true;
    if (undoTimer) window.clearTimeout(undoTimer);
    undoTimer = null;
  }

  function showUndo(message, inverseAction, description) {
    undoState = { message, inverseAction };
    undoButton.disabled = false;
    undoMessageNode.textContent = description;
    undoNode.hidden = false;
    if (undoTimer) window.clearTimeout(undoTimer);
    undoTimer = window.setTimeout(clearUndo, 8000);
  }

  function openCompose(message = null) {
    // Responder desde Seguimientos puede llegar sin un periodo aplicado en la
    // bandeja. En ese caso el contenedor de Mensajes permanece oculto para no
    // consultar Gmail, pero el formulario de respuesta debe seguir siendo visible.
    if (messagesViewNode) messagesViewNode.hidden = false;
    if (clientsViewNode) clientsViewNode.hidden = true;
    composeForm.hidden = false;
    composeTitle.textContent = message ? 'Responder al correo' : 'Nuevo correo';
    const replyTarget = message?.labelIds?.includes('SENT') ? message.to : message?.from;
    composeTo.value = message ? (replyTarget?.match(/<([^>]+)>/)?.[1] || replyTarget?.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || '') : '';
    composeSubject.value = message ? (/^re:/i.test(message.subject) ? message.subject : 'Re: ' + message.subject) : '';
    composeBody.value = '';
    composeThreadId.value = message?.threadId || '';
    composeReplyToMessageId.value = message?.id || '';
    composeStatus.textContent = '';
    composePreview.hidden = true;
    confirmComposeButton.disabled = false;
    composeTo.focus();
  }

  function closeCompose() {
    composeForm.hidden = true;
    composeForm.reset();
    composeStatus.textContent = '';
    composePreview.hidden = true;
  }

  function showComposePreview() {
    if (!composeForm.reportValidity()) return false;
    previewTo.textContent = composeTo.value.trim();
    previewSubject.textContent = composeSubject.value.trim();
    previewBody.textContent = composeBody.value;
    composeStatus.textContent = '';
    composePreview.hidden = false;
    composePreview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return true;
  }

  async function sendComposeMessage() {
    if (!composeForm.reportValidity()) return;
    confirmComposeButton.disabled = true;
    editComposeButton.disabled = true;
    composeStatus.textContent = 'Enviando…';
    try {
      await fetchJson('/gmail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: composeTo.value,
          subject: composeSubject.value,
          body: composeBody.value,
          threadId: composeThreadId.value || undefined,
          replyToMessageId: composeReplyToMessageId.value || undefined,
        }),
      });
      composeStatus.textContent = 'Correo enviado correctamente.';
      composePreview.hidden = true;
      mailboxNode.value = 'sent';
      messages = [];
      nextPageToken = null;
      render();
      await load();
      window.setTimeout(closeCompose, 1200);
    } catch (error) {
      composeStatus.textContent = error.message || 'No se pudo enviar el correo.';
      confirmComposeButton.disabled = false;
      editComposeButton.disabled = false;
    }
  }

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

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo cargar la información.');
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('La consulta de Gmail ha tardado demasiado. Pulsa «Actualizar Gmail» para volver a intentarlo.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function render() {
    applyRangeButton.disabled = loadingMessages || syncing;
    applyRangeButton.textContent = loadingMessages || syncing ? 'Aplicando…' : 'Aplicar';
    updateMailboxModeUi();
    const isTrashMailbox = mailboxNode.value === 'trash';
    if (messageToolsNode) messageToolsNode.hidden = !hasAppliedRange;
    if (viewSwitchNode) viewSwitchNode.hidden = isTrashMailbox || !hasAppliedRange;
    if (syncStatusNode) syncStatusNode.hidden = !hasAppliedRange;
    if (refreshButton) {
      refreshButton.hidden = !hasAppliedRange;
      refreshButton.disabled = !hasAppliedRange || syncing;
    }
    if (!hasAppliedRange && !syncing) setSyncStatus('idle', 'Sin periodo seleccionado');
    if (messagesViewNode) messagesViewNode.hidden = !hasAppliedRange || (!isTrashMailbox && activeView === 'clients');
    if (clientsViewNode) clientsViewNode.hidden = isTrashMailbox || !hasAppliedRange || activeView !== 'clients';
    if (periodPromptNode) {
      periodPromptNode.hidden = hasAppliedRange;
      periodPromptNode.textContent = dateModeNode.value
        ? 'Hay cambios sin aplicar. Pulsa «Aplicar» para actualizar la bandeja.'
        : 'Elige un periodo arriba y pulsa «Aplicar» para consultar los mensajes.';
    }
    if (archivedNoticeNode) {
      if (mailboxNode.value === 'archived') {
        archivedNoticeNode.textContent = 'Esta vista incluye los correos que ya no están en Recibidos, también si se archivaron desde otra aplicación. Puedes usar «Desarchivar» para devolverlos a Recibidos.';
        archivedNoticeNode.hidden = false;
      } else if (mailboxNode.value === 'appArchived') {
        archivedNoticeNode.textContent = 'Esta vista solo incluye correos archivados desde Asistente Comercial. No guarda el contenido del mensaje, solo la acción realizada.';
        archivedNoticeNode.hidden = false;
      } else if (mailboxNode.value === 'trash') {
        archivedNoticeNode.textContent = 'Esta vista muestra los correos que Gmail ha enviado a la papelera. Pulsa «Restaurar» para devolver un correo a Recibidos. Gmail puede eliminarlos definitivamente después de un tiempo.';
        archivedNoticeNode.hidden = false;
      } else {
        archivedNoticeNode.hidden = true;
      }
    }
    if (!hasAppliedRange) {
      resetViewTabLabels();
      countNode.textContent = 'Sin periodo seleccionado';
      countNode.removeAttribute('aria-label');
      messagesNode.removeAttribute('aria-hidden');
      messagesNode.removeAttribute('aria-busy');
      messagesNode.removeAttribute('aria-label');
      messagesNode.replaceChildren();
      paginationStatusNodes.forEach((node) => { node.textContent = ''; });
      previousPageButtons.forEach((button) => { button.hidden = true; });
      nextPageButtons.forEach((button) => { button.hidden = true; });
      pageNumberContainers.forEach((container) => { container.replaceChildren(); });
      return;
    }
    messagesNode.removeAttribute('aria-hidden');
    messagesNode.removeAttribute('aria-busy');
    messagesNode.removeAttribute('aria-label');
    countNode.removeAttribute('aria-label');
    const query = searchNode.value.trim().toLowerCase();
    const filtered = messages.filter((message) => {
      const textToSearch = [message.subject, message.from, message.to, message.snippet].join(' ').toLowerCase();
      const matchesQuery = Boolean(serverSearchQuery) || !query || textToSearch.includes(query);
      return matchesQuery;
    });

    const currentPage = currentPageIndex + 1;
    messagesTab.textContent = loadingMessages ? 'Mensajes' : `Mensajes (${filtered.length})`;
    countNode.textContent = filtered.length + ' mensajes mostrados · página ' + currentPage;
    const knownPageCount = Math.max(
      currentPage,
      totalPageCount || 0,
      pageTokenHistory.length - 1 + (nextPageToken ? 1 : 0),
    );
    const visiblePageStart = Math.min(
      Math.max(currentPage - 2, 1),
      Math.max(1, knownPageCount - 4),
    );
    const visiblePageEnd = Math.min(knownPageCount, visiblePageStart + 4);
    pageNumberContainers.forEach((container) => {
      container.replaceChildren();
      for (let page = visiblePageStart; page <= visiblePageEnd; page += 1) {
        const pageButton = text('button', String(page), 'mailbox-page-number' + (page === currentPage ? ' is-current' : ''));
        pageButton.type = 'button';
        pageButton.dataset.mailboxPage = String(page);
        pageButton.setAttribute('aria-label', 'Ir a la página ' + page);
        pageButton.setAttribute('aria-current', page === currentPage ? 'page' : 'false');
        pageButton.disabled = loadingMessages || page === currentPage;
        container.append(pageButton);
      }
    });
    const paginationMessage = nextPageToken
      ? 'Hay más mensajes disponibles en este periodo.'
      : resultsTruncated && filtered.length > 0
        ? 'Hay demasiados resultados. Acota el periodo para verlos todos.'
        : '';
    paginationStatusNodes.forEach((node) => { node.textContent = paginationMessage; });
    previousPageButtons.forEach((button) => {
      button.hidden = currentPageIndex === 0;
      button.disabled = loadingMessages;
    });
    nextPageButtons.forEach((button) => {
      button.hidden = !nextPageToken;
      button.disabled = loadingMessages;
    });
    messagesNode.replaceChildren();
    if (messagesError) {
      countNode.textContent = 'No disponible';
      messagesNode.append(text('p', messagesError, 'muted'));
      return;
    }
    if (!filtered.length) {
      messagesNode.append(text('p', loadingMessages ? 'Buscando mensajes en Gmail…' : query ? 'No hay mensajes que coincidan.' : 'No hay mensajes en la bandeja.', 'muted'));
      return;
    }
    filtered.forEach((message) => {
      const article = document.createElement('article');
      article.className = 'message';
      const title = document.createElement('div');
      title.className = 'message-title';
      title.append(text('strong', message.subject));
      if (message.important) title.append(text('span', 'Importante', 'message-importance'));
      if (message.bounced) title.append(text('span', 'Rebotado', 'message-bounce'));
      article.append(title);
      article.append(text('small', message.from + ' · ' + (message.date || '')));
      article.append(text('p', message.snippet));
      const button = text('button', 'Ver hilo completo');
      button.className = 'thread-button';
      button.dataset.threadId = message.threadId || '';
      const actionBar = document.createElement('div');
      actionBar.className = 'message-action-bar';
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      const isArchivedMailbox = mailboxNode.value === 'archived' || mailboxNode.value === 'appArchived';
      const isTrashMailbox = mailboxNode.value === 'trash';
      const archiveButton = text('button', isTrashMailbox ? 'Restaurar' : isArchivedMailbox ? 'Desarchivar' : 'Archivar');
      archiveButton.className = 'message-action-archive';
      archiveButton.type = 'button';
      archiveButton.dataset.messageAction = isTrashMailbox ? 'restore' : isArchivedMailbox ? 'unarchive' : 'archive';
      archiveButton.dataset.messageId = message.id;
      const replyButton = text('button', 'Responder');
      replyButton.type = 'button';
      replyButton.dataset.replyMessageId = message.id;
      actions.append(archiveButton);
      if (!isTrashMailbox) {
        const trashButton = text('button', 'Papelera', 'danger message-action-trash');
        trashButton.type = 'button';
        trashButton.dataset.messageAction = 'trash';
        trashButton.dataset.messageId = message.id;
        actions.append(trashButton);
      }
      actions.append(replyButton);
      actionBar.append(button, text('span', '|', 'message-action-divider'), actions);
      article.append(actionBar);
      const actionStatus = document.createElement('p');
      actionStatus.className = 'message-action-status muted';
      actionStatus.setAttribute('aria-live', 'polite');
      article.append(actionStatus);
      const thread = document.createElement('div');
      thread.className = 'thread-inline';
      thread.hidden = true;
      article.append(thread);
      messagesNode.append(article);
    });
  }

  async function load() {
    const requestId = ++messageRequestId;
    loadingMessages = true;
    messagesError = '';
    applyRangeButton.disabled = true;
    applyRangeButton.textContent = 'Aplicando…';
    render();
    try {
      const dateRange = getDateRange();
      setSyncWindow(dateRange.from, dateRange.to || formatDateInput(new Date()));
      saveMailboxRange(dateRange);
      const maxResults = 10;
      const pageToken = pageTokenHistory[currentPageIndex] || null;
      const messageParams = new URLSearchParams({ max: String(maxResults), mailbox: mailboxNode.value });
      if (pageToken) messageParams.set('pageToken', pageToken);
      if (mailboxNode.value === 'sent' || mailboxNode.value === 'trash') messageParams.set('refresh', '1');
      if (dateRange.from) messageParams.set('from', dateRange.from);
      if (dateRange.to) messageParams.set('to', dateRange.to);
      if (serverSearchQuery) messageParams.set('search', serverSearchQuery);
      const messageResult = await fetchJson('/gmail/messages?' + messageParams.toString());
      if (requestId !== messageRequestId) return;
      messages = messageResult.messages || [];
      nextPageToken = messageResult.nextPageToken || null;
      if (Array.isArray(messageResult.pageTokens)) pageTokenHistory = messageResult.pageTokens;
      else pageTokenHistory[currentPageIndex + 1] = nextPageToken;
      totalPageCount = Number.isInteger(messageResult.pageCount) ? messageResult.pageCount : null;
      resultsTruncated = Boolean(messageResult.truncated);
      const navMessageCount = document.querySelector('#navMessageCount');
      if (navMessageCount) { navMessageCount.textContent = String(messages.length); navMessageCount.hidden = false; }
      if (!syncing) setSyncStatus('success', 'Bandeja cargada');
      render();
      if (activeView === 'clients') await loadClients();
      await openRequestedReply();
      return true;
    } catch (error) {
      if (requestId !== messageRequestId) return;
      messagesError = error.message || 'No se pudieron cargar los mensajes.';
      setSyncStatus('error', 'No se pudo cargar la bandeja');
      messagesNode.removeAttribute('aria-hidden');
      messagesNode.removeAttribute('aria-busy');
      messagesNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      messagesNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los mensajes.', 'muted'));
      paginationStatusNodes.forEach((node) => { node.textContent = ''; });
      showErrorNotice(error, 'No se pudieron cargar los mensajes.', 'No se pudo cargar la bandeja');
    } finally {
      // A failed or interrupted request must never leave pagination locked.
      if (requestId === messageRequestId && !syncing) {
        loadingMessages = false;
        applyRangeButton.disabled = false;
        applyRangeButton.textContent = 'Aplicar';
        render();
      }
    }
  }

  async function openRequestedReply() {
    if (!requestedReply || replyOpened) return;
    try {
      const result = await fetchJson('/gmail/messages/' + encodeURIComponent(requestedReply));
      if (!result.message) throw new Error('No se encontró el mensaje al que quieres responder.');
      replyOpened = true;
      openCompose(result.message);
      window.history.replaceState({}, '', '/mailbox');
    } catch (error) {
      showErrorNotice(error, 'No se pudo cargar el mensaje para responder.', 'No se pudo abrir la respuesta');
    }
  }

  function formatSyncDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function formatSyncWindowDate(value) {
    if (!value) return '';
    const date = new Date(`${String(value).replaceAll('/', '-')}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function setSyncWindow(from, to) {
    if (!syncWindowNode) return;
    const start = formatSyncWindowDate(from);
    const end = formatSyncWindowDate(to);
    syncWindowNode.textContent = start && end
      ? `${dateModeNode.value === 'this-month' ? 'Este mes' : dateModeNode.value === 'day' ? 'Día concreto' : 'Periodo'}: ${start} – ${end}`
      : '';
    syncWindowNode.hidden = false;
  }

  function setSyncStatus(state, message, syncedAt = null) {
    syncStatusNode.dataset.syncState = state;
    syncStatusNode.textContent = message;
    syncStatusNode.title = syncedAt ? `Última sincronización: ${new Date(syncedAt).toLocaleString('es-ES')}` : message;
  }

  async function syncMailbox(showErrors = true) {
    if (syncing || !hasAppliedRange) return;
    const requestId = messageRequestId;
    syncing = true;
    refreshButton.disabled = true;
    refreshButton.textContent = 'Actualizando…';
    setSyncStatus('syncing', 'Actualizando Gmail…');
    try {
      const result = await fetchJson('/gmail/sync', { method: 'POST' });
      if (requestId !== messageRequestId || !hasAppliedRange) return;
      messages = [];
      nextPageToken = null;
      render();
      if (!await load()) return;
      setSyncStatus('success', 'Actualizado el ' + formatSyncDate(result.syncedAt), result.syncedAt);
    } catch (error) {
      setSyncStatus('error', showErrors ? (error.message || 'No se pudo actualizar Gmail.') : 'No se pudo actualizar Gmail. Pulsa «Actualizar Gmail».');
      showErrorNotice(error, 'No se pudo actualizar Gmail.', 'No se pudo actualizar Gmail');
    } finally {
      // Gmail synchronization is independent from the page currently visible.
      // It must not leave the pagination controls disabled.
      loadingMessages = false;
      syncing = false;
      refreshButton.disabled = false;
      refreshButton.textContent = 'Actualizar Gmail';
      render();
    }
  }

  messagesNode.addEventListener('click', async (event) => {
    const replyButton = event.target.closest('[data-reply-message-id]');
    if (replyButton) {
      const message = messages.find((item) => item.id === replyButton.dataset.replyMessageId);
      if (message) openCompose(message);
      return;
    }
    const actionButton = event.target.closest('[data-message-action]');
    if (actionButton) {
      const action = actionButton.dataset.messageAction;
      const article = actionButton.closest('.message');
      const status = article?.querySelector('.message-action-status');
      if (!action || !article || !status) return;
      if (action === 'trash' && !window.confirm('¿Enviar este correo a la papelera?')) return;
      clearUndo();
      const buttons = article.querySelectorAll('[data-message-action]');
      buttons.forEach((button) => { button.disabled = true; });
      status.textContent = 'Aplicando…';
      try {
        const result = await fetchJson('/gmail/messages/' + encodeURIComponent(actionButton.dataset.messageId || ''), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const target = messages.find((message) => message.id === actionButton.dataset.messageId);
        if (result.action === 'trash' || (result.action === 'restore' && mailboxNode.value === 'trash') || (result.action === 'archive' && mailboxNode.value === 'inbox') || (result.action === 'unarchive' && (mailboxNode.value === 'archived' || mailboxNode.value === 'appArchived'))) {
          messages = messages.filter((message) => message.id !== actionButton.dataset.messageId);
          if (result.action === 'trash' && target) {
            showUndo({ ...target, labelIds: [...(target.labelIds || [])] }, 'restore', 'Correo enviado a la papelera.');
          }
          if (result.action === 'restore' && target) {
            showUndo({ ...target, labelIds: [...(target.labelIds || [])] }, 'trash', 'Correo restaurado en Recibidos.');
          }
          if (result.action === 'archive' && target) {
            showUndo({ ...target, labelIds: [...(target.labelIds || [])] }, 'unarchive', 'Correo archivado.');
          }
          if (result.action === 'unarchive' && target) {
            showUndo({ ...target, labelIds: [...(target.labelIds || [])] }, 'archive', 'Correo desarchivado.');
          }
        } else if (result.action === 'archive') {
          if (target) showUndo({ ...target, labelIds: [...(target.labelIds || [])] }, 'unarchive', 'Correo archivado.');
        } else if (result.action === 'markRead' || result.action === 'markUnread') {
          if (target) {
            target.labelIds = target.labelIds || [];
            target.labelIds = result.action === 'markRead'
              ? target.labelIds.filter((label) => label !== 'UNREAD')
              : [...new Set([...target.labelIds, 'UNREAD'])];
            showUndo({ ...target, labelIds: [...target.labelIds] }, result.action === 'markRead' ? 'markUnread' : 'markRead', result.action === 'markRead' ? 'Correo marcado como leído.' : 'Correo marcado como no leído.');
          }
        }
        render();
      } catch (error) {
        status.textContent = error.message || 'No se pudo aplicar la acción.';
        buttons.forEach((button) => { button.disabled = false; });
        showErrorNotice(error, 'No se pudo aplicar la acción.', 'No se pudo actualizar el correo');
      }
      return;
    }
    const button = event.target.closest('[data-thread-id]');
    if (!button) return;
    const article = button.closest('.message');
    const thread = article?.querySelector('.thread-inline');
    if (!article || !thread) return;
    if (!thread.hidden) {
      thread.hidden = true;
      article.classList.remove('is-open');
      button.textContent = 'Ver hilo completo';
      return;
    }
    messagesNode.querySelectorAll('.thread-inline:not([hidden])').forEach((openThread) => {
      openThread.hidden = true;
      openThread.closest('.message')?.classList.remove('is-open');
      const openButton = openThread.closest('.message')?.querySelector('.thread-button');
      if (openButton) openButton.textContent = 'Ver hilo completo';
    });
    article.classList.add('is-open');
    thread.hidden = false;
    thread.replaceChildren(text('p', 'Cargando hilo…', 'muted'));
    button.textContent = 'Cerrar hilo';
    try {
      const result = await fetchJson('/gmail/threads/' + encodeURIComponent(button.dataset.threadId));
      thread.replaceChildren();
      result.messages.forEach((message) => {
        const item = document.createElement('article');
        item.className = 'message';
        item.append(text('strong', message.subject));
        item.append(text('small', message.from + (message.to ? ' → ' + message.to : '') + ' · ' + (message.date || '')));
        item.append(text('p', window.cleanEmailBody(message.body)));
        thread.append(item);
      });
    } catch (error) {
      thread.replaceChildren(text('p', error.message || 'No se pudo cargar el hilo.', 'muted'));
      showErrorNotice(error, 'No se pudo cargar el hilo.', 'No se pudo cargar el hilo');
    }
  });

  undoButton.addEventListener('click', async () => {
    if (!undoState) return;
    const currentUndo = undoState;
    undoButton.disabled = true;
    undoMessageNode.textContent = 'Deshaciendo…';
    try {
      await fetchJson('/gmail/messages/' + encodeURIComponent(currentUndo.message.id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: currentUndo.inverseAction }),
      });
      const restored = { ...currentUndo.message, labelIds: [...(currentUndo.message.labelIds || [])] };
      if (currentUndo.inverseAction === 'restore') {
        restored.labelIds = [...new Set([...restored.labelIds.filter((label) => label !== 'TRASH'), 'INBOX'])];
        if (mailboxNode.value === 'inbox' && !messages.some((message) => message.id === restored.id)) messages = [restored, ...messages];
      } else if (currentUndo.inverseAction === 'trash') {
        restored.labelIds = [...new Set([...restored.labelIds.filter((label) => label !== 'INBOX'), 'TRASH'])];
        if (mailboxNode.value === 'trash' && !messages.some((message) => message.id === restored.id)) messages = [restored, ...messages];
      } else if (currentUndo.inverseAction === 'unarchive') {
        restored.labelIds = [...new Set([...restored.labelIds, 'INBOX'])];
        if (mailboxNode.value === 'inbox' && !messages.some((message) => message.id === restored.id)) messages = [restored, ...messages];
      } else if (currentUndo.inverseAction === 'archive') {
        restored.labelIds = restored.labelIds.filter((label) => label !== 'INBOX');
        if ((mailboxNode.value === 'archived' || mailboxNode.value === 'appArchived') && !messages.some((message) => message.id === restored.id)) messages = [restored, ...messages];
      } else if (currentUndo.inverseAction === 'markRead') {
        restored.labelIds = restored.labelIds.filter((label) => label !== 'UNREAD');
        const target = messages.find((message) => message.id === restored.id);
        if (target) target.labelIds = restored.labelIds;
      } else if (currentUndo.inverseAction === 'markUnread') {
        restored.labelIds = [...new Set([...restored.labelIds, 'UNREAD'])];
        const target = messages.find((message) => message.id === restored.id);
        if (target) target.labelIds = restored.labelIds;
      }
      clearUndo();
      render();
    } catch (error) {
      undoMessageNode.textContent = error.message || 'No se pudo deshacer la acción.';
      undoButton.disabled = false;
      showErrorNotice(error, 'No se pudo deshacer la acción.', 'No se pudo deshacer la acción');
    }
  });

  function messageSearchQuery() {
    if (mailboxNode.value === 'appArchived') return '';
    const query = searchNode.value.trim();
    return /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(query) ? `{from:${query} to:${query}}` : query;
  }
  searchNode.addEventListener('input', () => {
    window.clearTimeout(messageSearchTimer);
    if (!hasAppliedRange) return;
    if (mailboxNode.value === 'appArchived') { serverSearchQuery = ''; render(); return; }
    messageSearchTimer = window.setTimeout(() => {
      if (!hasAppliedRange) return;
      serverSearchQuery = messageSearchQuery();
      reloadMessages();
    }, 400);
  });
  clientSearchNode.addEventListener('input', () => {
    clientPage = 1;
    renderClients();
  });
  clientCustomPeriodButton.addEventListener('click', () => {
    clientRangeEditing = true;
    clientDateModeNode.value = '';
    clientExactDateNode.value = '';
    clientDateFromNode.value = '';
    clientDateToNode.value = '';
    updateClientDateFields();
    clientStatusNode.textContent = 'Elige un periodo propio y pulsa «Aplicar periodo de clientes».';
    renderClients();
  });
  clientResetPeriodButton.addEventListener('click', async () => {
    clientHasCustomRange = false;
    clientCustomRange = null;
    clientRangeEditing = false;
    clientDateModeNode.value = '';
    clientExactDateNode.value = '';
    clientDateFromNode.value = '';
    clientDateToNode.value = '';
    clientsLoadedRangeKey = '';
    clients = [];
    updateClientDateFields();
    clientRangeSummaryNode.textContent = 'Usa el periodo seleccionado arriba.';
    renderClients();
    if (hasAppliedRange && activeView === 'clients') await loadClients(true);
  });
  clientDateModeNode.addEventListener('change', updateClientDateFields);
  clientRangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      clientCustomRange = getClientDateRange();
      clientHasCustomRange = true;
      clientRangeEditing = false;
      clientsLoadedRangeKey = '';
      clientPage = 1;
      await loadClients(true);
    } catch (error) {
      clientStatusNode.textContent = error.message || 'Revisa el periodo de clientes seleccionado.';
      showErrorNotice(error, 'Revisa las fechas de clientes.', 'No se puede aplicar el periodo de clientes');
    }
  });
  messagesTab.addEventListener('click', () => setActiveView('messages'));
  clientsTab.addEventListener('click', () => setActiveView('clients'));
  clientPageNumbersNode.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mailbox-client-page]');
    if (!button || clientsLoading) return;
    clientPage = Number(button.dataset.mailboxClientPage);
    renderClients();
  });
  clientPreviousButton.addEventListener('click', () => {
    if (clientsLoading || clientPage <= 1) return;
    clientPage -= 1;
    renderClients();
  });
  clientNextButton.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(clients.filter((client) => client.email.toLowerCase().includes(clientSearchNode.value.trim().toLowerCase())).length / 10));
    if (clientsLoading || clientPage >= totalPages) return;
    clientPage += 1;
    renderClients();
  });
  dateModeNode.addEventListener('change', async () => {
    updateDateFields();
    hasAppliedRange = false;
    clientsLoadedRangeKey = '';
    clients = [];
    if (!dateModeNode.value) {
      resetMessageView();
      renderClients();
      return;
    }
    resetMessageView();
    renderClients();
    showPendingRangeChange();
  });
  [exactDateNode, dateFromNode, dateToNode].forEach((node) => node.addEventListener('change', () => {
    if (dateModeNode.value === 'day' || dateModeNode.value === 'range') {
      hasAppliedRange = false;
      clientsLoadedRangeKey = '';
      clients = [];
      resetMessageView();
      renderClients();
      showPendingRangeChange();
    }
  }));
  rangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const dateRange = getDateRange();
      hasAppliedRange = true;
      serverSearchQuery = messageSearchQuery();
      saveMailboxRange(dateRange);
      await reloadMessages();
    } catch (error) {
      paginationStatusNodes.forEach((node) => { node.textContent = error.message || 'Revisa las fechas seleccionadas.'; });
      showErrorNotice(error, 'Revisa las fechas seleccionadas.', 'No se puede aplicar el periodo');
    }
  });
  clearRangeButton.addEventListener('click', async () => {
    dateModeNode.value = '';
    exactDateNode.value = '';
    dateFromNode.value = '';
    dateToNode.value = '';
    hasAppliedRange = false;
    serverSearchQuery = '';
    searchNode.value = '';
    window.clearTimeout(messageSearchTimer);
    clientsLoadedRangeKey = '';
    clients = [];
    updateDateFields();
    resetMessageView();
    renderClients();
  });
  function closeRangeInfo() {
    rangeInfoModal.hidden = true;
    document.documentElement.classList.remove('message-range-info-open');
  }
  rangeInfoButton.addEventListener('click', () => {
    rangeInfoModal.hidden = false;
    document.documentElement.classList.add('message-range-info-open');
    rangeInfoClose.focus();
  });
  rangeInfoClose.addEventListener('click', closeRangeInfo);
  rangeInfoModal.addEventListener('click', (event) => {
    if (event.target === rangeInfoModal) closeRangeInfo();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !rangeInfoModal.hidden) closeRangeInfo();
  });
  composeButton.addEventListener('click', () => openCompose());
  cancelComposeButton.addEventListener('click', closeCompose);
  refreshButton.addEventListener('click', () => syncMailbox(true));
  nextPageButtons.forEach((button) => button.addEventListener('click', async () => {
    if (loadingMessages || !nextPageToken) return;
    currentPageIndex += 1;
    messages = [];
    nextPageToken = null;
    render();
    await load();
  }));
  pageNumberContainers.forEach((container) => container.addEventListener('click', async (event) => {
    const pageButton = event.target.closest('[data-mailbox-page]');
    if (!pageButton || loadingMessages) return;
    const requestedPage = Number(pageButton.dataset.mailboxPage);
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage === currentPageIndex + 1) return;
    if (requestedPage > 1 && !pageTokenHistory[requestedPage - 1]) return;
    currentPageIndex = requestedPage - 1;
    messages = [];
    nextPageToken = null;
    render();
    await load();
  }));
  previousPageButtons.forEach((button) => button.addEventListener('click', async () => {
    if (loadingMessages || currentPageIndex === 0) return;
    currentPageIndex -= 1;
    messages = [];
    nextPageToken = null;
    render();
    await load();
  }));
  composeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    showComposePreview();
  });
  editComposeButton.addEventListener('click', () => { composePreview.hidden = true; composeStatus.textContent = ''; composeBody.focus(); });
  confirmComposeButton.addEventListener('click', sendComposeMessage);
  mailboxNode.addEventListener('change', () => {
    serverSearchQuery = messageSearchQuery();
    if (mailboxNode.value === 'trash' && activeView !== 'messages') setActiveView('messages', { load: false });
    if (hasAppliedRange) reloadMessages();
    else resetMessageView();
  });
  setActiveView(activeView, { load: false });
  updateDateFields();
  updateClientDateFields();
  resetMessageView();
  renderClients();
  if (requestedReply) openRequestedReply();
  syncTimer = window.setInterval(() => {
    if (hasAppliedRange) syncMailbox(false);
  }, syncIntervalMs);
})();
