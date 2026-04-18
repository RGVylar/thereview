/**
 * tiktok-import.js — Content script for TikTok pages
 *
 * Injects a floating "Import to The Review" panel when the user is browsing
 * any TikTok page that contains video links (profile liked tab, favourites,
 * following feed, etc.).
 *
 * Flow:
 *   1. Detect video links on the page
 *   2. Show a floating panel with an "Import" button
 *   3. On click: auto-scroll to load all videos, collect URLs via
 *      MutationObserver (handles TikTok's virtual DOM recycling)
 *   4. Batch-POST to The Review backend using the token saved by content-script.js
 *   5. Show result summary
 */
(function () {
  'use strict';

  const VIDEO_RE = /tiktok\.com\/@[^/?#]+\/video\/\d+/;

  function canonicalUrl(href) {
    const m = href && href.match(/tiktok\.com\/(@[^/?#]+\/video\/\d+)/);
    return m ? `https://www.tiktok.com/${m[1]}` : null;
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  let panel = null;
  let statusEl = null;
  let importBtn = null;
  let countEl = null;
  let isImporting = false;

  function createPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'thereview-import-panel';

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      background: '#0f0f1a',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '14px',
      padding: '14px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      color: '#f0f0f0',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      minWidth: '210px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      lineHeight: '1.4',
    });

    const title = document.createElement('div');
    title.textContent = '🍿 The Review';
    Object.assign(title.style, { fontWeight: '700', fontSize: '14px' });

    countEl = document.createElement('div');
    countEl.textContent = '';
    Object.assign(countEl.style, { color: '#888', fontSize: '11px' });

    statusEl = document.createElement('div');
    statusEl.textContent = 'Listo para importar';
    Object.assign(statusEl.style, { color: '#aaa', fontSize: '12px' });

    importBtn = document.createElement('button');
    importBtn.textContent = '📥 Importar a The Review';
    Object.assign(importBtn.style, {
      background: '#e53e3e',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '8px 12px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      marginTop: '2px',
    });
    importBtn.addEventListener('click', startImport);

    wrap.appendChild(title);
    wrap.appendChild(countEl);
    wrap.appendChild(statusEl);
    wrap.appendChild(importBtn);
    panel.appendChild(wrap);
    document.body.appendChild(panel);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  // ── URL collection + auto-scroll ──────────────────────────────────────────

  async function collectAllUrls(onProgress) {
    const collected = new Set();

    function harvest() {
      document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
        const canon = canonicalUrl(a.href);
        if (canon) collected.add(canon);
      });
    }

    const obs = new MutationObserver(harvest);
    obs.observe(document.body, { childList: true, subtree: true });
    harvest();

    await new Promise((resolve) => {
      let prev = -1;
      let stuck = 0;

      const tick = setInterval(() => {
        harvest();
        window.scrollTo(0, document.body.scrollHeight);
        onProgress(collected.size);

        if (collected.size === prev) {
          stuck++;
          if (stuck >= 6) { // ~4.8 s with no new content → assume end
            clearInterval(tick);
            resolve();
          }
        } else {
          stuck = 0;
          prev = collected.size;
        }
      }, 800);
    });

    obs.disconnect();
    return [...collected];
  }

  // ── Batch import ──────────────────────────────────────────────────────────

  async function batchImport(urls, token, serverUrl) {
    const res = await fetch(`${serverUrl}/api/memes/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ urls }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json(); // { imported, skipped, failed }
  }

  // ── Main flow ─────────────────────────────────────────────────────────────

  async function startImport() {
    if (isImporting) return;
    isImporting = true;
    importBtn.disabled = true;
    importBtn.textContent = '⏳ Importando…';

    try {
      const stored = await chrome.storage.local.get('thereview_auth');
      const auth = stored.thereview_auth;

      if (!auth?.token) {
        setStatus('⚠️ Abre The Review en otra pestaña e inicia sesión primero.');
        return;
      }

      setStatus('Haciendo scroll para cargar todos los vídeos…');

      const urls = await collectAllUrls((n) => {
        setStatus(`Recogiendo… ${n} vídeos encontrados`);
      });

      if (!urls.length) {
        setStatus('No se encontraron vídeos en esta página.');
        return;
      }

      setStatus(`Importando ${urls.length} vídeos…`);
      const { imported, skipped, failed } = await batchImport(urls, auth.token, auth.serverUrl);

      const parts = [`✅ ${imported} importados`];
      if (skipped) parts.push(`${skipped} ya existían`);
      if (failed) parts.push(`⚠️ ${failed} errores`);
      setStatus(parts.join(' · '));
      importBtn.textContent = '✅ Hecho';
    } catch (err) {
      setStatus(`❌ Error: ${err.message}`);
      importBtn.disabled = false;
      importBtn.textContent = '📥 Importar a The Review';
    } finally {
      isImporting = false;
    }
  }

  // ── Passive counter: keep a live count visible while browsing ─────────────

  const passiveCollected = new Set();

  function passiveHarvest() {
    document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
      const canon = canonicalUrl(a.href);
      if (canon) passiveCollected.add(canon);
    });
    if (countEl && passiveCollected.size) {
      countEl.textContent = `${passiveCollected.size} vídeos visibles`;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  // TikTok is a SPA — watch for videos appearing after navigation
  const initObs = new MutationObserver(() => {
    passiveHarvest();
    if (document.querySelector('a[href*="/video/"]') && !panel) {
      createPanel();
    }
  });

  function init() {
    initObs.observe(document.documentElement, { childList: true, subtree: true });
    passiveHarvest();
    if (document.querySelector('a[href*="/video/"]')) createPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
