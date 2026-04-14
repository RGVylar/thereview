/**
 * video-sync.js — Content script for TikTok and Twitter/X
 *
 * Responsibilities:
 *   1. Detect <video> elements (including those added dynamically).
 *   2. Listen for play/pause/seeked events and relay them to the background
 *      so they can be forwarded to the thereview session WebSocket.
 *   3. Receive remote playback commands from the background and apply them
 *      to the current video, avoiding feedback loops via isSyncing flag.
 */
(function () {
  'use strict';

  // Prevents feedback loop: when we programmatically play/pause/seek,
  // the resulting events must not be re-sent as local events.
  let isSyncing = false;

  // WeakSet to avoid attaching duplicate listeners to the same element.
  const attached = new WeakSet();

  /**
   * Apply a remote playback command to a video element.
   * Sets isSyncing to true during the operation and clears it after 300 ms
   * to absorb any events the browser fires in response.
   */
  function applyRemote(video, payload) {
    isSyncing = true;
    try {
      const { action, currentTime } = payload;
      if (action === 'seek' || action === 'play') {
        if (typeof currentTime === 'number' && Math.abs(video.currentTime - currentTime) > 0.5) {
          video.currentTime = currentTime;
        }
      }
      if (action === 'play') {
        video.play().catch(() => {});
      } else if (action === 'pause') {
        video.pause();
      }
    } finally {
      setTimeout(() => { isSyncing = false; }, 300);
    }
  }

  /**
   * Attach play/pause/seeked listeners to a video element.
   * Sends TR_PLAYBACK_LOCAL to background on each event (unless we are
   * in the middle of applying a remote command).
   */
  function attachToVideo(video) {
    if (attached.has(video)) return;
    attached.add(video);

    for (const evt of ['play', 'pause', 'seeked']) {
      video.addEventListener(evt, () => {
        const action = evt === 'seeked' ? 'seek' : evt;
        chrome.runtime.sendMessage({
          type: 'TR_PLAYBACK_STATE',
          payload: { playing: !video.paused, currentTime: video.currentTime },
        }).catch(() => {});
        if (isSyncing) return;
        chrome.runtime.sendMessage({
          type: 'TR_PLAYBACK_LOCAL',
          payload: { action, currentTime: video.currentTime },
        }).catch(() => {});
      });
    }
  }

  /** Scan the DOM for any <video> we haven't attached to yet. */
  function scanVideos() {
    document.querySelectorAll('video').forEach(attachToVideo);
  }

  async function probeAutoplay(video) {
    const wasPaused = video.paused;
    const previousTime = video.currentTime;
    try {
      await video.play();
      if (wasPaused) {
        video.pause();
        if (Math.abs(video.currentTime - previousTime) > 0.05) {
          video.currentTime = previousTime;
        }
      }
      try {
        window.parent.postMessage({ type: 'THEREVIEW_AUTOPLAY_PROBE_RESULT', ready: true }, '*');
      } catch (_) {}
    } catch (_) {
      try {
        window.parent.postMessage({ type: 'THEREVIEW_AUTOPLAY_PROBE_RESULT', ready: false }, '*');
      } catch (_) {}
    }
  }

  // TikTok and Twitter/X render video elements on navigation without a full
  // page reload, so we need a MutationObserver to catch them.
  const observer = new MutationObserver(scanVideos);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanVideos();

  // Receive remote playback commands forwarded by background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'TR_PLAYBACK_APPLY') return;
    // Apply to the first visible video (the "active" one in the viewport)
    const videos = Array.from(document.querySelectorAll('video'));
    const target = videos.find((v) => !v.paused || msg.payload.action === 'pause') ?? videos[0];
    if (target) applyRemote(target, msg.payload);
  });

  // Also accept postMessage from parent thereview page when running inside
  // an embed iframe: parent can post { type: 'THEREVIEW_PLAYBACK_REMOTE', action, currentTime }
  window.addEventListener('message', (e) => {
    try {
      if (!e?.data) return;
      if (e.data.type === 'THEREVIEW_AUTOPLAY_PROBE') {
        const videos = Array.from(document.querySelectorAll('video'));
        const target = videos[0];
        if (!target) {
          window.parent.postMessage({ type: 'THEREVIEW_AUTOPLAY_PROBE_RESULT', ready: false, pending: true }, '*');
          return;
        }
        probeAutoplay(target);
        return;
      }
      if (e.data.type !== 'THEREVIEW_PLAYBACK_REMOTE') return;
      const videos = Array.from(document.querySelectorAll('video'));
      const target = videos.find((v) => !v.paused) ?? videos[0];
      if (target) applyRemote(target, { action: e.data.action, currentTime: e.data.currentTime });
    } catch (err) {
      // ignore
    }
  });
})();
