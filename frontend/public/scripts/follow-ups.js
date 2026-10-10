(() => {
  const listNode = document.querySelector('#followUps');
  const countNode = document.querySelector('#followUpCount');
  const searchNode = document.querySelector('#followUpSearch');
  const ageNode = document.querySelector('#followUpAge');
  if (!listNode || !countNode || !searchNode || !ageNode) return;

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

  function render() {
    const query = searchNode.value.trim().toLowerCase();
    const minimumAge = ageNode.value === 'all' ? 0 : Number(ageNode.value);
    const visible = items.filter((item) => {
      const haystack = [item.client, item.subject, item.reason].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && item.ageDays >= minimumAge;
    });

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
      side.append(text('span', item.ageDays + (item.ageDays === 1 ? ' día' : ' días'), 'follow-up-age'));
      const button = text('button', 'Ver hilo completo');
      button.type = 'button';
      button.className = 'follow-up-thread-button';
      button.dataset.threadId = item.threadId || '';
      side.append(button);
      article.append(side);

      const thread = document.createElement('div');
      thread.className = 'follow-up-thread';
      thread.hidden = true;
      article.append(thread);
      listNode.append(article);
    });
  }

  async function load() {
    try {
      const response = await fetch('/gmail/follow-ups?max=10');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron detectar seguimientos.');
      items = result.followUps || [];
      const navCount = document.querySelector('#navFollowUpCount');
      if (navCount) navCount.textContent = String(items.length);
      render();
    } catch (error) {
      listNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los seguimientos.', 'muted'));
      countNode.textContent = '—';
    }
  }

  listNode.addEventListener('click', async (event) => {
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
        item.append(text('p', message.body));
        thread.append(item);
      });
    } catch (error) {
      thread.replaceChildren(text('p', error.message || 'No se pudo cargar el hilo.', 'muted'));
    }
  });

  searchNode.addEventListener('input', render);
  ageNode.addEventListener('change', render);
  load();
})();
