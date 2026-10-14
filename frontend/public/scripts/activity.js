(() => {
  const listNode = document.querySelector('#activityList');
  const scopeNode = document.querySelector('#activityScope');
  const messageNode = document.querySelector('#activityMessage');
  const actionNode = document.querySelector('#activityAction');
  const outcomeNode = document.querySelector('#activityOutcome');
  const refreshNode = document.querySelector('#activityRefresh');
  if (!listNode || !scopeNode || !messageNode || !actionNode || !outcomeNode || !refreshNode) return;

  const actionLabels = {
    send: 'Envió un correo',
    archive: 'Archivó un correo',
    unarchive: 'Desarchivó un correo',
    trash: 'Envió un correo a la papelera',
    restore: 'Restauró un correo',
    markRead: 'Marcó un correo como leído',
    markUnread: 'Marcó un correo como no leído',
  };

  const text = (tag, value, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
    return node;
  };

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Fecha desconocida' : new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function setLoading(loading) {
    refreshNode.disabled = loading;
    refreshNode.textContent = loading ? 'Actualizando…' : 'Actualizar';
    listNode.setAttribute('aria-busy', String(loading));
  }

  function render(data) {
    const actions = data.actions || [];
    scopeNode.textContent = data.scope === 'organization'
      ? 'Mostrando la actividad de toda la empresa. Solo aparecen datos de control, nunca el contenido de los correos.'
      : 'Mostrando solo tus propias acciones. El administrador no puede leer el contenido de tus correos.';
    listNode.replaceChildren();
    if (!actions.length) {
      listNode.append(text('p', 'No hay actividad que coincida con estos filtros.', 'activity-empty'));
      return;
    }
    actions.forEach((record) => {
      const row = document.createElement('article');
      row.className = 'activity-row';
      const details = document.createElement('div');
      const label = actionLabels[record.action] || 'Realizó una acción de correo';
      details.append(text('strong', label + (record.outcome === 'error' ? ' · No completada' : '')));
      details.append(text('small', `${record.userEmail} · Cuenta: ${record.accountEmail}`, record.outcome === 'error' ? 'activity-error' : ''));
      row.append(details, text('time', formatDate(record.createdAt)));
      row.lastChild.dateTime = record.createdAt;
      listNode.append(row);
    });
  }

  async function load() {
    setLoading(true);
    messageNode.textContent = '';
    messageNode.className = 'form-message';
    try {
      const params = new URLSearchParams({ max: '1000', scope: 'organization' });
      if (actionNode.value) params.set('action', actionNode.value);
      if (outcomeNode.value) params.set('outcome', outcomeNode.value);
      const response = await fetch('/gmail/actions?' + params.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo cargar la actividad.');
      render(data);
    } catch (error) {
      scopeNode.textContent = '';
      listNode.replaceChildren(text('p', error.message || 'No se pudo cargar la actividad.', 'activity-empty'));
      if (typeof window.showAppNotice === 'function') window.showAppNotice(error.message || 'No se pudo cargar la actividad.', { title: 'No se pudo cargar la actividad' });
      messageNode.textContent = 'Puedes volver a intentarlo con «Actualizar».';
      messageNode.className = 'form-message error';
    } finally {
      setLoading(false);
    }
  }

  actionNode.addEventListener('change', load);
  outcomeNode.addEventListener('change', load);
  refreshNode.addEventListener('click', load);
  load();
})();
