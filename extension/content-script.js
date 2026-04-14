// Simple content script that listens for a page ping and replies so the page can detect
(function () {
  console.debug('thereview extension content-script injected');

  function onMessage(e) {
    if (!e || !e.data) return;
    try {
      if (e.data.type === 'THEREVIEW_EXTENSION_PING') {
        window.postMessage({ type: 'THEREVIEW_EXTENSION_PONG', version: '0.1.0' }, '*');
      }
    } catch (err) {
      // ignore
    }
  }

  window.addEventListener('message', onMessage, false);

  // Optional marker for debugging
  try {
    const meta = document.createElement('meta');
    meta.name = 'thereview-extension';
    meta.content = 'installed';
    document.documentElement.appendChild(meta);
  } catch (e) {}
})();
