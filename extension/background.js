/**
 * Background service worker — routes messages between the thereview
 * session tab and TikTok/Twitter media tabs for playback synchronisation.
 *
 * Message protocol (chrome.runtime.sendMessage / chrome.tabs.sendMessage):
 *   content-script → background:
 *     TR_JOIN_SYNC   {sessionId}        — user entered a session page
 *     TR_LEAVE_SYNC  {}                 — user left the session page
 *     TR_PLAYBACK_LOCAL  {payload}      — local video event on media tab
 *     TR_PLAYBACK_REMOTE {payload}      — remote playback received by frontend
 *     TR_STATUS      {}                 — popup asks for status
 *   background → content-script:
 *     TR_RELAY_TO_PAGE  {payload}       — tell thereview tab to forward to page
 *     TR_PLAYBACK_APPLY {payload}       — tell media tab to control its video
 */

'use strict';

// Tab ID of the thereview frontend tab currently in a sync session
let therereviewTabId = null;

chrome.runtime.onInstalled.addListener(() => {
});

// Clean up when the thereview tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === therereviewTabId) {
    therereviewTabId = null;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fromTabId = sender.tab?.id;

  switch (msg.type) {

    // ── Frontend joined a session ────────────────────────────────────────────
    case 'TR_JOIN_SYNC':
      therereviewTabId = fromTabId;
      sendResponse({ ok: true });
      break;

    // ── Frontend left the session ────────────────────────────────────────────
    case 'TR_LEAVE_SYNC':
      if (fromTabId === therereviewTabId) therereviewTabId = null;
      sendResponse({ ok: true });
      break;

    // ── Local video event (play/pause/seek on TikTok/Twitter) ───────────────
    // video-sync.js → background → thereview tab → frontend → WS → backend
    case 'TR_PLAYBACK_LOCAL':
      if (therereviewTabId) {
        chrome.tabs.sendMessage(therereviewTabId, {
          type: 'TR_RELAY_TO_PAGE',
          payload: msg.payload,
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;

    // ── Remote playback event (from backend via frontend) ───────────────────
    // content-script on thereview tab → background → all media tabs
    case 'TR_PLAYBACK_REMOTE':
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id === therereviewTabId) continue; // skip thereview tab itself
          chrome.tabs.sendMessage(tab.id, {
            type: 'TR_PLAYBACK_APPLY',
            payload: msg.payload,
          }).catch(() => {}); // silently skip tabs without content script
        }
      });
      sendResponse({ ok: true });
      break;

    // ── Status query (popup) ─────────────────────────────────────────────────
    case 'TR_STATUS':
      sendResponse({ connected: therereviewTabId !== null, tabId: therereviewTabId });
      break;

    default:
      break;
  }

  // Return true to allow async sendResponse where needed (TR_STATUS)
  return msg.type === 'TR_STATUS';
});
