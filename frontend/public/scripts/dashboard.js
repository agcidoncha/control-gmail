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
    if (node) {
      node.textContent = String(value);
      node.hidden = false;
    }
  }

  const sharedPromise = window.__commercialNavDataPromise;
  (sharedPromise
    ? sharedPromise.then((data) => data.messages?.messages
      ? data
      : fetchJson('/gmail/messages?max=10&mailbox=inbox').then((messages) => ({ ...data, messages }))).then((data) => ({
        messagesResult: data.messages,
        followUpsResult: data.followUps,
        commitmentsResult: data.commitments,
      }))
    : fetchJson('/gmail/messages?max=10&mailbox=inbox').then((messagesResult) => ({ messagesResult, followUpsResult: null, commitmentsResult: null }))).then(({ messagesResult, followUpsResult, commitmentsResult }) => {
    if (messagesResult && (messagesResult.status === undefined || messagesResult.status === 'fulfilled')) {
      const messages = messagesResult.messages || messagesResult.value?.messages || [];
      setCount(statMessageCount, messages.length);
      setCount(navMessageCount, messages.length);
    }
    if (followUpsResult && (followUpsResult.status === undefined || followUpsResult.status === 'fulfilled')) {
      setCount(navFollowUpCount, (followUpsResult.followUps || followUpsResult.value?.followUps || []).length);
    }
    if (commitmentsResult && (commitmentsResult.status === undefined || commitmentsResult.status === 'fulfilled')) {
      setCount(navCommitmentCount, (commitmentsResult.commitments || commitmentsResult.value?.commitments || []).length);
    }
  });
})();
