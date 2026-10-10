(() => {
  const listNode = document.querySelector('#commitments');
  const countNode = document.querySelector('#commitmentCount');
  const searchNode = document.querySelector('#commitmentSearch');
  const ownerNode = document.querySelector('#commitmentOwner');
  if (!listNode || !countNode || !searchNode || !ownerNode) return;

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
    try {
      const shared = window.__commercialNavDataPromise
        ? await window.__commercialNavDataPromise
        : null;
      const result = shared?.commitments ?? await (async () => {
        const response = await fetch('/gmail/commitments?max=10');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los compromisos.');
        return data;
      })();
      items = result.commitments || [];
      const navCount = document.querySelector('#navCommitmentCount');
      if (navCount) navCount.textContent = String(items.length);
      render();
    } catch (error) {
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      listNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los compromisos.', 'muted'));
      countNode.textContent = 'No disponible';
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
        item.append(text('p', message.body));
        thread.append(item);
      });
    } catch (error) {
      thread.replaceChildren(text('p', error.message || 'No se pudo cargar el hilo.', 'muted'));
    }
  });

  searchNode.addEventListener('input', render);
  ownerNode.addEventListener('change', render);
  load();
})();
