(() => {
  const shell = document.querySelector('[data-resizable-shell]');
  const resizer = document.querySelector('#sidebarResizer');
  if (!shell || !resizer) return;

  const storageKey = 'commercial-sidebar-width';
  const minimum = 18;
  const maximum = 42;

  const clamp = (value) => Math.min(maximum, Math.max(minimum, value));
  const setWidth = (value, persist = true) => {
    const width = clamp(value);
    shell.style.setProperty('--sidebar-width', width + '%');
    resizer.setAttribute('aria-valuenow', String(Math.round(width)));
    if (persist) window.localStorage.setItem(storageKey, String(width));
  };

  const storedWidth = Number(window.localStorage.getItem(storageKey));
  if (Number.isFinite(storedWidth)) setWidth(storedWidth, false);

  const widthFromPointer = (clientX) => {
    const bounds = shell.getBoundingClientRect();
    return ((clientX - bounds.left) / bounds.width) * 100;
  };

  let dragging = false;
  resizer.addEventListener('pointerdown', (event) => {
    dragging = true;
    resizer.setPointerCapture(event.pointerId);
    shell.classList.add('is-resizing');
    setWidth(widthFromPointer(event.clientX));
    event.preventDefault();
  });
  resizer.addEventListener('pointermove', (event) => {
    if (dragging) setWidth(widthFromPointer(event.clientX));
  });
  const stopDragging = (event) => {
    if (!dragging) return;
    dragging = false;
    shell.classList.remove('is-resizing');
    if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
  };
  resizer.addEventListener('pointerup', stopDragging);
  resizer.addEventListener('pointercancel', stopDragging);
  resizer.addEventListener('keydown', (event) => {
    const current = Number(resizer.getAttribute('aria-valuenow')) || 24;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      setWidth(current + (event.key === 'ArrowRight' ? 2 : -2));
      event.preventDefault();
    } else if (event.key === 'Home') {
      setWidth(minimum);
      event.preventDefault();
    } else if (event.key === 'End') {
      setWidth(maximum);
      event.preventDefault();
    }
  });
})();
