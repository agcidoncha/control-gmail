(() => {
  const statMessageCount = document.querySelector('#statMessageCount');
  const navMessageCount = document.querySelector('#navMessageCount');
  const navFollowUpCount = document.querySelector('#navFollowUpCount');
  const navCommitmentCount = document.querySelector('#navCommitmentCount');
  if (!statMessageCount && !navMessageCount && !navFollowUpCount && !navCommitmentCount) return;

  async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el resumen.');
    return data;
  }

  function setCount(node, value) {
    if (node) node.textContent = String(value);
  }

  Promise.allSettled([
    fetchJson('/gmail/messages?max=10&mailbox=inbox'),
    fetchJson('/gmail/follow-ups?max=10'),
    fetchJson('/gmail/commitments?max=10'),
  ]).then(([messagesResult, followUpsResult, commitmentsResult]) => {
    if (messagesResult.status === 'fulfilled') {
      const messages = messagesResult.value.messages || [];
      setCount(statMessageCount, messages.length);
      setCount(navMessageCount, messages.length);
    }
    if (followUpsResult.status === 'fulfilled') {
      setCount(navFollowUpCount, (followUpsResult.value.followUps || []).length);
    }
    if (commitmentsResult.status === 'fulfilled') {
      setCount(navCommitmentCount, (commitmentsResult.value.commitments || []).length);
    }
  });
})();
