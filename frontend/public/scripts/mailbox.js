(() => {
  const messagesNode = document.querySelector('#messages');
  const mailboxNode = document.querySelector('#messageMailbox');
  const searchNode = document.querySelector('#messageSearch');
  const countNode = document.querySelector('#mailboxCount');
  const filterButtons = [...document.querySelectorAll('[data-message-filter]')];
  let messages = [];
  let followUps = [];
  let commitments = [];
  let filter = 'all';

  const text = (tag, value, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
    return node;
  };

  async function fetchJson(url) {
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo cargar la información.');
    return result;
  }

  function render() {
    const query = searchNode.value.trim().toLowerCase();
    const followUpThreads = new Set(followUps.map((item) => item.threadId));
    const commitmentThreads = new Set(commitments.map((item) => item.threadId));
    const filtered = messages.filter((message) => {
      const textToSearch = [message.subject, message.from, message.snippet].join(' ').toLowerCase();
      const matchesQuery = !query || textToSearch.includes(query);
      const matchesFilter = filter === 'all'
        || (filter === 'follow-ups' && followUpThreads.has(message.threadId))
        || (filter === 'commitments' && commitmentThreads.has(message.threadId))
        || (filter === 'attention' && (followUpThreads.has(message.threadId) || commitmentThreads.has(message.threadId)));
      return matchesQuery && matchesFilter;
    });

    countNode.textContent = filtered.length + ' de ' + messages.length;
    messagesNode.replaceChildren();
    if (!filtered.length) {
      messagesNode.append(text('p', query ? 'No hay mensajes que coincidan.' : 'No hay mensajes en la bandeja.', 'muted'));
      return;
    }
    filtered.forEach((message) => {
      const article = document.createElement('article');
      article.className = 'message';
      article.append(text('strong', message.subject));
      article.append(text('small', message.from + ' · ' + (message.date || '')));
      article.append(text('p', message.snippet));
      const button = text('button', 'Ver hilo completo');
      button.className = 'thread-button';
      button.dataset.threadId = message.threadId || '';
      article.append(button);
      const thread = document.createElement('div');
      thread.className = 'thread-inline';
      thread.hidden = true;
      article.append(thread);
      messagesNode.append(article);
    });
  }

  async function load() {
    try {
      const [messageResult, followUpResult, commitmentResult] = await Promise.all([
        fetchJson('/gmail/messages?max=10&mailbox=' + encodeURIComponent(mailboxNode.value)),
        fetchJson('/gmail/follow-ups?max=10'),
        fetchJson('/gmail/commitments?max=10'),
      ]);
      messages = messageResult.messages || [];
      followUps = followUpResult.followUps || [];
      commitments = commitmentResult.commitments || [];
      const navMessageCount = document.querySelector('#navMessageCount');
      if (navMessageCount) navMessageCount.textContent = String(messages.length);
      const navFollowUpCount = document.querySelector('#navFollowUpCount');
      if (navFollowUpCount) navFollowUpCount.textContent = String(followUps.length);
      const navCommitmentCount = document.querySelector('#navCommitmentCount');
      if (navCommitmentCount) navCommitmentCount.textContent = String(commitments.length);
      render();
    } catch (error) {
      messagesNode.replaceChildren(text('p', error.message || 'No se pudieron cargar los mensajes.', 'muted'));
    }
  }

  messagesNode.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-thread-id]');
    if (!button) return;
    const article = button.closest('.message');
    const thread = article?.querySelector('.thread-inline');
    if (!article || !thread) return;
    if (!thread.hidden) {
      thread.hidden = true;
      article.classList.remove('is-open');
      button.textContent = 'Ver hilo completo';
      return;
    }
    messagesNode.querySelectorAll('.thread-inline:not([hidden])').forEach((openThread) => {
      openThread.hidden = true;
      openThread.closest('.message')?.classList.remove('is-open');
      const openButton = openThread.closest('.message')?.querySelector('.thread-button');
      if (openButton) openButton.textContent = 'Ver hilo completo';
    });
    article.classList.add('is-open');
    thread.hidden = false;
    thread.replaceChildren(text('p', 'Cargando hilo…', 'muted'));
    button.textContent = 'Cerrar hilo';
    try {
      const result = await fetchJson('/gmail/threads/' + encodeURIComponent(button.dataset.threadId));
      thread.replaceChildren();
      result.messages.forEach((message) => {
        const item = document.createElement('article');
        item.className = 'message';
        item.append(text('strong', message.subject));
        item.append(text('small', message.from + (message.to ? ' → ' + message.to : '') + ' · ' + (message.date || '')));
        item.append(text('p', message.body));
        thread.append(item);
      });
    } catch (error) {
      thread.replaceChildren(text('p', error.message || 'No se pudo cargar el hilo.', 'muted'));
    }
  });

  searchNode.addEventListener('input', render);
  filterButtons.forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.messageFilter || 'all';
    filterButtons.forEach((item) => item.classList.toggle('active', item === button));
    render();
  }));
  mailboxNode.addEventListener('change', () => { messages = []; render(); load(); });
  load();
})();
