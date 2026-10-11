(() => {
  function cleanEmailBody(value) {
    let source = String(value ?? '');
    if (!source.trim()) return '(Sin contenido visible)';

    // Conserva saltos habituales antes de convertir HTML a texto plano.
    source = source
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n');

    const wrapper = document.createElement('div');
    wrapper.innerHTML = source;
    let clean = wrapper.textContent || wrapper.innerText || source;

    // Gmail puede devolver Markdown procedente de firmas, imágenes y tablas.
    clean = clean
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/^\s*\|?[-: ]+\|[-:| ]+\s*$/gm, '')
      .replace(/^\s*\|/gm, '')
      .replace(/\|\s*$/gm, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return clean || '(Sin contenido visible)';
  }

  window.cleanEmailBody = cleanEmailBody;
})();
