/**
 * Background service worker — routes messages between the thereview
 * session tab and TikTok/Twitter media tabs for playback synchronisation.
 *
 * Message protocol (chrome.runtime.sendMessage / chrome.tabs.sendMessage):
 *   content-script → background:
 *     TR_JOIN_SYNC   {sessionId}        — user entered a session page
 *     TR_LEAVE_SYNC  {}                 — user left the session page
 *     TR_PLAYBACK_LOCAL  {payload}      — local video event on media tab
 *     TR_PLAYBACK_STATE  {payload}      — actual media state on media tab
 *     TR_PLAYBACK_REMOTE {payload}      — remote playback received by frontend
 *     TR_STATUS      {}                 — popup asks for status
 *   background → content-script:
 *     TR_RELAY_TO_PAGE  {payload}       — tell thereview tab to forward to page
 *     TR_RELAY_STATE_TO_PAGE {payload}  — tell thereview tab the actual media state
 *     TR_PLAYBACK_APPLY {payload}       — tell media tab to control its video
 */

'use strict';

// Track tabs that currently have an active thereview session page.
const syncTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
});

// Clean up when the thereview tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  syncTabs.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fromTabId = sender.tab?.id;

  switch (msg.type) {

    // ── Frontend joined a session ────────────────────────────────────────────
    case 'TR_JOIN_SYNC':
      if (typeof fromTabId === 'number') {
        syncTabs.add(fromTabId);
      }
      sendResponse({ ok: true });
      break;

    // ── Frontend left the session ────────────────────────────────────────────
    case 'TR_LEAVE_SYNC':
      if (typeof fromTabId === 'number') {
        syncTabs.delete(fromTabId);
      }
      sendResponse({ ok: true });
      break;

    // ── Local video event (play/pause/seek on TikTok/Twitter) ───────────────
    // video-sync.js → background → all thereview tabs → frontend → WS → backend
    // Route to ALL syncTabs so that standalone TikTok/Twitter tabs (not embedded
    // as iframes) also deliver their events to the session page.
    case 'TR_PLAYBACK_LOCAL':
      syncTabs.forEach((tabId) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'TR_RELAY_TO_PAGE',
          payload: msg.payload,
        }).catch(() => {});
      });
      sendResponse({ ok: true });
      break;

    case 'TR_PLAYBACK_STATE':
      syncTabs.forEach((tabId) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'TR_RELAY_STATE_TO_PAGE',
          payload: msg.payload,
        }).catch(() => {});
      });
      sendResponse({ ok: true });
      break;

    // ── Remote playback event (from backend via frontend) ───────────────────
    // content-script on thereview tab → background → all media tabs
    case 'TR_PLAYBACK_REMOTE':
      // Apply remote playback only inside the same thereview tab that
      // received the websocket event (its embed iframe lives in this tab).
      if (typeof fromTabId === 'number') {
        chrome.tabs.sendMessage(fromTabId, {
          type: 'TR_PLAYBACK_APPLY',
          payload: msg.payload,
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;

    // ── Status query (popup) ─────────────────────────────────────────────────
    case 'TR_STATUS':
      sendResponse({ connected: syncTabs.size > 0, tabCount: syncTabs.size });
      break;

    default:
      break;
  }

  // Return true to allow async sendResponse where needed (TR_STATUS)
  return msg.type === 'TR_STATUS';
});
