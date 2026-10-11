(() => {
  const listNode = document.querySelector('#clients');
  const countNode = document.querySelector('#clientCount');
  if (!listNode || !countNode) return;

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

  async function load() {
    try {
      const response = await fetch('/gmail/insights?max=25');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los clientes.');
      const clients = data.insights?.clients || [];
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      countNode.textContent = clients.length + (clients.length === 1 ? ' cliente' : ' clientes');
      listNode.replaceChildren();
      if (!clients.length) {
        listNode.append(text('p', 'No hay clientes detectados en los mensajes revisados.', 'muted'));
        return;
      }
      clients.forEach((client) => {
        const card = document.createElement('article');
        card.className = 'client-card';
        card.append(text('strong', client.email));
        card.append(text('small', client.messages + (client.messages === 1 ? ' mensaje relacionado' : ' mensajes relacionados')));
        card.append(text('p', 'Última actividad: ' + formatDate(client.latestDate)));
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
        listNode.append(card);
      });
    } catch (error) {
      listNode.removeAttribute('aria-hidden');
      listNode.removeAttribute('aria-busy');
      listNode.removeAttribute('aria-label');
      countNode.removeAttribute('aria-label');
      countNode.textContent = 'No disponible';
      listNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los clientes.', 'muted'));
    }
  }

  load();
})();
