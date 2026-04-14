// Simple content script that listens for a page ping and replies so the page can detect
(function () {
  console.debug('thereview extension content-script injected');

  // Inject a small inline script into the page context so it's visible from page JS
  function injectPageFlag() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('page-inject.js');
      s.onload = () => {
        console.debug('thereview: page-inject.js loaded');
        s.remove();
      };
      (document.head || document.documentElement).appendChild(s);
    } catch (err) {
      console.warn('thereview: cannot inject page script', err);
    }
  }

  injectPageFlag();

  function onMessage(e) {
    if (!e?.data) return;
    try {
      if (e.data.type === 'THEREVIEW_EXTENSION_PING') {
        window.postMessage({ type: 'THEREVIEW_EXTENSION_PONG', version: '0.1.0' }, '*');
      }
    } catch (err) {
      console.warn('thereview: pong failed', err);
    }
  }

  window.addEventListener('message', onMessage, false);

  // Optional marker for debugging (DOM)
  try {
    const meta = document.createElement('meta');
    meta.name = 'thereview-extension';
    meta.content = 'installed';
    document.documentElement.appendChild(meta);
  } catch (e) {
    console.warn('thereview: cannot append meta', e);
  }
})();
