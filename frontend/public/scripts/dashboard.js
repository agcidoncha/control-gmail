(() => {
  const statMessageCount = document.querySelector('#statMessageCount');
  const statUnreadCount = document.querySelector('#statUnreadCount');
  const statFollowUpCount = document.querySelector('#statFollowUpCount');
  const statCommitmentCount = document.querySelector('#statCommitmentCount');
  const dashboardStatus = document.querySelector('#dashboardStatus');
  const dashboardAccount = document.querySelector('#dashboardAccount');
  const navMessageCount = document.querySelector('#navMessageCount');
  const navFollowUpCount = document.querySelector('#navFollowUpCount');
  const navCommitmentCount = document.querySelector('#navCommitmentCount');
  const followUpInfoButton = document.querySelector('#followUpInfoButton');
  const followUpInfoModal = document.querySelector('#followUpInfoModal');
  const followUpInfoClose = document.querySelector('#followUpInfoClose');
  if (!statMessageCount && !navMessageCount && !navFollowUpCount && !navCommitmentCount) return;

  if (followUpInfoButton && followUpInfoModal && followUpInfoClose) {
    let lastFocusedElement = null;

    const closeFollowUpInfo = () => {
      followUpInfoModal.hidden = true;
      document.documentElement.classList.remove('dashboard-info-open');
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
    };

    followUpInfoButton.addEventListener('click', () => {
      lastFocusedElement = document.activeElement;
      followUpInfoModal.hidden = false;
      document.documentElement.classList.add('dashboard-info-open');
      followUpInfoClose.focus();
    });

    followUpInfoClose.addEventListener('click', closeFollowUpInfo);
    followUpInfoModal.addEventListener('click', (event) => {
      if (event.target === followUpInfoModal) closeFollowUpInfo();
    });
    document.addEventListener('keydown', (event) => {
      if (!followUpInfoModal.hidden && event.key === 'Escape') closeFollowUpInfo();
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el resumen.');
    return data;
  }

  function unwrap(result) {
    return result?.value ?? result;
  }

  function setCount(node, value) {
    if (node && value !== null && value !== undefined) {
      node.textContent = String(value);
      node.hidden = false;
    }
  }

  function setText(node, value) {
    if (node && value !== null && value !== undefined) node.textContent = String(value);
  }

  const sharedPromise = window.__commercialNavDataPromise;
  const dataPromise = sharedPromise
    ? sharedPromise.then((data) => data.messages?.messages
      ? data
      : fetchJson('/gmail/messages?max=10&mailbox=inbox&refresh=1').then((messages) => ({ ...data, messages })))
    : fetchJson('/gmail/messages?max=10&mailbox=inbox&refresh=1').then((messages) => ({ messages }));

  dataPromise.then((data) => {
    const messagesResult = unwrap(data.messages);
    const followUpsResult = unwrap(data.followUps);
    const commitmentsResult = unwrap(data.commitments);
    const messages = messagesResult?.messages || [];
    const followUps = followUpsResult?.followUps || [];
    const commitments = commitmentsResult?.commitments || [];
    const unreadCount = messages.filter((message) => message.labelIds?.includes('UNREAD')).length;

    setCount(statMessageCount, messages.length);
    setCount(statUnreadCount, unreadCount);
    setCount(statFollowUpCount, followUps.length);
    setCount(statCommitmentCount, commitments.length);
    setCount(navMessageCount, messages.length);
    setCount(navFollowUpCount, followUps.length);
    setCount(navCommitmentCount, commitments.length);
    setText(dashboardAccount, data.account || 'Cuenta activa');
    setText(dashboardStatus, 'Datos cargados de la cuenta activa.');
  }).catch((error) => {
    setText(dashboardStatus, error.message || 'No se pudo cargar el estado de la cuenta.');
    if (dashboardStatus) dashboardStatus.classList.add('dashboard-status-error');
  });
})();
