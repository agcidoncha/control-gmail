(() => {
  fetch('/me')
    .then((response) => {
      if (response.ok) window.location.replace('/dashboard');
    })
    .catch(() => {
      // La pantalla de acceso sigue disponible aunque el backend esté detenido.
    });
})();
