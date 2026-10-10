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
