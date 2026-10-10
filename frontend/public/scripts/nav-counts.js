(() => {
  if (window.__commercialNavDataPromise) return;

  async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el contador.');
    return data;
  }

  const dataPromise = fetchJson('/me').then(async (account) => {
    const [messages, followUps, commitments] = await Promise.allSettled([
      fetchJson('/gmail/messages?max=10&mailbox=inbox'),
      fetchJson('/gmail/follow-ups?max=10'),
      fetchJson('/gmail/commitments?max=10'),
    ]);

    return {
      account,
      messages: messages.status === 'fulfilled' ? messages.value : null,
      followUps: followUps.status === 'fulfilled' ? followUps.value : null,
      commitments: commitments.status === 'fulfilled' ? commitments.value : null,
    };
  });

  window.__commercialNavDataPromise = dataPromise;

  function setCount(selector, value) {
    const node = document.querySelector(selector);
    if (node && value !== null && value !== undefined) node.textContent = String(value);
  }

  function applyCounts(data) {
    setCount('#navMessageCount', data.messages?.messages?.length);
    setCount('#navFollowUpCount', data.followUps?.followUps?.length);
    setCount('#navCommitmentCount', data.commitments?.commitments?.length);
  }

  const applyWhenReady = () => dataPromise.then(applyCounts).catch(() => undefined);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyWhenReady, { once: true });
  } else {
    applyWhenReady();
  }
})();
