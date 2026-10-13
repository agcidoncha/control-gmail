(() => {
  const listNode = document.querySelector('#followUps');
  const countNode = document.querySelector('#followUpCount');
  const searchNode = document.querySelector('#followUpSearch');
  const ageNode = document.querySelector('#followUpAge');
  const categoryNode = document.querySelector('#followUpCategory');
  const alertsNode = document.querySelector('#followUpAlerts');
  if (!listNode || !countNode || !searchNode || !ageNode || !categoryNode || !alertsNode) return;

  let items = [];

  const text = (tag, value, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
    return node;
  };

  function formatDate(value) {
    if (!value) return 'Fecha desconocida';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function urgencyFor(ageDays) {
    if (ageDays >= 15) return ['urgent', 'Urgente'];
    if (ageDays >= 10) return ['priority', 'Prioritario'];
    if (ageDays >= 5) return ['attention', 'Atención'];
    return ['normal', 'Reciente'];
  }

  function renderAlerts() {
    const thresholds = [
      { days: 5, tone: 'attention', title: 'Desde 5 días', description: 'Revisar esta semana' },
      { days: 10, tone: 'priority', title: 'Desde 10 días', description: 'Prioridad comercial' },
      { days: 15, tone: 'urgent', title: 'Desde 15 días', description: 'Atención urgente' },
    ];
    const alerts = thresholds
      .map((threshold) => ({ ...threshold, count: items.filter((item) => item.ageDays >= threshold.days).length }))
      .filter((threshold) => threshold.count > 0);

    alertsNode.replaceChildren();
    alertsNode.hidden = alerts.length === 0;
    alerts.forEach((alert) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'follow-up-alert ' + alert.tone;
      button.dataset.ageAlert = String(alert.days);
      button.append(text('strong', alert.count + (alert.count === 1 ? ' seguimiento' : ' seguimientos') + ' · ' + alert.title));
      button.append(text('span', alert.description));
      alertsNode.append(button);
    });
  }

  function render() {
    listNode.removeAttribute('aria-hidden');
    listNode.removeAttribute('aria-busy');
    listNode.removeAttribute('aria-label');
    countNode.removeAttribute('aria-label');
    const query = searchNode.value.trim().toLowerCase();
    const minimumAge = ageNode.value === 'all' ? 0 : Number(ageNode.value);
    const visible = items.filter((item) => {
      const haystack = [item.client, item.subject, item.reason].join(' ').toLowerCase();
      return (!query || haystack.includes(query))
        && item.ageDays >= minimumAge
        && (categoryNode.value === 'all' || item.category === categoryNode.value);
    });

    renderAlerts();
    countNode.textContent = visible.length + (visible.length === 1 ? ' pendiente' : ' pendientes');
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

  async function load() {
    try {
      const shared = window.__commercialNavDataPromise
        ? await window.__commercialNavDataPromise
        : null;
      const result = shared?.followUps ?? await (async () => {
        const response = await fetch('/gmail/follow-ups?max=10');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudieron detectar seguimientos.');
        return data;
      })();
      items = result.followUps || [];
      const navCount = document.querySelector('#navFollowUpCount');
      if (navCount) { navCount.textContent = String(items.length); navCount.hidden = false; }
      render();
    } catch (error) {
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      listNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los seguimientos.', 'muted'));
      countNode.textContent = '—';
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
    }
  });

  searchNode.addEventListener('input', render);
  ageNode.addEventListener('change', render);
  categoryNode.addEventListener('change', render);
  alertsNode.addEventListener('click', (event) => {
    const button = event.target.closest('[data-age-alert]');
    if (!button) return;
    ageNode.value = button.dataset.ageAlert || 'all';
    render();
    listNode.focus?.({ preventScroll: true });
  });
  load();
})();
