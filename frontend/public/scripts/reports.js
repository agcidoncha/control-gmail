(() => {
  const statsNode = document.querySelector('#reportStats');
  const activityNode = document.querySelector('#reportActivity');
  const clientsNode = document.querySelector('#reportClients');
  const attentionNode = document.querySelector('#reportAttention');
  const periodNode = document.querySelector('#reportPeriod');
  const customRangeNode = document.querySelector('#reportCustomRange');
  const fromNode = document.querySelector('#reportFrom');
  const toNode = document.querySelector('#reportTo');
  const applyNode = document.querySelector('#reportApply');
  const refreshNode = document.querySelector('#reportsRefresh');
  const printNode = document.querySelector('#reportsPrint');
  const windowNode = document.querySelector('#reportWindow');
  const messageNode = document.querySelector('#reportMessage');
  if (!statsNode || !activityNode || !clientsNode || !attentionNode || !periodNode || !customRangeNode || !fromNode || !toNode || !applyNode || !refreshNode || !printNode || !windowNode || !messageNode) return;

  const actionLabels = {
    send: 'Envíos',
    archive: 'Archivados',
    unarchive: 'Desarchivados',
    trash: 'Enviados a papelera',
    restore: 'Restaurados',
    markRead: 'Marcados como leídos',
    markUnread: 'Marcados como no leídos',
  };
  let loading = false;

  const text = (tag, value, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
    return node;
  };

  const formatDate = (value) => {
    if (!value) return 'sin fecha';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  };

  function updateCustomRange() {
    customRangeNode.hidden = periodNode.value !== 'custom';
  }

  function getParams() {
    // El resumen no necesita forzar el máximo absoluto de Gmail. El servidor
    // respeta el límite de análisis configurado y marca los resultados parciales.
    const params = new URLSearchParams({ max: '30' });
    if (periodNode.value === 'custom') {
      if (!fromNode.value || !toNode.value) throw new Error('Indica las fechas Desde y Hasta.');
      if (fromNode.value > toNode.value) throw new Error('La fecha Desde no puede ser posterior a Hasta.');
      params.set('from', fromNode.value);
      params.set('to', toNode.value);
    } else {
      params.set('days', periodNode.value);
    }
    return params;
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el informe.');
    return data;
  }

  function setLoading(value) {
    loading = value;
    applyNode.disabled = value;
    refreshNode.disabled = value;
    applyNode.textContent = value ? 'Cargando…' : 'Aplicar';
    refreshNode.textContent = value ? 'Actualizando…' : 'Actualizar';
    statsNode.setAttribute('aria-busy', String(value));
    if (value) statsNode.setAttribute('aria-label', 'Cargando métricas');
    else statsNode.removeAttribute('aria-label');
  }

  function renderStat(label, value, detail) {
    const article = document.createElement('article');
    article.className = 'card report-stat';
    article.append(text('span', label));
    article.append(text('strong', value));
    article.append(text('small', detail));
    return article;
  }

  function renderBreakdown(node, entries, emptyMessage) {
    node.replaceChildren();
    if (!entries.length) {
      node.append(text('p', emptyMessage, 'report-empty'));
      return;
    }
    entries.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'report-breakdown-row';
      row.append(text('span', label), text('strong', value));
      node.append(row);
    });
  }

  function render(data) {
    const insights = data.insights;
    const followUps = data.followUps || [];
    const commitments = data.commitments || [];
    const actions = data.actions || [];
    const actionCounts = Object.entries(actions.reduce((counts, action) => {
      const label = actionLabels[action.action] || 'Otras acciones';
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {})).sort((left, right) => right[1] - left[1]);
    const successCount = actions.filter((action) => action.outcome === 'success').length;
    const latestClient = insights.clients[0]?.email || 'sin clientes detectados';
    const latestDate = insights.latestDate ? `Última actividad: ${formatDate(insights.latestDate)}` : 'Sin actividad en el periodo';

    statsNode.replaceChildren(
      renderStat('Correos revisados', insights.reviewedMessages, `${insights.inboxMessages} recibidos · ${insights.sentMessages} enviados`),
      renderStat('Clientes detectados', insights.clients.length, latestClient),
      renderStat('Seguimientos pendientes', data.followUpTotal ?? followUps.length, data.followUpsTruncated ? 'Resultado parcial: acota el periodo para revisarlos todos' : 'Mensajes enviados sin respuesta posterior'),
      renderStat('Compromisos pendientes', commitments.length, latestDate),
    );
    renderBreakdown(activityNode, actionCounts, 'Todavía no hay acciones registradas desde la aplicación.');
    renderBreakdown(clientsNode, insights.clients.slice(0, 8).map((client) => [client.email, client.messages]), 'No se han detectado clientes en el periodo.');
    attentionNode.replaceChildren(
      (() => { const card = document.createElement('div'); card.className = 'report-attention-card'; card.append(text('span', 'Acciones correctas'), text('strong', successCount)); return card; })(),
      (() => { const card = document.createElement('div'); card.className = 'report-attention-card'; card.append(text('span', 'Acciones con error'), text('strong', actions.length - successCount)); return card; })(),
      (() => { const card = document.createElement('div'); card.className = 'report-attention-card'; card.append(text('span', 'Periodo consultado'), text('strong', data.analysisWindow.days + ' días')); return card; })(),
    );
    windowNode.textContent = `Periodo: ${formatDate(data.analysisWindow.from)} – ${formatDate(data.analysisWindow.to)} · ${actions.length} acciones registradas.${insights.truncated ? ' Datos de correo parciales: acota el periodo para revisar más resultados.' : ''}`;
  }

  async function load() {
    if (loading) return;
    setLoading(true);
    messageNode.textContent = '';
    messageNode.className = 'form-message';
    try {
      const params = getParams();
      const suffix = params.toString();
      // No lanzar tres análisis de Gmail a la vez: cada uno puede refrescar
      // contexto y consultar hilos. Escalonarlos reduce picos de cuota.
      const insights = await fetchJson('/gmail/insights?' + suffix);
      const followUps = await fetchJson('/gmail/follow-ups?' + suffix);
      const commitments = await fetchJson('/gmail/commitments?' + suffix);
      const actions = await fetchJson('/gmail/actions?max=1000&scope=organization');
      const from = new Date(`${insights.analysisWindow.from.replaceAll('/', '-')}T00:00:00`);
      const to = new Date(`${insights.analysisWindow.to.replaceAll('/', '-')}T23:59:59`);
      const periodActions = (actions.actions || []).filter((action) => {
        const timestamp = new Date(action.createdAt);
        return timestamp >= from && timestamp <= to;
      });
      render({ ...insights, followUps: followUps.followUps, followUpTotal: followUps.total, followUpsTruncated: followUps.truncated, commitments: commitments.commitments, actions: periodActions });
    } catch (error) {
      statsNode.replaceChildren(text('p', error.message || 'No se pudo cargar el informe.', 'report-error'));
      activityNode.replaceChildren();
      clientsNode.replaceChildren();
      attentionNode.replaceChildren();
      windowNode.textContent = '';
      if (typeof window.showAppNotice === 'function') window.showAppNotice(error.message || 'No se pudo cargar el informe.', { title: 'No se pudo cargar el informe' });
      messageNode.textContent = 'Puedes volver a intentarlo con «Actualizar».';
      messageNode.className = 'form-message error';
    } finally {
      setLoading(false);
    }
  }

  periodNode.addEventListener('change', updateCustomRange);
  applyNode.addEventListener('click', load);
  refreshNode.addEventListener('click', load);
  printNode.addEventListener('click', () => window.print());
  updateCustomRange();
})();
