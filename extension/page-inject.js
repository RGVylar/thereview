// Code executed in page context (loaded as external script to avoid CSP inline restrictions)
(function () {
  try {
    window.__THEREVIEW_EXTENSION_INSTALLED = true;
    window.__THEREVIEW_EXTENSION_VERSION = '0.1.0';

    // Dispatch a custom DOM event so the page can detect installation immediately
    try {
      const ev = new CustomEvent('thereview-extension-installed', {
        detail: { version: window.__THEREVIEW_EXTENSION_VERSION },
      });
      document.dispatchEvent(ev);
    } catch (err) {
      // ignore
    }

    // Optional: reply to pings originating from the page itself
    window.addEventListener('message', function (e) {
      try {
        if (e && e.data && e.data.type === 'THEREVIEW_EXTENSION_PING') {
          window.postMessage({ type: 'THEREVIEW_EXTENSION_PONG', version: window.__THEREVIEW_EXTENSION_VERSION }, '*');
        }
      } catch (err) {
        // ignore
      }
    });
  } catch (err) {
    // ignore
  }
})();
