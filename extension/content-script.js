// Simple content script that listens for a page ping and replies so the page can detect
(function () {
  console.debug('thereview extension content-script injected at document_start');

  // Inject page-inject.js as early as possible
  function injectPageFlag() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('page-inject.js');
      s.onload = () => {
        console.debug('thereview: page-inject.js loaded and executed');
        s.remove();
      };
      s.onerror = () => {
        console.warn('thereview: page-inject.js failed to load');
      };
      // Inject into head as early as possible
      if (document.head) {
        document.head.insertBefore(s, document.head.firstChild);
      } else {
        document.documentElement.appendChild(s);
      }
    } catch (err) {
      console.warn('thereview: cannot inject page script', err);
    }
  }

  // Try to inject immediately
  if (document.head || document.documentElement) {
    injectPageFlag();
  } else {
    // If DOM not ready yet, wait for it
    document.addEventListener('DOMContentLoaded', injectPageFlag, { once: true });
  }

  // Listen for pings from page and reply
  function onMessage(e) {
    if (!e?.data) return;
    try {
      if (e.data.type === 'THEREVIEW_EXTENSION_PING') {
        console.debug('thereview: received PING, sending PONG');
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
    console.debug('thereview: meta tag added');
  } catch (e) {
    console.warn('thereview: cannot append meta', e);
  }
})();
