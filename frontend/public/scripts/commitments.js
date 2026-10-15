(() => {
  const listNode = document.querySelector('#commitments');
  const countNode = document.querySelector('#commitmentCount');
  const searchNode = document.querySelector('#commitmentSearch');
  const ownerNode = document.querySelector('#commitmentOwner');
  const rangeForm = document.querySelector('#commitmentRangeForm');
  const dateModeNode = document.querySelector('#commitmentDateMode');
  const exactDateField = document.querySelector('#commitmentExactDateField');
  const exactDateNode = document.querySelector('#commitmentExactDate');
  const dateRangeFields = document.querySelector('#commitmentDateRangeFields');
  const dateFromNode = document.querySelector('#commitmentDateFrom');
  const dateToNode = document.querySelector('#commitmentDateTo');
  const rangeSummaryNode = document.querySelector('#commitmentRangeSummary');
  const applyRangeButton = document.querySelector('#applyCommitmentRange');
  const clearRangeButton = document.querySelector('#clearCommitmentRange');
  if (!listNode || !countNode || !searchNode || !ownerNode || !rangeForm || !dateModeNode || !exactDateField || !exactDateNode || !dateRangeFields || !dateFromNode || !dateToNode || !rangeSummaryNode || !applyRangeButton || !clearRangeButton) return;

  let items = [];
  let hasAppliedRange = false;
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
    if (!dateModeNode.value) throw new Error('Selecciona un periodo antes de aplicar la búsqueda.');
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
    if (!mode) {
      exactDateField.hidden = true;
      dateRangeFields.hidden = true;
      applyRangeButton.hidden = true;
      clearRangeButton.hidden = true;
      return;
    }
    exactDateField.hidden = mode !== 'day';
    dateRangeFields.hidden = mode !== 'range';
    applyRangeButton.hidden = false;
    clearRangeButton.hidden = false;
  }

  function setRangeSummary(analysisWindow) {
    if (!analysisWindow) return;
    const prefix = dateModeNode.value === 'this-month' ? 'Este mes' : dateModeNode.value === 'day' ? 'Día concreto' : 'Periodo';
    rangeSummaryNode.textContent = `${prefix}: ${formatWindowDate(analysisWindow.from)} – ${formatWindowDate(analysisWindow.to)}`;
  }

  function renderPendingState() {
    loading = false;
    items = [];
    countNode.textContent = 'Sin periodo seleccionado';
    countNode.removeAttribute('aria-label');
    rangeSummaryNode.textContent = 'Sin periodo seleccionado';
    listNode.removeAttribute('aria-hidden');
    listNode.removeAttribute('aria-busy');
    listNode.removeAttribute('aria-label');
    listNode.replaceChildren(text('p', 'Elige un periodo arriba y pulsa «Aplicar» para consultar los compromisos.', 'muted'));
  }

  function render() {
    listNode.removeAttribute('aria-hidden');
    listNode.removeAttribute('aria-busy');
    listNode.removeAttribute('aria-label');
    countNode.removeAttribute('aria-label');
    const query = searchNode.value.trim().toLowerCase();
    const visible = items.filter((item) => {
      const matchesQuery = [item.subject, item.owner, item.commitment, item.reason].join(' ').toLowerCase().includes(query);
      const isCommercial = item.owner === 'Tú';
      const matchesOwner = ownerNode.value === 'all'
        || (ownerNode.value === 'commercial' && isCommercial)
        || (ownerNode.value === 'client' && !isCommercial);
      return matchesQuery && matchesOwner;
    });
    countNode.textContent = visible.length + (visible.length === 1 ? ' posible compromiso' : ' posibles compromisos');
    listNode.replaceChildren();
    if (!visible.length) {
      listNode.append(text('p', items.length ? 'No hay compromisos que coincidan con la búsqueda.' : 'No hay compromisos verificables en los hilos consultados.', 'muted'));
      return;
    }

    visible.forEach((item) => {
      const article = document.createElement('article');
      article.className = 'commitment';
      const content = document.createElement('div');
      content.append(text('strong', item.commitment));
      content.append(text('small', item.subject + ' · ' + item.owner + ' · ' + formatDate(item.date)));
      content.append(text('p', item.reason));
      article.append(content);

      const side = document.createElement('div');
      side.className = 'commitment-side';
      side.append(text('span', item.status || 'Pendiente de revisión', 'commitment-status'));
      const button = text('button', 'Ver hilo completo');
      button.type = 'button';
      button.className = 'commitment-thread-button';
      button.dataset.threadId = item.threadId || '';
      side.append(button);
      article.append(side);

      const thread = document.createElement('div');
      thread.className = 'commitment-thread';
      thread.hidden = true;
      article.append(thread);
      listNode.append(article);
    });
  }

  async function load() {
    if (!hasAppliedRange) {
      renderPendingState();
      return;
    }
    if (loading) return;
    loading = true;
    listNode.removeAttribute('aria-hidden');
    listNode.setAttribute('aria-busy', 'true');
    listNode.setAttribute('aria-label', 'Consultando compromisos');
    listNode.replaceChildren(text('p', 'Consultando los compromisos…', 'muted'));
    countNode.textContent = 'Consultando…';
    [...rangeForm.querySelectorAll('button, select, input')].forEach((control) => { control.disabled = true; });
    if (typeof window.showAppLoading === 'function') {
      window.showAppLoading('Estamos consultando Gmail y preparando los compromisos del periodo seleccionado.', { title: 'Buscando compromisos' });
    }
    try {
      const dateRange = getDateRange();
      const params = new URLSearchParams({ max: '10', from: dateRange.from || '', to: dateRange.to || '' });
      const response = await fetch('/gmail/commitments?' + params.toString());
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron cargar los compromisos.');
      items = result.commitments || [];
      setRangeSummary(result.analysisWindow);
      const navCount = document.querySelector('#navCommitmentCount');
      if (navCount) { navCount.textContent = String(items.length); navCount.hidden = false; }
      render();
    } catch (error) {
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      listNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los compromisos.', 'muted'));
      countNode.textContent = 'No disponible';
      showErrorNotice(error, 'No se pudieron cargar los compromisos.', 'No se pudieron cargar los compromisos');
    } finally {
      loading = false;
      if (typeof window.hideAppLoading === 'function') window.hideAppLoading();
      [...rangeForm.querySelectorAll('button, select, input')].forEach((control) => { control.disabled = false; });
    }
  }

  listNode.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-thread-id]');
    if (!button) return;
    const article = button.closest('.commitment');
    const thread = article?.querySelector('.commitment-thread');
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
  ownerNode.addEventListener('change', render);
  dateModeNode.addEventListener('change', () => {
    updateDateFields();
    hasAppliedRange = false;
    exactDateNode.value = '';
    dateFromNode.value = '';
    dateToNode.value = '';
    renderPendingState();
  });
  [exactDateNode, dateFromNode, dateToNode].forEach((node) => node.addEventListener('change', () => {
    if (dateModeNode.value === 'day' || dateModeNode.value === 'range') {
      hasAppliedRange = false;
      renderPendingState();
      rangeSummaryNode.textContent = 'Pendiente de aplicar';
    }
  }));
  rangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      getDateRange();
      hasAppliedRange = true;
      await load();
    } catch (error) {
      showErrorNotice(error, 'Revisa las fechas seleccionadas.', 'No se puede aplicar el periodo');
    }
  });
  clearRangeButton.addEventListener('click', () => {
    dateModeNode.value = '';
    exactDateNode.value = '';
    dateFromNode.value = '';
    dateToNode.value = '';
    hasAppliedRange = false;
    updateDateFields();
    renderPendingState();
  });
  updateDateFields();
  renderPendingState();
})();
