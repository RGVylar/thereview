// Simple content script that listens for a page ping and replies so the page can detect
(function () {

  // Inject page-inject.js as early as possible
  function injectPageFlag() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('page-inject.js');
      s.onload = () => {
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
        window.postMessage({ type: 'THEREVIEW_EXTENSION_PONG', version: '0.1.0' }, '*');
      }
    } catch (err) {
      console.warn('thereview: pong failed', err);
    }
  }

  window.addEventListener('message', onMessage, false);

  // ── Relay: page ↔ background (sync session signalling) ───────────────────
  // Listens for postMessages from the thereview frontend and forwards them to
  // the background service worker, and vice-versa.

  window.addEventListener('message', (e) => {
    const t = e.data?.type;
    if (!t) return;

    // Frontend → background: user entered/left a session
    if (t === 'THEREVIEW_JOIN_SYNC') {
      chrome.runtime.sendMessage({ type: 'TR_JOIN_SYNC', sessionId: e.data.sessionId }).catch(() => {});
    } else if (t === 'THEREVIEW_LEAVE_SYNC') {
      chrome.runtime.sendMessage({ type: 'TR_LEAVE_SYNC' }).catch(() => {});

    // Frontend → background: remote playback event received from WS
    } else if (t === 'THEREVIEW_PLAYBACK_REMOTE') {
      chrome.runtime.sendMessage({
        type: 'TR_PLAYBACK_REMOTE',
        payload: { action: e.data.action, currentTime: e.data.currentTime },
      }).catch(() => {});
    }
  });

  // Background → page: relay local video event to the frontend page
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TR_RELAY_TO_PAGE') {
      window.postMessage({ type: 'THEREVIEW_PLAYBACK_LOCAL', ...msg.payload }, '*');
    } else if (msg.type === 'TR_RELAY_STATE_TO_PAGE') {
      window.postMessage({ type: 'THEREVIEW_PLAYBACK_STATE', ...msg.payload }, '*');
    }
  });

  // ── Debug: optional marker for DevTools ───────────────────────────────────
  try {
    const meta = document.createElement('meta');
    meta.name = 'thereview-extension';
    meta.content = 'installed';
    document.documentElement.appendChild(meta);
  } catch (e) {
    console.warn('thereview: cannot append meta', e);
  }
})();
