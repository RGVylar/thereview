/**
 * embedProbe.js
 *
 * Utilities to probe whether cross-origin embed iframes (TikTok, Twitter/X)
 * accept postMessage handshakes. This helps determine if we can remotely
 * control play/pause via postMessage or if we must fall back to a local CTA.
 *
 * Usage (in app code):
 *   import { probeCurrentEmbed } from '$lib/embedProbe';
 *   const res = await probeCurrentEmbed();
 *
 * Quick console usage (paste in browser console on a session page):
 *   (async()=>{ const {found,supported,origin,data} = await probeCurrentEmbed(); console.log({found,supported,origin,data}); })();
 */

function _onceMessageFromWindow(win, matcher, timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    function handler(e) {
      if (e.source !== win) return;
      try {
        const data = e.data;
        if (matcher(data, e)) {
          done = true;
          window.removeEventListener('message', handler);
          clearTimeout(timer);
          resolve({ ok: true, data, origin: e.origin });
        }
      } catch (_) {}
    }
    window.addEventListener('message', handler);
    const timer = setTimeout(() => {
      if (!done) {
        window.removeEventListener('message', handler);
        resolve({ ok: false });
      }
    }, timeout);
  });
}

export async function probeIframe(iframeEl, { timeout = 1500 } = {}) {
  if (!iframeEl || !iframeEl.contentWindow) {
    return { supported: false, reason: 'no-iframe' };
  }
  const id = Math.random().toString(36).slice(2);
  const matcher = (data) => {
    try {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        return parsed && parsed.type === 'thereview_probe_ack' && parsed.id === id;
      } else if (data && data.type === 'thereview_probe_ack' && data.id === id) {
        return true;
      }
    } catch (err) {
      // ignore parse errors
    }
    return false;
  };

  const listener = _onceMessageFromWindow(iframeEl.contentWindow, matcher, timeout);
  try {
    // send both object and string forms in case the embed expects one or the other
    iframeEl.contentWindow.postMessage({ type: 'thereview_probe', id }, '*');
    iframeEl.contentWindow.postMessage(JSON.stringify({ type: 'thereview_probe', id }), '*');
  } catch (err) {
    // postMessage may throw in rare browser contexts; ignore
  }

  const res = await listener;
  return res.ok ? { supported: true, origin: res.origin, data: res.data } : { supported: false };
}

export async function probeCurrentEmbed({ timeout = 1500 } = {}) {
  const sel = 'iframe[src*="tiktok.com"],iframe[src*="tiktokv.com"],iframe[src*="twitter.com"],iframe[src*="x.com"]';
  const iframeEl = document.querySelector(sel);
  if (!iframeEl) return { found: false };
  const res = await probeIframe(iframeEl, { timeout });
  return Object.assign({ found: true, iframeSelector: sel }, res);
}

export async function probeUrl(url, { timeout = 2500 } = {}) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.src = url;
    document.body.appendChild(iframe);
    (async () => {
      const res = await probeIframe(iframe, { timeout });
      document.body.removeChild(iframe);
      resolve(res);
    })();
  });
}

// End of embedProbe.js
