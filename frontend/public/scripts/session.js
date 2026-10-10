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
  } catch {
    // La pantalla sigue siendo navegable aunque el backend aún no esté iniciado.
  }
})();
