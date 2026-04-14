const statusEl = document.getElementById('status');

chrome.runtime.sendMessage({ type: 'TR_STATUS' }, (res) => {
  if (chrome.runtime.lastError || !res) {
    statusEl.textContent = '⚠️ No se pudo contactar con el worker.';
    statusEl.style.background = '#ffe5e5';
    return;
  }
  if (res.connected) {
    statusEl.innerHTML = `✅ <strong>Sincronizado</strong> — ${res.tabCount} pestaña(s) activa(s)`;
    statusEl.style.background = '#e5ffe9';
  } else {
    statusEl.textContent = '🔴 Sin sesión activa. Abre una sesión en The Review.';
    statusEl.style.background = '#fff3cd';
  }
});
