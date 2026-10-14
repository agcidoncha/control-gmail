(() => {
  const listNode = document.querySelector('#followUps');
  const countNode = document.querySelector('#followUpCount');
  const searchNode = document.querySelector('#followUpSearch');
  const categoryNode = document.querySelector('#followUpCategory');
  const categoryInfoButton = document.querySelector('#followUpCategoryInfoButton');
  const categoryInfoModal = document.querySelector('#followUpCategoryInfoModal');
  const categoryInfoClose = document.querySelector('#followUpCategoryInfoClose');
  const rangeForm = document.querySelector('#followUpRangeForm');
  const dateModeNode = document.querySelector('#followUpDateMode');
  const exactDateField = document.querySelector('#followUpExactDateField');
  const exactDateNode = document.querySelector('#followUpExactDate');
  const dateRangeFields = document.querySelector('#followUpDateRangeFields');
  const dateFromNode = document.querySelector('#followUpDateFrom');
  const dateToNode = document.querySelector('#followUpDateTo');
  const rangeSummaryNode = document.querySelector('#followUpRangeSummary');
  const applyRangeButton = document.querySelector('#applyFollowUpRange');
  const clearRangeButton = document.querySelector('#clearFollowUpRange');
  const paginationContainers = [...document.querySelectorAll('[data-follow-up-pagination-container]')];
  const paginationStatusNodes = [...document.querySelectorAll('[data-follow-up-pagination-status]')];
  const pageNumberContainers = [...document.querySelectorAll('[data-follow-up-page-numbers]')];
  const previousPageButtons = [...document.querySelectorAll('[data-follow-up-pagination="previous"]')];
  const nextPageButtons = [...document.querySelectorAll('[data-follow-up-pagination="next"]')];
  if (!listNode || !countNode || !searchNode || !categoryNode || !rangeForm || !dateModeNode || !exactDateField || !exactDateNode || !dateRangeFields || !dateFromNode || !dateToNode || !rangeSummaryNode || !applyRangeButton || !clearRangeButton) return;

  let items = [];
  let total = 0;
  let currentPage = 1;
  let pageCount = 1;
  let summary = { total: 0 };
  let loading = false;

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

  function getPresetDateRange() {
    const today = new Date();
    return {
      from: formatDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: formatDateInput(today),
    };
  }

  function getDateRange() {
    if (dateModeNode.value === 'this-month') return getPresetDateRange();
    if (dateModeNode.value === 'day') {
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
    exactDateField.hidden = mode !== 'day';
    dateRangeFields.hidden = mode !== 'range';
    applyRangeButton.hidden = mode !== 'day' && mode !== 'range';
    clearRangeButton.hidden = mode === 'this-month';
  }

  function setRangeSummary(analysisWindow) {
    if (!analysisWindow) return;
    const from = formatWindowDate(analysisWindow.from);
    const to = formatWindowDate(analysisWindow.to);
    const prefix = dateModeNode.value === 'this-month' ? 'Este mes' : dateModeNode.value === 'day' ? 'Día concreto' : 'Periodo';
    rangeSummaryNode.textContent = `${prefix}: ${from} – ${to}`;
  }

  function renderLoadingState() {
    listNode.removeAttribute('aria-hidden');
    listNode.setAttribute('aria-busy', 'true');
    listNode.setAttribute('aria-label', 'Consultando seguimientos');
    listNode.replaceChildren(text('p', 'Consultando los seguimientos…', 'muted'));
  }

  function renderPagination() {
    const showPagination = loading || pageCount > 1;
    paginationContainers.forEach((container) => { container.hidden = !showPagination; });
    const visiblePageStart = Math.min(Math.max(currentPage - 2, 1), Math.max(1, pageCount - 4));
    const visiblePageEnd = Math.min(pageCount, visiblePageStart + 4);
    pageNumberContainers.forEach((container) => {
      container.replaceChildren();
      for (let page = visiblePageStart; page <= visiblePageEnd; page += 1) {
        const pageButton = text('button', String(page), 'follow-up-page-number' + (page === currentPage ? ' is-current' : ''));
        pageButton.type = 'button';
        pageButton.dataset.followUpPage = String(page);
        pageButton.setAttribute('aria-label', 'Ir a la página ' + page);
        pageButton.setAttribute('aria-current', page === currentPage ? 'page' : 'false');
        pageButton.disabled = loading || page === currentPage;
        container.append(pageButton);
      }
    });
    previousPageButtons.forEach((button) => {
      button.hidden = currentPage <= 1;
      button.disabled = loading;
    });
    nextPageButtons.forEach((button) => {
      button.hidden = currentPage >= pageCount;
      button.disabled = loading;
    });
    const paginationMessage = pageCount > 1 ? `Página ${currentPage} de ${pageCount} · ${total} seguimientos en el periodo.` : '';
    paginationStatusNodes.forEach((node, index) => { node.textContent = index === 0 ? paginationMessage : ''; });
  }

  function urgencyFor(ageDays) {
    if (ageDays >= 15) return ['urgent', 'Urgente'];
    if (ageDays >= 10) return ['priority', 'Prioritario'];
    if (ageDays >= 5) return ['attention', 'Atención'];
    return ['normal', 'Reciente'];
  }

  function render() {
    listNode.removeAttribute('aria-hidden');
    listNode.removeAttribute('aria-busy');
    listNode.removeAttribute('aria-label');
    countNode.removeAttribute('aria-label');
    const query = searchNode.value.trim().toLowerCase();
    const visible = items.filter((item) => {
      const haystack = [item.client, item.subject, item.reason].join(' ').toLowerCase();
      return (!query || haystack.includes(query))
        && (categoryNode.value === 'all' || item.category === categoryNode.value);
    });

    countNode.textContent = query
      ? visible.length + (visible.length === 1 ? ' coincidencia' : ' coincidencias') + ' · página ' + currentPage
      : total + (total === 1 ? ' pendiente' : ' pendientes') + ' · página ' + currentPage;
    renderPagination();
    listNode.replaceChildren();
    if (!visible.length) {
      listNode.append(text('p', items.length ? 'No hay seguimientos que coincidan con los filtros.' : 'No hay seguimientos pendientes verificables en los mensajes consultados.', 'muted'));
      return;
    }

    visible.forEach((item) => {
      const article = document.createElement('article');
      article.className = 'follow-up';
      const content = document.createElement('div');
      content.append(text('strong', item.client));
      content.append(text('small', item.subject + ' · ' + formatDate(item.date)));
      content.append(text('p', item.reason));
      article.append(content);

      const side = document.createElement('div');
      side.className = 'follow-up-side';
      const urgency = urgencyFor(item.ageDays);
      side.append(text('span', urgency[1], 'follow-up-urgency ' + urgency[0]));
      side.append(text('span', item.category || 'Seguimiento general', 'follow-up-category'));
      side.append(text('span', item.ageDays + (item.ageDays === 1 ? ' día' : ' días'), 'follow-up-age'));
      article.append(side);

      const actionBar = document.createElement('div');
      actionBar.className = 'follow-up-action-bar';
      const threadButton = text('button', 'Ver hilo completo');
      threadButton.type = 'button';
      threadButton.className = 'follow-up-thread-button';
      threadButton.dataset.threadId = item.threadId || '';
      const actions = document.createElement('div');
      actions.className = 'follow-up-actions';
      const messageId = item.messageId || '';
      const readButton = text('button', 'Marcar leído');
      readButton.type = 'button';
      readButton.className = 'follow-up-action-read';
      readButton.dataset.followUpAction = 'markRead';
      readButton.dataset.messageId = messageId;
      const archiveButton = text('button', 'Archivar');
      archiveButton.type = 'button';
      archiveButton.className = 'follow-up-action-archive';
      archiveButton.dataset.followUpAction = 'archive';
      archiveButton.dataset.messageId = messageId;
      const trashButton = text('button', 'Papelera', 'follow-up-action-trash');
      trashButton.type = 'button';
      trashButton.dataset.followUpAction = 'trash';
      trashButton.dataset.messageId = messageId;
      const replyButton = text('button', 'Responder');
      replyButton.type = 'button';
      replyButton.className = 'follow-up-action-reply';
      replyButton.dataset.followUpReply = messageId;
      actions.append(readButton, archiveButton, trashButton, replyButton);
      actionBar.append(threadButton, text('span', '|', 'follow-up-action-divider'), actions);
      article.append(actionBar);

      const actionStatus = document.createElement('p');
      actionStatus.className = 'follow-up-action-status muted';
      actionStatus.setAttribute('aria-live', 'polite');
      article.append(actionStatus);

      const thread = document.createElement('div');
      thread.className = 'follow-up-thread';
      thread.hidden = true;
      article.append(thread);
      listNode.append(article);
    });
  }

  async function load({ resetPage = false } = {}) {
    if (loading) return;
    if (resetPage) currentPage = 1;
    loading = true;
    items = [];
    total = 0;
    summary = { total: 0 };
    countNode.textContent = 'Consultando…';
    renderLoadingState();
    rangeSummaryNode.textContent = 'Consultando…';
    [...rangeForm.querySelectorAll('button, select, input')].forEach((control) => { control.disabled = true; });
    paginationStatusNodes.forEach((node, index) => { node.textContent = index === 0 ? 'Buscando seguimientos en Gmail…' : ''; });
    renderPagination();
    if (typeof window.showAppLoading === 'function') {
      window.showAppLoading('Estamos consultando Gmail y preparando los seguimientos del periodo seleccionado.', { title: 'Buscando seguimientos' });
    }
    try {
      const dateRange = getDateRange();
      const params = new URLSearchParams({
        max: '10',
        page: String(currentPage),
        from: dateRange.from || '',
        to: dateRange.to || '',
        age: 'all',
        category: categoryNode.value,
      });
      const response = await fetch('/gmail/follow-ups?' + params.toString());
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron detectar seguimientos.');
      items = result.followUps || [];
      total = Number(result.total ?? items.length);
      currentPage = Number(result.page ?? currentPage);
      pageCount = Math.max(1, Number(result.pageCount ?? 1));
      summary = result.summary || { total };
      setRangeSummary(result.analysisWindow);
      const navCount = document.querySelector('#navFollowUpCount');
      if (navCount) { navCount.textContent = String(summary.total); navCount.hidden = false; }
      render();
    } catch (error) {
      items = [];
      total = 0;
      currentPage = 1;
      pageCount = 1;
      summary = { total: 0 };
      rangeSummaryNode.textContent = 'No disponible temporalmente';
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      listNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los seguimientos.', 'muted'));
      countNode.textContent = '—';
      const navCount = document.querySelector('#navFollowUpCount');
      if (navCount) navCount.textContent = '—';
      if (typeof window.hideAppLoading === 'function') window.hideAppLoading();
      showErrorNotice(error, 'No se pudieron cargar los seguimientos.', 'No se pudieron cargar los seguimientos');
    } finally {
      loading = false;
      if (typeof window.hideAppLoading === 'function') window.hideAppLoading();
      [...rangeForm.querySelectorAll('button, select, input')].forEach((control) => { control.disabled = false; });
      renderPagination();
    }
  }

  listNode.addEventListener('click', async (event) => {
    const replyButton = event.target.closest('[data-follow-up-reply]');
    if (replyButton) {
      window.location.href = '/mailbox?reply=' + encodeURIComponent(replyButton.dataset.followUpReply || '');
      return;
    }
    const actionButton = event.target.closest('[data-follow-up-action]');
    if (actionButton) {
      const action = actionButton.dataset.followUpAction;
      const messageId = actionButton.dataset.messageId;
      const article = actionButton.closest('.follow-up');
      const status = article?.querySelector('.follow-up-action-status');
      if (!action || !messageId || !article || !status) return;
      if (action === 'trash' && !window.confirm('¿Enviar este correo a la papelera?')) return;
      const buttons = article.querySelectorAll('[data-follow-up-action], [data-follow-up-reply]');
      buttons.forEach((button) => { button.disabled = true; });
      status.textContent = 'Aplicando…';
      try {
        const response = await fetch('/gmail/messages/' + encodeURIComponent(messageId), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo aplicar la acción.');
        status.textContent = action === 'trash' ? 'Correo enviado a la papelera.' : action === 'archive' ? 'Correo archivado.' : 'Correo marcado como leído.';
        buttons.forEach((button) => { button.disabled = false; });
      } catch (error) {
        status.textContent = error.message || 'No se pudo aplicar la acción.';
        buttons.forEach((button) => { button.disabled = false; });
        showErrorNotice(error, 'No se pudo aplicar la acción.', 'No se pudo actualizar el seguimiento');
      }
      return;
    }
    const button = event.target.closest('[data-thread-id]');
    if (!button) return;
    const article = button.closest('.follow-up');
    const thread = article?.querySelector('.follow-up-thread');
    if (!article || !thread) return;
    if (!thread.hidden) {
      thread.hidden = true;
      button.textContent = 'Ver hilo completo';
      return;
    }
    thread.hidden = false;
    thread.replaceChildren(text('p', 'Cargando hilo…', 'muted'));
    button.textContent = 'Cerrar hilo';
    try {
      const response = await fetch('/gmail/threads/' + encodeURIComponent(button.dataset.threadId));
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo cargar el hilo.');
      thread.replaceChildren();
      (result.messages || []).forEach((message) => {
        const item = document.createElement('article');
        item.className = 'thread-message';
        item.append(text('strong', message.subject));
        item.append(text('small', message.from + (message.to ? ' → ' + message.to : '') + ' · ' + formatDate(message.date)));
        item.append(text('p', window.cleanEmailBody(message.body)));
        thread.append(item);
      });
    } catch (error) {
      thread.replaceChildren(text('p', error.message || 'No se pudo cargar el hilo.', 'muted'));
      showErrorNotice(error, 'No se pudo cargar el hilo.', 'No se pudo cargar el hilo');
    }
  });

  searchNode.addEventListener('input', render);
  categoryNode.addEventListener('change', () => load({ resetPage: true }));
  if (categoryInfoButton && categoryInfoModal && categoryInfoClose) {
    let lastFocusedElement = null;
    const closeCategoryInfo = () => {
      categoryInfoModal.hidden = true;
      document.documentElement.classList.remove('follow-up-info-open');
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
    };
    categoryInfoButton.addEventListener('click', () => {
      lastFocusedElement = document.activeElement;
      categoryInfoModal.hidden = false;
      document.documentElement.classList.add('follow-up-info-open');
      categoryInfoClose.focus();
    });
    categoryInfoClose.addEventListener('click', closeCategoryInfo);
    categoryInfoModal.addEventListener('click', (event) => {
      if (event.target === categoryInfoModal) closeCategoryInfo();
    });
    document.addEventListener('keydown', (event) => {
      if (!categoryInfoModal.hidden && event.key === 'Escape') closeCategoryInfo();
    });
  }
  dateModeNode.addEventListener('change', async () => {
    updateDateFields();
    if (dateModeNode.value === 'this-month') {
      exactDateNode.value = '';
      dateFromNode.value = '';
      dateToNode.value = '';
      await load({ resetPage: true });
      return;
    }
    rangeSummaryNode.textContent = 'Pendiente de aplicar';
  });
  [exactDateNode, dateFromNode, dateToNode].forEach((node) => node.addEventListener('change', () => {
    if (dateModeNode.value === 'day' || dateModeNode.value === 'range') {
      rangeSummaryNode.textContent = 'Pendiente de aplicar';
    }
  }));
  rangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      getDateRange();
      await load({ resetPage: true });
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
    await load({ resetPage: true });
  });
  previousPageButtons.forEach((button) => button.addEventListener('click', () => {
    if (loading || currentPage <= 1) return;
    currentPage -= 1;
    load();
  }));
  nextPageButtons.forEach((button) => button.addEventListener('click', () => {
    if (loading || currentPage >= pageCount) return;
    currentPage += 1;
    load();
  }));
  pageNumberContainers.forEach((container) => container.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-follow-up-page]');
    if (!pageButton || loading) return;
    const requestedPage = Number(pageButton.dataset.followUpPage);
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage === currentPage) return;
    currentPage = requestedPage;
    load();
  }));
  updateDateFields();
  load();
})();
