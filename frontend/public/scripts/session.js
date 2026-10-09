(async () => {
  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = String(value ?? '');
  };

  try {
    const meResponse = await fetch('/me');
    if (!meResponse.ok) return;
    const account = await meResponse.json();
    setText('#accountChip', account.email);
    setText('#statRole', account.role === 'admin' ? 'Admin' : 'Comercial');

    const [messagesResponse, followUpsResponse, commitmentsResponse] = await Promise.all([
      fetch('/gmail/messages?max=10&mailbox=inbox'),
      fetch('/gmail/follow-ups?max=10'),
      fetch('/gmail/commitments?max=10'),
    ]);
    if (messagesResponse.ok) {
      const messages = await messagesResponse.json();
      setText('#statMessageCount', messages.messages?.length ?? 0);
      setText('#navMessageCount', messages.messages?.length ?? 0);
    }
    if (followUpsResponse.ok) setText('#navFollowUpCount', (await followUpsResponse.json()).followUps?.length ?? 0);
    if (commitmentsResponse.ok) setText('#navCommitmentCount', (await commitmentsResponse.json()).commitments?.length ?? 0);
  } catch {
    // La pantalla sigue siendo navegable aunque el backend aún no esté iniciado.
  }
})();
