(() => {
  if (window.__commercialNavDataPromise) return;

  const cacheKey = 'commercial-nav-counts-v4';
  const cacheTtlMs = 30_000;

  function readCache() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      return cached && cached.expiresAt > Date.now() ? cached.data : null;
    } catch {
      return null;
    }
  }

  function writeCache(data) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ data, expiresAt: Date.now() + cacheTtlMs }));
    } catch {
      // La caché es solo una optimización; si el navegador la bloquea, seguimos con la red.
    }
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el contador.');
    return data;
  }

  const cached = readCache();
  const dataPromise = cached ? Promise.resolve(cached) : fetchJson('/gmail/nav-counts').then((data) => {
    writeCache(data);
    return data;
  });

  window.__commercialNavDataPromise = dataPromise;

  function setCount(selector, value) {
    const node = document.querySelector(selector);
    if (node && value !== null && value !== undefined) {
      node.textContent = String(value);
      node.hidden = false;
    }
  }

  function applyCounts(data) {
    setCount('#navMessageCount', data.messageCount ?? data.messages?.count);
    setCount('#navFollowUpCount', data.followUpCount ?? data.followUps?.count);
    setCount('#navCommitmentCount', data.commitmentCount ?? data.commitments?.count);
  }

  const applyWhenReady = () => dataPromise.then(applyCounts).catch(() => undefined);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyWhenReady, { once: true });
  } else {
    applyWhenReady();
  }
})();
