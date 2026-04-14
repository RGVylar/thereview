// Code executed in page context (loaded as external script to avoid CSP inline restrictions)
(function () {
  try {
    console.debug('thereview: page-inject.js executing in page context');
    
    // Set global flag immediately and persistently
    window.__THEREVIEW_EXTENSION_INSTALLED = true;
    window.__THEREVIEW_EXTENSION_VERSION = '0.1.0';
    console.debug('thereview: window.__THEREVIEW_EXTENSION_INSTALLED =', window.__THEREVIEW_EXTENSION_INSTALLED);

    // Dispatch custom event multiple times to ensure page listeners catch it
    function dispatchEvent() {
      try {
        const ev = new CustomEvent('thereview-extension-installed', {
          detail: { version: window.__THEREVIEW_EXTENSION_VERSION },
          bubbles: true,
          cancelable: true,
        });
        console.debug('thereview: dispatching thereview-extension-installed event');
        document.dispatchEvent(ev);
        window.dispatchEvent(ev);
      } catch (err) {
        console.warn('thereview: event dispatch failed', err);
      }
    }

    // Dispatch immediately
    dispatchEvent();

    // Also dispatch after a small delay in case listeners aren't ready yet
    setTimeout(dispatchEvent, 100);
    setTimeout(dispatchEvent, 300);

    // Reply to pings originating from the page
    window.addEventListener('message', function (e) {
      try {
        if (e && e.data && e.data.type === 'THEREVIEW_EXTENSION_PING') {
          console.debug('thereview page-inject: received PING, sending PONG');
          window.postMessage({ type: 'THEREVIEW_EXTENSION_PONG', version: window.__THEREVIEW_EXTENSION_VERSION }, '*');
        }
      } catch (err) {
        console.warn('thereview page-inject: pong reply failed', err);
      }
    });
  } catch (err) {
    console.error('thereview page-inject: critical error', err);
  }
})();
