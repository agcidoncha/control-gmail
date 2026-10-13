(() => {
  const listNode = document.querySelector('#clients');
  const countNode = document.querySelector('#clientCount');
  const searchNode = document.querySelector('#clientSearch');
  const pageSizeNode = document.querySelector('#clientPageSize');
  const paginationNode = document.querySelector('#clientPagination');
  const previousNode = document.querySelector('#clientPrevious');
  const nextNode = document.querySelector('#clientNext');
  const pageStatusNode = document.querySelector('#clientPageStatus');
  if (!listNode || !countNode || !searchNode || !pageSizeNode || !paginationNode || !previousNode || !nextNode || !pageStatusNode) return;

  let clients = [];
  let currentPage = 1;

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
    }
  }

  function getPageSize() {
    return pageSizeNode.value === 'all' ? clients.length || 1 : Number(pageSizeNode.value);
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
    aiLink.href = '/consultar-ia?prompt=' + encodeURIComponent(`Interpreta las necesidades, preferencias y estado comercial de ${client.email} usando solo sus conversaciones.`);
    aiLink.textContent = 'Analizar necesidades';
    actions.append(historyButton, aiLink);
    card.append(actions);
    return card;
  }

  function render() {
    const query = searchNode.value.trim().toLowerCase();
    const filteredClients = clients.filter((client) => client.email.toLowerCase().includes(query));
    const pageSize = getPageSize();
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
      const response = await fetch('/gmail/insights?max=1000');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los clientes.');
      clients = data.insights?.clients || [];
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
    }
  }

  searchNode.addEventListener('input', () => {
    currentPage = 1;
    render();
  });
  pageSizeNode.addEventListener('change', () => {
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
