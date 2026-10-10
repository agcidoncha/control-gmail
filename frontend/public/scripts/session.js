(async () => {
  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = String(value ?? '');
  };

  try {
    const meResponse = await fetch('/me');
    if (!meResponse.ok) {
      window.location.replace('/');
      return;
    }
    const account = await meResponse.json();
    setText('#accountChip', account.email);
    setText('#statRole', account.role === 'admin' ? 'Admin' : 'Comercial');
    document.querySelectorAll('[data-admin-only="true"]').forEach((node) => {
      node.hidden = account.role !== 'admin';
    });

    // No mostramos la gestión de usuarios a cuentas comerciales. Se elimina
    // directamente del DOM para evitar que quede visible por estilos o caché.
    if (account.role !== 'admin') {
      document.querySelectorAll('a[href="/settings/users"]').forEach((node) => node.remove());
    }
  } catch {
    // La pantalla sigue siendo navegable aunque el backend aún no esté iniciado.
  }
})();
