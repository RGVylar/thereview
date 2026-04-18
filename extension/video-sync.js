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
  // Counter instead of boolean so overlapping applyRemote calls don't
  // prematurely clear the guard (race condition with 300 ms timeout).
  let isSyncingCount = 0;

  // WeakSet to avoid attaching duplicate listeners to the same element.
  const attached = new WeakSet();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40;
  }

  function getPrimaryVideo(preferPlaying = false) {
    const videos = Array.from(document.querySelectorAll('video')).filter(isVisible);
    if (!videos.length) return null;
    if (preferPlaying) {
      const active = videos.find((video) => !video.paused);
      if (active) return active;
    }
    return videos.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
    })[0];
  }

  function clickVisiblePlayButton() {
    const selectors = [
      'button[aria-label*="Play" i]',
      'button[title*="Play" i]',
      'button[data-e2e*="play" i]',
      '[role="button"][aria-label*="Play" i]',
      '[class*="play" i] button',
      'button'
    ];
    for (const selector of selectors) {
      const button = Array.from(document.querySelectorAll(selector)).find((candidate) => {
        if (!isVisible(candidate)) return false;
        const label = [candidate.getAttribute('aria-label'), candidate.getAttribute('title'), candidate.textContent]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return selector === 'button' ? /play|resume|reproducir/.test(label) : true;
      });
      if (button) {
        button.click();
        return true;
      }
    }
    return false;
  }

  async function requestPlay(video) {
    try {
      await video.play();
      return true;
    } catch (_) {}

    // Muted media can always be played programmatically regardless of autoplay
    // policy. TikTok embeds are already muted via URL param (mute=1) so this
    // doesn't change the audible experience — it just unblocks the browser.
    const wasMuted = video.muted;
    video.muted = true;
    try {
      await video.play();
      return true;
    } catch (_) {
      video.muted = wasMuted;
    }

    // Last resort: synthetic click on the video element (TikTok player handles it)
    try {
      video.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 150));
      if (!video.paused) return true;
    } catch (_) {}

    return clickVisiblePlayButton();
  }

  /**
   * Apply a remote playback command to a video element.
   * Sets isSyncing to true during the operation and clears it after 300 ms
   * to absorb any events the browser fires in response.
   */
  function applyRemote(video, payload) {
    isSyncingCount++;
    try {
      const { action, currentTime } = payload;
      if (action === 'seek' || action === 'play') {
        if (typeof currentTime === 'number' && Math.abs(video.currentTime - currentTime) > 0.5) {
          video.currentTime = currentTime;
        }
      }
      if (action === 'play') {
        requestPlay(video).catch(() => {});
      } else if (action === 'pause') {
        video.pause();
      }
    } finally {
      setTimeout(() => { isSyncingCount = Math.max(0, isSyncingCount - 1); }, 300);
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
        if (isSyncingCount > 0) return;
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
      await requestPlay(video);
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
    const target = getPrimaryVideo(msg.payload.action === 'pause' || msg.payload.action === 'play');
    if (target) applyRemote(target, msg.payload);
  });

  // Also accept postMessage from parent thereview page when running inside
  // an embed iframe: parent can post { type: 'THEREVIEW_PLAYBACK_REMOTE', action, currentTime }
  window.addEventListener('message', (e) => {
    try {
      if (!e?.data) return;
      if (e.data.type === 'THEREVIEW_AUTOPLAY_PROBE') {
        const target = getPrimaryVideo(false);
        if (!target) {
          window.parent.postMessage({ type: 'THEREVIEW_AUTOPLAY_PROBE_RESULT', ready: false, pending: true }, '*');
          return;
        }
        probeAutoplay(target);
        return;
      }
      if (e.data.type !== 'THEREVIEW_PLAYBACK_REMOTE') return;
      const target = getPrimaryVideo(e.data.action === 'pause' || e.data.action === 'play');
      if (target) applyRemote(target, { action: e.data.action, currentTime: e.data.currentTime });
    } catch (err) {
      // ignore
    }
  });
})();
