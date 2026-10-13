(() => {
  const trigger = document.querySelector('#helpToggle');
  const closeButton = document.querySelector('#helpClose');
  const panel = document.querySelector('#helpPanel');
  const overlay = document.querySelector('#helpOverlay');
  const search = document.querySelector('#helpSearch');
  const sections = [...document.querySelectorAll('.help-section')];
  const navigation = [...document.querySelectorAll('[data-help-target]')];
  if (!trigger || !closeButton || !panel || !overlay || !search) return;

  const close = () => {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    overlay.hidden = true;
    document.body.classList.remove('help-open');
    trigger.focus();
  };

  const open = () => {
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    overlay.hidden = false;
    document.body.classList.add('help-open');
    closeButton.focus();
  };

  trigger.addEventListener('click', () => {
    if (panel.classList.contains('is-open')) close();
    else open();
  });
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', close);
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    sections.forEach((section) => {
      section.hidden = Boolean(query) && !section.textContent.toLowerCase().includes(query);
    });
  });
  navigation.forEach((button) => {
    button.addEventListener('click', () => {
      search.value = '';
      sections.forEach((section) => { section.hidden = false; });
      document.querySelector('#' + button.dataset.helpTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panel.classList.contains('is-open')) close();
  });
})();
