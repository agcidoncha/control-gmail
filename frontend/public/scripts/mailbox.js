(() => {
  const messagesNode = document.querySelector('#messages');
  const mailboxNode = document.querySelector('#messageMailbox');
  const searchNode = document.querySelector('#messageSearch');
  const countNode = document.querySelector('#mailboxCount');
  const syncStatusNode = document.querySelector('#mailboxSyncStatus');
  const refreshButton = document.querySelector('#mailboxRefreshButton');
  const paginationStatusNodes = [...document.querySelectorAll('[data-mailbox-pagination-status]')];
  const pageNumberContainers = [...document.querySelectorAll('[data-mailbox-page-numbers]')];
  const rangeForm = document.querySelector('#messageRangeForm');
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
  const filterButtons = [...document.querySelectorAll('[data-message-filter]')];
  let messages = [];
  let followUps = [];
  let commitments = [];
  let filter = 'all';
  let nextPageToken = null;
  let pageTokenHistory = [];
  let currentPageIndex = 0;
  let totalPageCount = null;
  let resultsTruncated = false;
  let loadingMessages = false;
  let undoState = null;
  let undoTimer = null;
  let syncing = false;
  let syncTimer = null;
  const syncIntervalMs = 10 * 60 * 1000;

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getPresetDateRange(mode) {
    const today = new Date();
    const to = formatDateInput(today);
    return { from: formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  }

  function getDateRange() {
    const mode = dateModeNode.value;
    if (mode === 'this-month') return getPresetDateRange(mode);
    if (mode === 'day') {
      if (!exactDateNode.value) throw new Error('Selecciona el día que quieres consultar.');
      return { from: exactDateNode.value, to: exactDateNode.value };
    }
    if (!dateFromNode.value && !dateToNode.value) throw new Error('Indica al menos una fecha para buscar el periodo.');
    if (dateFromNode.value && dateToNode.value && dateFromNode.value > dateToNode.value) {
      throw new Error('La fecha «Desde» no puede ser posterior a «Hasta».');
    }
    return { from: dateFromNode.value, to: dateToNode.value };
  }

  function updateDateFields() {
    const mode = dateModeNode.value;
    pageSizeField.hidden = false;
    exactDateField.hidden = mode !== 'day';
    dateRangeFields.hidden = mode !== 'range';
    applyRangeButton.hidden = mode !== 'day' && mode !== 'range';
    clearRangeButton.hidden = mode === 'this-month';
  }

  function resetMessageView() {
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
    paginationStatusNodes.forEach((node) => { node.textContent = 'Hay cambios sin aplicar. Pulsa «Aplicar» para actualizar la bandeja.'; });
  }

  async function reloadMessages() {
    loadingMessages = true;
    resetMessageView();
    paginationStatusNodes.forEach((node) => { node.textContent = 'Buscando mensajes en Gmail…'; });
    render();
    applyRangeButton.disabled = true;
    applyRangeButton.textContent = 'Aplicando…';
    try {
      await load();
    } finally {
      loadingMessages = false;
      applyRangeButton.disabled = false;
      applyRangeButton.textContent = 'Aplicar';
      render();
    }
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
    if (archivedNoticeNode) {
      if (mailboxNode.value === 'archived') {
        archivedNoticeNode.textContent = 'Esta vista incluye cualquier correo archivado en Gmail, también si se archivó desde otra aplicación. Puedes usar «Desarchivar» para devolverlo a Recibidos.';
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
    messagesNode.removeAttribute('aria-hidden');
    messagesNode.removeAttribute('aria-busy');
    messagesNode.removeAttribute('aria-label');
    countNode.removeAttribute('aria-label');
    const query = searchNode.value.trim().toLowerCase();
    const followUpThreads = new Set(followUps.map((item) => item.threadId));
    const commitmentThreads = new Set(commitments.map((item) => item.threadId));
    const filtered = messages.filter((message) => {
      const textToSearch = [message.subject, message.from, message.snippet].join(' ').toLowerCase();
      const matchesQuery = !query || textToSearch.includes(query);
      const matchesFilter = filter === 'all'
        || (filter === 'follow-ups' && followUpThreads.has(message.threadId))
        || (filter === 'commitments' && commitmentThreads.has(message.threadId))
        || (filter === 'important' && message.important === true)
        || (filter === 'bounced' && message.bounced === true)
        || (filter === 'attention' && (followUpThreads.has(message.threadId) || commitmentThreads.has(message.threadId)));
      return matchesQuery && matchesFilter;
    });

    const hasDateFilter = true;
    const currentPage = currentPageIndex + 1;
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
      : resultsTruncated
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
      const readButton = text('button', message.labelIds?.includes('UNREAD') ? 'Marcar leído' : 'Marcar no leído');
      readButton.className = 'message-action-unread';
      readButton.type = 'button';
      readButton.dataset.messageAction = message.labelIds?.includes('UNREAD') ? 'markRead' : 'markUnread';
      readButton.dataset.messageId = message.id;
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
      actions.append(readButton, archiveButton);
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

  async function load(forceFetch = false) {
    try {
      const dateRange = getDateRange();
      const hasDateFilter = Boolean(dateRange.from || dateRange.to);
      const maxResults = 10;
      const pageToken = pageTokenHistory[currentPageIndex] || null;
      const shared = !forceFetch && currentPageIndex === 0 && !hasDateFilter && maxResults === 10 && mailboxNode.value === 'inbox' && window.__commercialNavDataPromise
        ? await window.__commercialNavDataPromise
        : null;
      const messageParams = new URLSearchParams({ max: String(maxResults), mailbox: mailboxNode.value });
      if (pageToken) messageParams.set('pageToken', pageToken);
      if (mailboxNode.value === 'sent' || mailboxNode.value === 'trash') messageParams.set('refresh', '1');
      if (dateRange.from) messageParams.set('from', dateRange.from);
      if (dateRange.to) messageParams.set('to', dateRange.to);
      const messageResult = shared?.messages?.messages
        ? shared.messages
        : await fetchJson('/gmail/messages?' + messageParams.toString());
      const followUpResult = shared?.followUps;
      const commitmentResult = shared?.commitments;
      if (!messageResult) {
        throw new Error(shared?.errors?.messages || 'No se pudieron cargar los mensajes de la bandeja.');
      }
      messages = messageResult.messages || [];
      nextPageToken = messageResult.nextPageToken || null;
      if (Array.isArray(messageResult.pageTokens)) pageTokenHistory = messageResult.pageTokens;
      else pageTokenHistory[currentPageIndex + 1] = nextPageToken;
      totalPageCount = Number.isInteger(messageResult.pageCount) ? messageResult.pageCount : null;
      resultsTruncated = Boolean(messageResult.truncated);
      if (followUpResult) followUps = followUpResult.followUps || [];
      if (commitmentResult) commitments = commitmentResult.commitments || [];
      const navMessageCount = document.querySelector('#navMessageCount');
      if (navMessageCount) { navMessageCount.textContent = String(messages.length); navMessageCount.hidden = false; }
      const navFollowUpCount = document.querySelector('#navFollowUpCount');
      if (navFollowUpCount && followUpResult) { navFollowUpCount.textContent = String(followUps.length); navFollowUpCount.hidden = false; }
      const navCommitmentCount = document.querySelector('#navCommitmentCount');
      if (navCommitmentCount && commitmentResult) { navCommitmentCount.textContent = String(commitments.length); navCommitmentCount.hidden = false; }
      if (!syncing) setSyncStatus('success', 'Bandeja cargada');
      render();
      if (requestedReply && !replyOpened) {
        const replyMessage = messages.find((message) => message.id === requestedReply);
        if (replyMessage) {
          replyOpened = true;
          openCompose(replyMessage);
          window.history.replaceState({}, '', '/mailbox');
        }
      }
    } catch (error) {
      messagesNode.removeAttribute('aria-hidden');
      messagesNode.removeAttribute('aria-busy');
      messagesNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      messagesNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los mensajes.', 'muted'));
      paginationStatusNodes.forEach((node) => { node.textContent = ''; });
      showErrorNotice(error, 'No se pudieron cargar los mensajes.', 'No se pudo cargar la bandeja');
    } finally {
      // A failed or interrupted request must never leave pagination locked.
      if (!syncing) {
        loadingMessages = false;
        render();
      }
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
      ? `Este mes: ${start} – ${end}`
      : 'Este mes: no disponible';
  }

  function setSyncStatus(state, message, syncedAt = null) {
    syncStatusNode.dataset.syncState = state;
    syncStatusNode.textContent = message;
    syncStatusNode.title = syncedAt ? `Última sincronización: ${new Date(syncedAt).toLocaleString('es-ES')}` : message;
  }

  async function syncMailbox(showErrors = true) {
    if (syncing) return;
    syncing = true;
    refreshButton.disabled = true;
    refreshButton.textContent = 'Actualizando…';
    setSyncStatus('syncing', 'Actualizando Gmail…');
    try {
      const result = await fetchJson('/gmail/sync', { method: 'POST' });
      messages = [];
      nextPageToken = null;
      render();
      await load(true);
      setSyncWindow(result.from, result.to);
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

  searchNode.addEventListener('input', render);
  filterButtons.forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.messageFilter || 'all';
    filterButtons.forEach((item) => item.classList.toggle('active', item === button));
    render();
  }));
  dateModeNode.addEventListener('change', async () => {
    updateDateFields();
    if (dateModeNode.value === 'this-month') {
      exactDateNode.value = '';
      dateFromNode.value = '';
      dateToNode.value = '';
      await reloadMessages();
      return;
    }
    showPendingRangeChange();
  });
  [exactDateNode, dateFromNode, dateToNode].forEach((node) => node.addEventListener('change', () => {
    if (dateModeNode.value === 'day' || dateModeNode.value === 'range') showPendingRangeChange();
  }));
  rangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      getDateRange();
      await reloadMessages();
    } catch (error) {
      paginationStatusNodes.forEach((node) => { node.textContent = error.message || 'Revisa las fechas seleccionadas.'; });
      showErrorNotice(error, 'Revisa las fechas seleccionadas.', 'No se puede aplicar el periodo');
    }
  });
  clearRangeButton.addEventListener('click', async () => {
    dateModeNode.value = 'this-month';
    exactDateNode.value = '';
    dateFromNode.value = '';
    dateToNode.value = '';
    updateDateFields();
    await reloadMessages();
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
  mailboxNode.addEventListener('change', reloadMessages);
  updateDateFields();
  load();
  syncTimer = window.setInterval(() => syncMailbox(false), syncIntervalMs);
})();
