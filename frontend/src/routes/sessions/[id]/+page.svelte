<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { detectEmbed } from '$lib/embed.js';

	let authVal;
	auth.subscribe((v) => (authVal = v));

	let pageVal;
	page.subscribe((v) => (pageVal = v));

	let session = $state(null);
	let votes = $state([]);
	let ranking = $state([]);
	let currentIndex = $state(0);
	let error = $state('');
	let view = $state('presentation'); // 'presentation' | 'ranking'
	let resultTab = $state('top'); // 'top' | 'bottom' | 'players'

	// Cache for Twitter oEmbed HTML keyed by meme_id
	let twitterEmbeds = $state({});

	// WebSocket
	let ws = $state(null);
	let connectedUsers = $state(0);
	let syncMessage = $state('');

	// Extension sync: listener for local video events relayed from extension
	let extPlaybackHandler = null;

	// Timer
	let elapsed = $state('00:00');
	let timerInterval = $state(null);

	// Ready system (PENDING state)
	let readyUserIds = $state([]);

	// Per-user playback state keyed by user_id: { playing: bool }
	let playbackStates = $state({});
	let autoplayReady = $state(null);

	// Media download status keyed by meme_id: "pending" | "ready" | "failed"
	let mediaStatus = $state({});
	let mediaPoller = null;
	let dlLiveProgress = $state(null); // real-time {downloaded_bytes, total_bytes, speed_bps, active_count}
	let dlStartedAt = $state(null);   // Date when downloads started
	let dlElapsed = $state(0);        // seconds elapsed
	let dlElapsedTimer = null;

	// mediaStatus values are now {status, meta?} objects
	let dlTotal     = $derived(Object.keys(mediaStatus).filter(k => k !== '_progress').length);
	let dlReady     = $derived(Object.values(mediaStatus).filter(s => s?.status === 'ready').length);
	let dlFailed    = $derived(Object.values(mediaStatus).filter(s => s?.status === 'failed').length);
	let dlSlideshow = $derived(Object.values(mediaStatus).filter(s => s?.status === 'slideshow').length);
	let dlPending   = $derived(Object.values(mediaStatus).filter(s => s?.status === 'pending').length);
	let dlSettled   = $derived(dlTotal > 0 && dlPending === 0);
	let dlPct       = $derived(dlTotal > 0 ? Math.round(((dlReady + dlFailed + dlSlideshow) / dlTotal) * 100) : 0);

	// Estimated time remaining based on current speed and remaining bytes
	let dlEta = $derived(() => {
		const p = dlLiveProgress;
		if (!p || p.speed_bps <= 0 || p.total_bytes <= 0) return null;
		const remaining = p.total_bytes - p.downloaded_bytes;
		if (remaining <= 0) return null;
		const secs = Math.round(remaining / p.speed_bps);
		if (secs < 60) return `~${secs}s`;
		return `~${Math.ceil(secs / 60)}min`;
	});

	function formatElapsed(secs) {
		const m = Math.floor(secs / 60);
		const s = secs % 60;
		return m > 0 ? `${m}m ${s}s` : `${s}s`;
	}

	function formatBytes(bytes) {
		if (!bytes || bytes <= 0) return '0 MB';
		if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + ' GB';
		return (bytes / 1_048_576).toFixed(1) + ' MB';
	}
	function formatSpeed(bps) {
		if (!bps || bps <= 0) return '';
		if (bps >= 1_048_576) return (bps / 1_048_576).toFixed(1) + ' MB/s';
		return (bps / 1024).toFixed(0) + ' KB/s';
	}

	// Reference to the currently mounted local <video> element (if any).
	// Managed by the localVideoSync Svelte action.
	let localVideoEl = null;
	let localVideoMuted = $state(false);

	/**
	 * Svelte action for local <video> elements (served from our own backend).
	 * Handles:
	 *   • Autoplay with sound (muted→play→unmute fallback when gesture is stale)
	 *   • Sending play/pause/seek events directly to the WebSocket
	 *   • Receiving remote commands from the WS handler
	 */
	function localVideoSync(node) {
		localVideoEl = node;
		let suppressed = false; // true while we are applying a remote command
		let audioSetup = false;
		let audioCtx = null;

		// ── Audio normalisation via Web Audio DynamicsCompressor ──────────────
		function setupAudio() {
			if (audioSetup) return;
			audioSetup = true;
			try {
				audioCtx = new (window.AudioContext || window.webkitAudioContext)();
				const src = audioCtx.createMediaElementSource(node);
				const comp = audioCtx.createDynamicsCompressor();
				comp.threshold.value = -24;
				comp.knee.value       = 30;
				comp.ratio.value      = 12;
				comp.attack.value     = 0.003;
				comp.release.value    = 0.25;
				src.connect(comp);
				comp.connect(audioCtx.destination);
				audioCtx.resume().catch(() => {});
			} catch { /* Web Audio not available */ }
		}

		// ── Autoplay ──────────────────────────────────────────────────────────
		node.play().catch(() => {
			// Browser blocked unmuted autoplay → play muted first, then unmute.
			// Once a video is playing (even muted), setting muted=false is always allowed.
			node.muted = true;
			node.play()
				.then(() => { node.muted = false; })
				.catch(() => { node.muted = false; });
		});

		// ── Local → WS ────────────────────────────────────────────────────────
		function sendPlayback(action) {
			if (suppressed) return;
			const uid = authVal?.user?.id;
			if (uid) {
				playbackStates = { ...playbackStates, [uid]: { playing: !node.paused, currentTime: node.currentTime } };
			}
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'playback', action, currentTime: node.currentTime }));
			}
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'playback_state', playing: !node.paused, currentTime: node.currentTime }));
			}
		}

		function sendMuteState() {
			if (suppressed) return;
			localVideoMuted = node.muted;
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'playback', action: node.muted ? 'mute' : 'unmute' }));
			}
		}

		const onPlay        = () => { setupAudio(); sendPlayback('play'); };
		const onPause       = () => sendPlayback('pause');
		const onSeeked      = () => sendPlayback('seek');
		const onVolumeChange = () => sendMuteState();

		node.addEventListener('play',         onPlay);
		node.addEventListener('pause',        onPause);
		node.addEventListener('seeked',       onSeeked);
		node.addEventListener('volumechange', onVolumeChange);

		// Track initial muted state (may be muted if autoplay required it)
		localVideoMuted = node.muted;

		// ── Remote → video ────────────────────────────────────────────────────
		node._applyRemote = ({ action, currentTime }) => {
			suppressed = true;
			if (typeof currentTime === 'number' && Math.abs(node.currentTime - currentTime) > 0.5) {
				node.currentTime = currentTime;
			}
			if (action === 'play') {
				node.play().catch(() => {
					node.muted = true;
					node.play().then(() => { node.muted = false; }).catch(() => {});
				});
			} else if (action === 'pause') {
				node.pause();
			} else if (action === 'mute') {
				node.muted = true;
				localVideoMuted = true;
			} else if (action === 'unmute') {
				node.muted = false;
				localVideoMuted = false;
			}
			setTimeout(() => { suppressed = false; }, 300);
		};

		return {
			destroy() {
				node.removeEventListener('play',         onPlay);
				node.removeEventListener('pause',        onPause);
				node.removeEventListener('seeked',       onSeeked);
				node.removeEventListener('volumechange', onVolumeChange);
				delete node._applyRemote;
				if (localVideoEl === node) localVideoEl = null;
				localVideoMuted = false;
				if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
			}
		};
	}

	// True when someone else is playing but the local user isn't yet.
	// Based purely on received WS events — no reliance on browser error signals.
	let outOfSync = $derived.by(() => {
		const myId = authVal.user?.id;
		if (!myId) return false;
		const myPlaying = playbackStates[myId]?.playing ?? false;
		if (myPlaying) return false;
		return Object.entries(playbackStates).some(
			([uid, s]) => Number(uid) !== myId && s.playing
		);
	});

	function startTimer(startedAt) {
		if (timerInterval) clearInterval(timerInterval);
		if (!startedAt) return;
		const start = new Date(startedAt).getTime();
		function tick() {
			const diff = Math.floor((Date.now() - start) / 1000);
			const h = Math.floor(diff / 3600);
			const m = Math.floor((diff % 3600) / 60);
			const s = diff % 60;
			elapsed = h > 0
				? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
				: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		}
		tick();
		timerInterval = setInterval(tick, 1000);
	}

	let _wsReconnectTimer = null;
	let _wsConnecting = false; // guard against duplicate connections

	function connectWs(sessionId, token) {
		// Avoid opening a second socket while one is already connecting/open
		if (_wsConnecting) return;
		if (ws && ws.readyState === WebSocket.OPEN) return;
		if (ws) { ws.close(); ws = null; }
		_wsConnecting = true;
		if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }

		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${location.host}/api/sessions/${sessionId}/ws?token=${encodeURIComponent(token)}`;
		const socket = new WebSocket(url);

		socket.onopen = () => {
			_wsConnecting = false;
			socket._opened = true;
			syncMessage = '';
			// Tell the extension which session we joined so it can route video events
			window.postMessage({ type: 'THEREVIEW_JOIN_SYNC', sessionId }, '*');
			// Listen for local video events relayed from extension → send via WS
			if (extPlaybackHandler) window.removeEventListener('message', extPlaybackHandler);
			extPlaybackHandler = (e) => {
				const type = e.data?.type;
				if (!type) return;
				const uid = authVal.user?.id;
				if (type === 'THEREVIEW_AUTOPLAY_PROBE_RESULT') {
					if (!e.data.pending) autoplayReady = !!e.data.ready;
					return;
				}
				if (type === 'THEREVIEW_PLAYBACK_STATE') {
					if (uid) {
						playbackStates = {
							...playbackStates,
							[uid]: { playing: !!e.data.playing, currentTime: e.data.currentTime }
						};
					}
					if (socket.readyState === WebSocket.OPEN) {
						socket.send(JSON.stringify({
							type: 'playback_state',
							playing: !!e.data.playing,
							currentTime: e.data.currentTime,
						}));
					}
					return;
				}
				if (type !== 'THEREVIEW_PLAYBACK_LOCAL') return;
				if (socket.readyState !== WebSocket.OPEN) return;
				socket.send(JSON.stringify({
					type: 'playback',
					action: e.data.action,
					currentTime: e.data.currentTime,
				}));
			};
			window.addEventListener('message', extPlaybackHandler);
		};

		socket.onmessage = async (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === 'start') {
					loadSession();
				} else if (msg.type === 'navigate') {
					currentIndex = msg.index;
					nextVoters = [];
					playbackStates = {};
					autoplayReady = null;
					if (session) savePosition(session.id, msg.index);
				} else if (msg.type === 'vote') {
					// Update local votes from remote
					votes = votes.filter(
						(v) => !(v.meme_id === msg.meme_id && v.user_id === msg.user_id)
					);
					votes = [...votes, {
						id: 0,
						user_id: msg.user_id,
						meme_id: msg.meme_id,
						session_id: sessionId,
						value: msg.value,
						created_at: new Date().toISOString()
					}];
				} else if (msg.type === 'finish') {
					loadSession();
				} else if (msg.type === 'ready') {
					if (!readyUserIds.includes(msg.user_id)) {
						readyUserIds = [...readyUserIds, msg.user_id];
					}
				} else if (msg.type === 'fun_tap') {
					playEmojiSound(msg.emoji);
					emojiCounts = { ...emojiCounts, [msg.emoji]: (emojiCounts[msg.emoji] || 0) + 1 };
					if (session?.id) _saveEmojiCounts(session.id, emojiCounts);
					spawnEmoji(msg.emoji, msg.user);
				} else if (msg.type === 'show_ranking') {
					ranking = await api(`/api/sessions/${session.id}/votes/ranking?top=5&bottom=5`, { token: authVal.token });
					startPlayoffOrRanking();
				} else if (msg.type === 'note_update') {
					noteText = msg.text;
				} else if (msg.type === 'next_vote') {
					if (!nextVoters.includes(msg.user_id)) {
						nextVoters = [...nextVoters, msg.user_id];
					}
					const sm = session?.session_memes?.[currentIndex];
					const isOwner = sm?.meme.user_id === msg.user_id;
					const allAgreed = isOwner || session.participants.every(p => nextVoters.includes(p.id));
					if (allAgreed) {
						nextVoters = [];
						next();
					}
				} else if (msg.type === 'play_sync') {
					// legacy — absorbed by playback system
				} else if (msg.type === 'playback') {
					// Local <video> (downloaded): control directly
					if (localVideoEl?._applyRemote) {
						localVideoEl._applyRemote({ action: msg.action, currentTime: msg.currentTime });
					} else {
						// Embedded iframe (TikTok/Twitter not yet downloaded): relay via postMessage
						try {
							const iframe = document.querySelector('.sync-media-wrap iframe');
							if (iframe?.contentWindow) {
								iframe.contentWindow.postMessage({ type: 'THEREVIEW_PLAYBACK_REMOTE', action: msg.action, currentTime: msg.currentTime }, '*');
							} else {
								window.postMessage({ type: 'THEREVIEW_PLAYBACK_REMOTE', action: msg.action, currentTime: msg.currentTime }, '*');
							}
						} catch (e) {}
					}
				} else if (msg.type === 'playback_state') {
					if (msg.user_id) {
						playbackStates = {
							...playbackStates,
							[msg.user_id]: { playing: !!msg.playing, currentTime: msg.currentTime }
						};
					}
				} else if (msg.type === 'cursor') {
					const color = CURSOR_COLORS[msg.user_id % CURSOR_COLORS.length];
					otherCursors = { ...otherCursors, [msg.user_id]: { x: msg.x, y: msg.y, user: msg.user, color } };
				} else if (msg.type === 'playoff_vote') {
					const pv = playoffVotes[msg.pair_idx] || {};
					playoffVotes = { ...playoffVotes, [msg.pair_idx]: { ...pv, [msg.user_id]: msg.choice } };
					if (msg.pair_idx === playoffIdx) checkPlayoffComplete();
				} else if (msg.type === 'superfav') {
					spawnEmoji('⭐', msg.user);
				} else if (msg.type === 'join' || msg.type === 'leave') {
					connectedUsers = msg.count;
					syncMessage = `${msg.user} ${msg.type === 'join' ? 'se ha unido' : 'se ha ido'}`;
					setTimeout(() => { syncMessage = ''; }, 3000);
				}
			} catch {}
		};

		socket.onclose = (event) => {
			_wsConnecting = false;
			ws = null;
			window.postMessage({ type: 'THEREVIEW_LEAVE_SYNC' }, '*');
			if (extPlaybackHandler) {
				window.removeEventListener('message', extPlaybackHandler);
				extPlaybackHandler = null;
			}
			// Don't reconnect if server rejected us (auth/permission error)
			// or if the session changed / ended
			const rejected = !socket._opened; // never got onopen → server rejected
			if (!rejected && session && session.status !== 'finished' && session.id === sessionId) {
				_wsReconnectTimer = setTimeout(() => {
					if (!ws && session && session.status !== 'finished' && session.id === sessionId) {
						connectWs(sessionId, token);
					}
				}, 2000);
			}
		};

		ws = socket;
	}

	/** Svelte action: after the HTML is injected, tell Twitter widgets to render */
	function tweetWidget(node) {
		const tryLoad = () => {
			if (window.twttr?.widgets) {
				window.twttr.widgets.load(node);
			}
		};
		tryLoad();
		const t = setTimeout(tryLoad, 800);
		return { destroy() { clearTimeout(t); } };
	}

	$effect(() => {
		if (!authVal?.token) {
			goto('/login');
			return;
		}
		loadSession();

		return () => {
			if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
			if (ws) ws.close();
			if (timerInterval) clearInterval(timerInterval);
			if (mediaPoller) clearInterval(mediaPoller);
		};
	});

	// Poll media download status while session is pending or active
	$effect(() => {
		if (!authVal?.token || !session) return;
		if (session.status === 'finished') return;

		async function fetchMediaStatus() {
			try {
				const raw = await api(`/api/sessions/${session.id}/media`, { token: authVal.token });
				dlLiveProgress = raw._progress ?? null;
				// eslint-disable-next-line no-unused-vars
				const { _progress, ...statuses } = raw;
				mediaStatus = statuses;

				// Start elapsed timer on first active download
				if (raw._progress && !dlStartedAt) {
					dlStartedAt = Date.now();
					if (dlElapsedTimer) clearInterval(dlElapsedTimer);
					dlElapsedTimer = setInterval(() => {
						dlElapsed = Math.floor((Date.now() - dlStartedAt) / 1000);
					}, 1000);
				}

				// Stop polling once everything is resolved
				const pending = Object.values(statuses).some((s) => s?.status === 'pending');
				if (!pending && mediaPoller) {
					clearInterval(mediaPoller);
					mediaPoller = null;
					dlLiveProgress = null;
					if (dlElapsedTimer) { clearInterval(dlElapsedTimer); dlElapsedTimer = null; }
				}
			} catch { /* ignore */ }
		}

		fetchMediaStatus();
		if (mediaPoller) clearInterval(mediaPoller);
		mediaPoller = setInterval(fetchMediaStatus, 2000);

		return () => {
			if (mediaPoller) { clearInterval(mediaPoller); mediaPoller = null; }
		};
	});

	async function loadSession() {
		try {
			const id = pageVal.params.id;
			session = await api(`/api/sessions/${id}`, { token: authVal.token });
			votes = await api(`/api/sessions/${id}/votes`, { token: authVal.token });
			// Restore emoji reaction counts from localStorage (persisted across reloads)
			_loadEmojiCounts(session.id);
			if (session.status === 'finished') {
				ranking = await api(`/api/sessions/${id}/votes/ranking?top=5&bottom=5`, { token: authVal.token });
				view = 'ranking';
			}
			if (session.status === 'pending' || session.status === 'active') {
				if (!ws || ws.readyState !== WebSocket.OPEN) {
					connectWs(session.id, authVal.token);
				}
			}
			if (session.status === 'active') {
				startTimer(session.started_at);
				// Restore last known position after F5
				restorePosition(session.id, session.session_memes.length - 1);
			}
		} catch (e) {
			error = e.message;
		}
	}

	async function loadTwitterEmbed(memeId, url) {
		if (twitterEmbeds[memeId]) return;
		const embed = detectEmbed(url);
		if (embed.type !== 'twitter' || !embed.oEmbedUrl) return;
		try {
			const res = await fetch(embed.oEmbedUrl);
			if (res.ok) {
				const data = await res.json();
				twitterEmbeds = { ...twitterEmbeds, [memeId]: data.html };
			}
		} catch {
			twitterEmbeds = { ...twitterEmbeds, [memeId]: null };
		}
	}

	$effect(() => {
		const sm = session?.session_memes?.[currentIndex];
		if (sm) {
			const embed = detectEmbed(sm.meme.url);
			if (embed.type === 'twitter') loadTwitterEmbed(sm.meme.id, sm.meme.url);
		}
	});

	// Play a sound + update UI when downloads finish (don't auto-start)
	let dlNotified = false;
	$effect(() => {
		if (dlNotified) return;
		if (!session || session.status !== 'pending') return;
		const allReady = readyUserIds.length >= session.participants.length;
		if (!allReady || !dlSettled || dlTotal === 0) return;
		dlNotified = true;
		playDoneSound();
	});

	function playDoneSound() {
		try {
			const ctx = new AudioContext();
			[[523, 0], [659, 0.18], [784, 0.36]].forEach(([freq, delay]) => {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = 'sine';
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0, ctx.currentTime + delay);
				gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + delay + 0.04);
				gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.35);
				osc.start(ctx.currentTime + delay);
				osc.stop(ctx.currentTime + delay + 0.4);
			});
		} catch { /* AudioContext not available */ }
	}

	// Fun tap buttons — shown while waiting during download
	const FUN_BUTTONS = ['🔔','🎉','💩','👋','🍿','💀','🐒'];
	let floatingEmojis = $state([]); // [{id, emoji, x, user}]
	let _emojiId = 0;
	let emojiCounts = $state({}); // {emoji: count} — accumulated during session

	function _saveEmojiCounts(sessionId, counts) {
		try { localStorage.setItem(`tr_emojis_${sessionId}`, JSON.stringify(counts)); } catch {}
	}
	function _loadEmojiCounts(sessionId) {
		try {
			const raw = localStorage.getItem(`tr_emojis_${sessionId}`);
			if (raw) emojiCounts = JSON.parse(raw);
		} catch {}
	}

	function sendFunTap(emoji) {
		playEmojiSound(emoji);
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'fun_tap', emoji }));
		}
		spawnEmoji(emoji, authVal?.user?.display_name ?? '');
	}

	// Sound files keyed by emoji — add more as needed
	const EMOJI_SOUNDS = { '🐒': '/monkey.ogg' };

	function playMonkeySound() {
		try {
			const audio = new Audio('/monkey.ogg');
			audio.play().catch(() => {});
		} catch { /* not available */ }
	}

	function playEmojiSound(emoji) {
		const src = EMOJI_SOUNDS[emoji];
		if (!src) return;
		try {
			const audio = new Audio(src);
			audio.play().catch(() => {});
		} catch {}
	}

	function spawnEmoji(emoji, user) {
		const id = ++_emojiId;
		const x = 10 + Math.random() * 80; // % from left
		floatingEmojis = [...floatingEmojis, { id, emoji, x, user }];
		setTimeout(() => {
			floatingEmojis = floatingEmojis.filter(e => e.id !== id);
		}, 1800);
	}

	async function startSession() {
		try {
			session = await api(`/api/sessions/${session.id}/start`, {
				method: 'POST',
				token: authVal.token
			});
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'start' }));
			}
			readyUserIds = [];
			startTimer(session.started_at);
			// WS already connected from PENDING state
		} catch (e) {
			error = e.message;
		}
	}

	async function finishSession() {
		try {
			if (ws) ws.send(JSON.stringify({ type: 'finish' }));
			session = await api(`/api/sessions/${session.id}/finish`, {
				method: 'POST',
				token: authVal.token
			});
			ranking = await api(`/api/sessions/${session.id}/votes/ranking?top=5&bottom=5`, { token: authVal.token });
			startPlayoffOrRanking();
			if (timerInterval) clearInterval(timerInterval);
		} catch (e) {
			error = e.message;
		}
	}

	async function cancelSession() {
		if (!confirm('¿Cancelar y borrar esta sesión?')) return;
		try {
			await api(`/api/sessions/${session.id}`, { method: 'DELETE', token: authVal.token });
			window.location.href = '/';
		} catch (e) {
			error = e.message;
		}
	}

	async function castVote(memeId, value) {
		try {
			const vote = await api(`/api/sessions/${session.id}/votes`, {
				method: 'POST',
				body: { meme_id: memeId, value },
				token: authVal.token
			});
			// Update local votes
			votes = votes.filter(
				(v) => !(v.meme_id === memeId && v.user_id === authVal.user.id)
			);
			votes = [...votes, vote];
			// Broadcast via WS
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'vote', meme_id: memeId, value }));
			}
			// Auto-skip if all participants voted and everyone is below 25%
			const sm = session.session_memes[currentIndex];
			if (sm?.meme.id === memeId) {
				const total = session.session_memes.length;
				const threshold = total * 0.25;
				const memeVotes = votes.filter(v => v.meme_id === memeId);
				const allVoted = session.participants.every(p => memeVotes.some(v => v.user_id === p.id));
				if (allVoted && memeVotes.every(v => v.value < threshold)) {
					setTimeout(() => next(), 600);
				}
			}
		} catch (e) {
			error = e.message;
		}
	}

	function getMyVote(memeId) {
		return votes.find(
			(v) => v.meme_id === memeId && v.user_id === authVal.user?.id
		);
	}

	/** Preview image for ranking row / podium: API thumbnail (TikTok/YouTube) or direct image URL. */
	function rankingPreviewSrc(entry) {
		if (!entry) return null;
		if (entry.thumbnail_url) return entry.thumbnail_url;
		const e = detectEmbed(entry.url);
		if (e.type === 'image') return entry.url;
		return null;
	}

	function currentMeme() {
		if (!session?.session_memes?.length) return null;
		return session.session_memes[currentIndex];
	}

	function prev() {
		if (currentIndex > 0) {
			currentIndex--;
			nextVoters = [];
			playbackStates = {};
			autoplayReady = null;
			savePosition(session.id, currentIndex);
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'navigate', index: currentIndex }));
			}
		}
	}

	function next() {
		if (currentIndex < session.session_memes.length - 1) {
			currentIndex++;
			nextVoters = [];
			playbackStates = {};
			autoplayReady = null;
			savePosition(session.id, currentIndex);
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'navigate', index: currentIndex }));
			}
		}
	}

	function getMemeVoteTotal(memeId) {
		return votes
			.filter((v) => v.meme_id === memeId)
			.reduce((sum, v) => sum + v.value, 0);
	}

	function handleReady() {
		const uid = authVal.user?.id;
		if (uid && !readyUserIds.includes(uid)) {
			readyUserIds = [...readyUserIds, uid];
		}
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'ready' }));
		}
	}

	function triggerPlaySync() {
		const payload = { action: 'play', currentTime: 0 };
		try {
			const iframe = document.querySelector('.sync-media-wrap iframe');
			if (iframe?.contentWindow) {
				iframe.contentWindow.postMessage({ type: 'THEREVIEW_PLAYBACK_REMOTE', ...payload }, '*');
			} else {
				window.postMessage({ type: 'THEREVIEW_PLAYBACK_REMOTE', ...payload }, '*');
			}
		} catch (e) {}
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'playback', action: payload.action, currentTime: payload.currentTime }));
		}
	}

	function isSyncMedia(embedType) {
		return embedType === 'tiktok' || embedType === 'twitter';
	}

	// ── Superfavorites ────────────────────────────────────────────────────────
	let superfavorites = $state([]);
	$effect(() => {
		if (!authVal?.token || !session) return;
		if (session.status !== 'pending') return;
		api('/api/sessions/superfavorites', { token: authVal.token })
			.then(d => { superfavorites = d; })
			.catch(() => {});
	});

	// ── Shared cursors ────────────────────────────────────────────────────────
	const CURSOR_COLORS = ['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#dd6b20'];
	let otherCursors = $state({}); // {userId: {x, y, user, color}}
	let _lastCursorSend = 0;
	function onMouseMove(e) {
		const now = Date.now();
		if (now - _lastCursorSend < 50) return;
		_lastCursorSend = now;
		const x = Math.round((e.clientX / window.innerWidth) * 1000) / 10;
		const y = Math.round((e.clientY / window.innerHeight) * 1000) / 10;
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'cursor', x, y }));
		}
	}

	// ── Playoff (tie-breaking) ────────────────────────────────────────────────
	let playoffPairs = $state([]);
	let playoffIdx = $state(0);
	let playoffVotes = $state({});   // {pairIdx: {userId: 'a'|'b'}}
	let playoffResults = $state({}); // {pairIdx: 'a'|'b'}

	function detectTiesInEntries(entries) {
		const pairs = [];
		for (let i = 0; i < entries.length - 1; i++) {
			if (entries[i].total_score === entries[i + 1].total_score) {
				pairs.push({ a: entries[i], b: entries[i + 1] });
			}
		}
		return pairs;
	}

	function startPlayoffOrRanking() {
		const top5 = ranking.slice(0, 5);
		const cringe = ranking.length > 5
			? ranking.slice(-5).filter(b => !top5.find(t => t.meme_id === b.meme_id))
			: [];
		const ties = [...detectTiesInEntries(top5), ...detectTiesInEntries(cringe)];
		if (ties.length > 0) {
			playoffPairs = ties;
			playoffIdx = 0;
			playoffVotes = {};
			playoffResults = {};
			view = 'playoff';
		} else {
			view = 'ranking';
		}
	}

	function castPlayoffVote(choice) {
		const uid = authVal.user?.id;
		if (!uid || playoffVotes[playoffIdx]?.[uid]) return;
		playoffVotes = {
			...playoffVotes,
			[playoffIdx]: { ...(playoffVotes[playoffIdx] || {}), [uid]: choice }
		};
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'playoff_vote', pair_idx: playoffIdx, choice }));
		}
		checkPlayoffComplete();
	}

	function checkPlayoffComplete() {
		const pairVotes = playoffVotes[playoffIdx] || {};
		const allVoted = session?.participants.every(p => pairVotes[p.id]);
		if (!allVoted) return;
		const votesA = Object.values(pairVotes).filter(v => v === 'a').length;
		const winner = votesA >= Object.keys(pairVotes).length / 2 ? 'a' : 'b';
		playoffResults = { ...playoffResults, [playoffIdx]: winner };
		setTimeout(() => {
			if (playoffIdx < playoffPairs.length - 1) {
				playoffIdx++;
			} else {
				view = 'ranking';
			}
		}, 1400);
	}

	function applyPlayoffs(entries) {
		let result = [...entries];
		Object.entries(playoffResults).forEach(([pIdxStr, winner]) => {
			const pair = playoffPairs[parseInt(pIdxStr)];
			if (!pair) return;
			const posA = result.findIndex(e => e.meme_id === pair.a.meme_id);
			const posB = result.findIndex(e => e.meme_id === pair.b.meme_id);
			if (posA === -1 || posB === -1) return;
			if (winner === 'b' && posA < posB) [result[posA], result[posB]] = [result[posB], result[posA]];
			if (winner === 'a' && posB < posA) [result[posA], result[posB]] = [result[posB], result[posA]];
		});
		return result;
	}

	// ── Shared notepad ────────────────────────────────────────────────────────
	let noteText = $state('');
	let noteVisible = $state(true);
	let _noteSendTimer = null;
	function sendNote(text) {
		if (_noteSendTimer) clearTimeout(_noteSendTimer);
		_noteSendTimer = setTimeout(() => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'note_update', text }));
			}
		}, 250);
	}

	// ── Both-must-click-next ──────────────────────────────────────────────────
	let nextVoters = $state([]); // user_ids who clicked "siguiente"

	function voteNext() {
		const uid = authVal.user?.id;
		const sm = currentMeme();
		if (!sm) return;
		// Meme submitter can skip alone
		const isOwner = sm.meme.user_id === uid;
		if (!nextVoters.includes(uid)) {
			nextVoters = [...nextVoters, uid];
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'next_vote' }));
			}
		}
		const allAgreed = isOwner || session.participants.every(p => nextVoters.includes(p.id));
		if (allAgreed) {
			nextVoters = [];
			next();
		}
	}

	// ── Unique vote scores per user per session ───────────────────────────────
	// Returns the set of values this user has used for OTHER memes (not memeId)
	function getUsedOtherScores(memeId) {
		return new Set(
			votes.filter(v => v.user_id === authVal.user?.id && v.meme_id !== memeId).map(v => v.value)
		);
	}

	// Snap to nearest available score if value is already taken by another vote
	function resolveScore(value, memeId, total) {
		const taken = getUsedOtherScores(memeId);
		if (!taken.has(value)) return value;
		for (let d = 1; d <= total; d++) {
			if (!taken.has(value + d) && value + d <= total) return value + d;
			if (!taken.has(value - d) && value - d >= 0) return value - d;
		}
		return value; // fallback (all taken — shouldn't happen)
	}

	// ── Vote density heatmap ─────────────────────────────────────────────────
	/**
	 * Classic jet-style color: 0=dark→blue→cyan→yellow→red=1
	 * Used for the global vote-density heatmap in results.
	 */
	function heatColor(t) {
		if (t <= 0) return 'rgba(255,255,255,0.06)';
		// jet-style: blue(240°) → cyan(180°) → yellow(60°) → red(0°)
		// t=0.01..1 maps to hue 220..0
		const h = Math.round((1 - t) * 220);
		// saturation high throughout; lightness ramps up with intensity
		const s = 88;
		const l = Math.round(28 + t * 32); // 28% at t=0.01 → 60% at t=1
		return `hsl(${h},${s}%,${l}%)`;
	}

	// ── F5 recovery ───────────────────────────────────────────────────────────
	function savePosition(sessionId, index) {
		try { localStorage.setItem(`tr_pos_${sessionId}`, String(index)); } catch {}
	}
	function restorePosition(sessionId, maxIndex) {
		try {
			const saved = localStorage.getItem(`tr_pos_${sessionId}`);
			if (saved !== null) currentIndex = Math.min(parseInt(saved, 10) || 0, maxIndex);
		} catch {}
	}

	// ── Superfav auto-detect (all max votes) ─────────────────────────────────
	let _superfavSent = $state(new Set());
	$effect(() => {
		if (!session?.session_memes || !votes.length) return;
		const total = session.session_memes.length;
		session.session_memes.forEach(sm => {
			const mid = sm.meme.id;
			if (_superfavSent.has(mid)) return;
			const mVotes = votes.filter(v => v.meme_id === mid);
			if (mVotes.length < session.participants.length) return;
			if (!mVotes.every(v => v.value === total)) return;
			_superfavSent = new Set([..._superfavSent, mid]);
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'superfav', meme_id: mid }));
			}
		});
	});

	// ── Show ranking (shared with WS) ─────────────────────────────────────────
	async function showRanking() {
		ranking = await api(`/api/sessions/${session.id}/votes/ranking?top=5&bottom=5`, { token: authVal.token });
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'show_ranking' }));
		startPlayoffOrRanking();
	}

	$effect(() => {
		const sm = session?.session_memes?.[currentIndex];
		if (!sm) return;
		const embed = detectEmbed(sm.meme.url);
		if (!isSyncMedia(embed.type)) return;
		autoplayReady = null;

		let attempts = 0;
		const interval = setInterval(() => {
			attempts += 1;
			try {
				const iframe = document.querySelector('.sync-media-wrap iframe');
				if (iframe?.contentWindow) {
					iframe.contentWindow.postMessage({ type: 'THEREVIEW_AUTOPLAY_PROBE' }, '*');
				}
			} catch (e) {}
			if (attempts >= 4 || autoplayReady !== null) {
				clearInterval(interval);
			}
		}, 900);

		return () => clearInterval(interval);
	});

</script>

<!-- shared cursor overlay (fixed, outside the layout flow) -->
{#each Object.entries(otherCursors) as [uid, cur]}
	<div class="shared-cursor" style="left:{cur.x}%;top:{cur.y}%;--cc:{cur.color}">
		<svg width="16" height="20" viewBox="0 0 16 20" fill="none">
			<path d="M0 0 L0 16 L4 12 L7 19 L9 18 L6 11 L11 11 Z" fill="var(--cc)" stroke="#fff" stroke-width="1"/>
		</svg>
		<span class="shared-cursor-label">{cur.user}</span>
	</div>
{/each}

<div class="session-page"
	class:pres-mode={session && session.status === 'active' && view === 'presentation'}
	onmousemove={onMouseMove}
	role="presentation"
>
	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if session}
		{#if !(session.status === 'active' && view === 'presentation')}
		<div class="session-header glass">
			<div class="session-header-inner">
				<!-- Left: back + session name + status -->
				<div class="sh-left">
					<button class="btn-ghost btn-icon" onclick={() => goto('/sessions')} title="Volver a sesiones" style="width:34px;height:34px;flex-shrink:0">‹</button>
					<div class="sh-title-group">
						<div style="display:flex;align-items:center;gap:0.6rem">
							<h2 class="sh-title">{session.name}</h2>
							{#if session.status === 'active'}
								<span class="chip chip-teal sh-live-chip">
									<span class="live-dot"></span>
									LIVE
								</span>
							{:else if session.status === 'pending'}
								<span class="chip sh-status-chip">⏳ PENDING</span>
							{/if}
						</div>
						<div class="sh-meta">
							{#if session.status === 'active'}
								<span class="mono tabular sh-timer">⏱ {elapsed}</span>
								<span class="sh-sep">·</span>
							{/if}
							{#each session.participants as p, i}
								{@const pbs = playbackStates[p.id]}
								<span class="sh-participant">
									{#if pbs?.playing}🟢{:else if pbs}⏸{/if}
									{p.display_name}
								</span>
								{#if i < session.participants.length - 1}<span class="sh-sep">·</span>{/if}
							{/each}
							{#if connectedUsers > 0}
								<span class="sh-sep">·</span>
								<span class="sh-online">{connectedUsers} online</span>
							{/if}
						</div>
					</div>
				</div>

				<!-- Center: session progress bar -->
				{#if session.status === 'active' && view === 'presentation'}
					<div class="sh-progress">
						<div style="display:flex;justify-content:space-between;font-size:0.68rem;margin-bottom:3px;color:var(--text-muted)">
							<span>Sesión</span>
							<span class="mono tabular">{Math.round((currentIndex + 1) / session.session_memes.length * 100)}%</span>
						</div>
						<div class="sh-prog-track">
							<div class="sh-prog-fill" style="width:{((currentIndex + 1) / session.session_memes.length) * 100}%"></div>
						</div>
					</div>
				{/if}

				<!-- Right: notepad toggle + notifications -->
				<div class="sh-right">
					{#if autoplayReady === false}
						<p class="autoplay-hint" style="font-size:0.72rem;margin:0">▶ Activa el embed primero</p>
					{/if}
					{#if outOfSync}
						<p class="out-of-sync-hint" style="font-size:0.72rem;margin:0">▶ Pulsa Play para unirte</p>
					{/if}
					{#if syncMessage}
						<p class="sync-toast" style="margin:0">{syncMessage}</p>
					{/if}
					{#if session.status === 'active'}
						<button
							class="btn-glass sh-notepad-btn"
							class:sh-notepad-active={noteVisible}
							onclick={() => (noteVisible = !noteVisible)}
							title="Sidebar (participantes + reacciones + notas)"
						>📝 Sidebar</button>
					{/if}
				</div>
			</div>
		</div>
		{/if}<!-- /!pres-mode header -->

		<!-- PENDING -->
		{#if session.status === 'pending'}
			<div class="card center-card">
				<p>{session.session_memes.length} memes listos para la review</p>

				<div class="ready-list">
					{#each session.participants as p}
						<div class="ready-row">
							<span class="chip">{p.display_name}</span>
							{#if readyUserIds.includes(p.id)}
								<span class="ready-check">✅ Listo</span>
							{:else}
								<span class="ready-wait">⏳ Esperando…</span>
							{/if}
						</div>
					{/each}
				</div>

				{#if !readyUserIds.includes(authVal.user?.id)}
					<button class="btn-primary big-btn" onclick={handleReady}>
						✋ ¡Estoy listo!
					</button>
				{:else if readyUserIds.length < session.participants.length}
					<p class="ready-msg">Esperando al resto…</p>
				{:else if dlTotal > 0 && !dlSettled}
					<!-- Everyone ready — waiting for downloads -->
					<div class="dl-progress-wrap">
						<p class="dl-progress-label">⏬ Preparando vídeos… {dlReady + dlFailed}/{dlTotal}</p>
						<div class="dl-progress-bar">
							<div class="dl-progress-fill" style="width: {dlPct}%"></div>
						</div>
						<div class="dl-progress-stats">
							<span class="dl-stat">{dlPct}%</span>
							{#if dlLiveProgress?.total_bytes > 0}
								<span class="dl-stat">{formatBytes(dlLiveProgress.downloaded_bytes)} / {formatBytes(dlLiveProgress.total_bytes)}</span>
							{:else if dlLiveProgress?.downloaded_bytes > 0}
								<span class="dl-stat">{formatBytes(dlLiveProgress.downloaded_bytes)}</span>
							{:else if dlLiveProgress?.active_count > 0}
								<span class="dl-stat">extrayendo…</span>
							{/if}
							{#if dlLiveProgress?.speed_bps > 0}
								<span class="dl-stat dl-speed">↓ {formatSpeed(dlLiveProgress.speed_bps)}</span>
							{/if}
							{#if dlLiveProgress?.active_count > 0}
								<span class="dl-stat">{dlLiveProgress.active_count} en curso</span>
							{/if}
							{#if dlElapsed > 0}
								<span class="dl-stat">⏱ {formatElapsed(dlElapsed)}</span>
							{/if}
							{#if dlEta()}
								<span class="dl-stat dl-eta">ETA {dlEta()}</span>
							{/if}
						</div>
						{#if dlFailed > 0}
							<p class="dl-progress-sub">
								<span class="dl-failed" title="Vídeos eliminados, privados o no compatibles con la descarga automática. Se mostrarán como iframe al llegar a ellos.">
									⚠️ {dlFailed} eliminados o privados
								</span>
							</p>
						{/if}
					</div>
				{:else if dlSettled || dlTotal === 0}
					<!-- Downloads done — manual start -->
					{#if session.created_by === authVal.user?.id}
						<button class="btn-primary big-btn start-btn start-ready-btn" onclick={startSession}>
							🎬 ¡Todo listo! Empezar
						</button>
					{:else}
						<p class="ready-msg">✅ Listo · Esperando al anfitrión…</p>
					{/if}
				{/if}

				<!-- Fun buttons — visible while everyone is ready (downloading or not) -->
				{#if readyUserIds.length >= session.participants.length && session.status === 'pending'}
					<div class="fun-buttons-wrap">
						<p class="fun-buttons-label">Mientras esperáis… 👇</p>
						<div class="fun-buttons">
							{#each FUN_BUTTONS as emoji}
								<button class="fun-btn" onclick={() => sendFunTap(emoji)}>{emoji}</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Superfavorites gallery (while waiting) -->
				{#if superfavorites.length > 0}
					<div class="superfav-gallery">
						<p class="superfav-gallery-label">⭐ Super favoritos de otras sesiones</p>
						<div class="superfav-grid">
							{#each superfavorites.slice(0, 12) as sf}
								{@const sfEmbed = detectEmbed(sf.url)}
								<a href={sf.url} target="_blank" rel="noopener noreferrer" class="superfav-cell">
									{#if sfEmbed.type === 'image'}
										<img src={sf.url} alt="" loading="lazy" referrerpolicy="no-referrer" />
									{:else if sfEmbed.thumbnailUrl}
										<img src={sfEmbed.thumbnailUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
									{:else}
										<span class="superfav-cell-icon">{({tiktok:'🎵',twitter:'🐦',youtube:'▶️',instagram:'📸',image:'🖼️'})[sfEmbed.type] ?? '⭐'}</span>
									{/if}
								</a>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Cancel session — only creator, only during pending -->
				{#if session.created_by === authVal.user?.id}
					<button class="btn-cancel-session" onclick={cancelSession}>
						🗑 Cancelar sesión
					</button>
				{/if}
			</div>
		{/if}

		<!-- Floating emoji overlay (fun tap reactions) -->
		{#each floatingEmojis as fe (fe.id)}
			<div class="floating-emoji" style="left: {fe.x}%">{fe.emoji}</div>
		{/each}

		<!-- ACTIVE: presentation mode -->
		{#if session.status === 'active' && view === 'presentation'}
			{@const sm = currentMeme()}
			{#if sm}
				{@const embed = detectEmbed(sm.meme.url)}
				{@const myVote = getMyVote(sm.meme.id)}
				{@const smeta = mediaStatus[String(sm.meme.id)]?.meta}
				{@const PLAT = ({tiktok:{g:'🎵',c:'#ff5470'},twitter:{g:'🐦',c:'#1d9bf0'},youtube:{g:'▶',c:'#ff0000'},instagram:{g:'📸',c:'#e040fb'},image:{g:'🖼️',c:'#5ee3d2'},link:{g:'🔗',c:'#7c6fd4'}})[embed.type] ?? {g:'🔗',c:'#7c6fd4'}}
				{@const totalMemes = session.session_memes.length}
				{@const sliderVal = myVote?.value ?? null}
				{@const rankPct = sliderVal !== null ? sliderVal / totalMemes : null}
				{@const usedOther = getUsedOtherScores(sm.meme.id)}
				{@const isVertical = embed.type === 'tiktok' || embed.type === 'instagram'}
				{@const isLocalVideo = (embed.type === 'tiktok' || embed.type === 'twitter') && mediaStatus[String(sm.meme.id)]?.status === 'ready'}
				{@const myId = authVal.user?.id}
				{@const isPlaying = playbackStates[myId]?.playing ?? false}
				<div class="sesh-grid" class:sesh-with-sidebar={noteVisible}>

					<!-- Topbar: spans all columns -->
					<div class="pres-topbar glass sesh-full-row">
						<button class="btn-ghost btn-icon pres-back" onclick={() => goto('/sessions')} title="Volver">‹</button>
						<div class="pres-title-group">
							<div class="pres-name-row">
								<span class="pres-name">{session.name}</span>
								<span class="chip chip-teal sh-live-chip"><span class="live-dot"></span>LIVE</span>
							</div>
							<div class="pres-meta">
								<span class="mono tabular">⏱ {elapsed}</span>
								<span class="pres-sep">·</span>
								<span class="mono tabular">{currentIndex + 1} / {session.session_memes.length}</span>
								<span class="pres-sep">·</span>
								<span>{session.participants.length} viendo</span>
							</div>
						</div>
						<div class="pres-progress">
							<div style="display:flex;justify-content:space-between;font-size:0.68rem;margin-bottom:3px;color:var(--text-muted)">
								<span>Sesión</span>
								<span class="mono tabular">{Math.round((currentIndex + 1) / session.session_memes.length * 100)}%</span>
							</div>
							<div class="sh-prog-track">
								<div class="sh-prog-fill" style="width:{((currentIndex + 1) / session.session_memes.length) * 100}%"></div>
							</div>
						</div>
						<button class="btn-glass pres-notepad-btn" class:hud-notepad-active={noteVisible} onclick={() => (noteVisible = !noteVisible)}>
							📝 Notepad
						</button>
					</div>

					<!-- Left HUD column -->
					<div class="sesh-left glass-strong">

						<!-- Meta: platform + title + stats + submitter -->
						<div class="sl-meta">
							<div class="sl-plat-row">
								<div class="hud-plat-badge" style="background:linear-gradient(135deg,{PLAT.c}33,{PLAT.c}11);border-color:{PLAT.c}44">
									<span style="color:{PLAT.c}">{PLAT.g}</span>
								</div>
								<div class="sl-title-wrap">
									{#if smeta?.title}
										<div class="sl-title">{smeta.title}</div>
									{:else}
										<div class="sl-title sl-title-muted">{embed.type}</div>
									{/if}
								</div>
							</div>
							<div class="sl-stats">
								{#if smeta?.uploader}<span class="sl-uploader" style="color:{PLAT.c}">{smeta.uploader}</span>{/if}
								{#if smeta?.view_count}<span class="meta-chip">👁 {smeta.view_count >= 1_000_000 ? (smeta.view_count/1_000_000).toFixed(1)+'M' : smeta.view_count >= 1_000 ? (smeta.view_count/1_000).toFixed(0)+'K' : smeta.view_count}</span>{/if}
								{#if smeta?.like_count}<span class="meta-chip">♥ {smeta.like_count >= 1_000_000 ? (smeta.like_count/1_000_000).toFixed(1)+'M' : smeta.like_count >= 1_000 ? (smeta.like_count/1_000).toFixed(0)+'K' : smeta.like_count}</span>{/if}
								{#if smeta?.comment_count}<span class="meta-chip">💬 {smeta.comment_count >= 1_000 ? (smeta.comment_count/1_000).toFixed(0)+'K' : smeta.comment_count}</span>{/if}
								{#if smeta?.duration}<span class="meta-chip">⏱ {smeta.duration >= 60 ? Math.floor(smeta.duration/60)+'m'+(smeta.duration%60>0?(smeta.duration%60)+'s':'') : smeta.duration+'s'}</span>{/if}
							</div>
							<div class="sl-submitter-row">
								<span class="hud-submitter-init">{(session.participants.find(p=>p.id===sm.meme.user_id)?.display_name??'?').slice(0,2).toUpperCase()}</span>
								<span class="sl-submitter-name">{session.participants.find(p=>p.id===sm.meme.user_id)?.display_name||'?'}</span>
								{#if sm.extra_count > 0}<span class="chip chip-coral" style="font-size:0.65rem">×{sm.extra_count+1}</span>{/if}
							</div>
						</div>

						<!-- Vertical vote slider -->
						<div class="sl-vote">
							<div class="sl-vote-top">
								<span class="eyebrow" style="font-size:0.6rem">Tu voto</span>
								<div class="sl-vote-display">
									<span class="sl-vote-num" class:sl-vote-active={sliderVal !== null}>{sliderVal ?? '—'}</span>
									<span class="sl-vote-denom">/{totalMemes}</span>
								</div>
							</div>

							<div class="sl-track-area">
								<span class="sl-emoji-label">🏆</span>
								<div class="sl-track-wrap">
									<!-- SVG gradient track — writing-mode immune -->
									<svg class="sl-track-svg" preserveAspectRatio="none">
										<defs>
											<linearGradient id="vg-{sm.meme.id}" gradientUnits="objectBoundingBox" x1="0" y1="1" x2="0" y2="0">
												<stop offset="0%" stop-color="#ff3b3b"/>
												<stop offset="50%" stop-color="#ffb800"/>
												<stop offset="100%" stop-color="#2bd4a7"/>
											</linearGradient>
										</defs>
										<rect width="100%" height="100%" rx="3" ry="3" fill="url(#vg-{sm.meme.id})"/>
									</svg>
									<input
										type="range"
										orient="vertical"
										min="0"
										max={totalMemes}
										value={sliderVal ?? Math.round(totalMemes / 2)}
										class="rank-slider sl-range-v"
										onchange={(e) => {
											const resolved = resolveScore(+e.target.value, sm.meme.id, totalMemes);
											e.target.value = resolved;
											castVote(sm.meme.id, resolved);
										}}
									/>
									<!-- Other users' votes as side dots -->
									{#each votes.filter(v => v.meme_id === sm.meme.id && v.user_id !== myId) as ov}
										{@const participant = session.participants.find(p => p.id === ov.user_id)}
										<span
											class="other-vote-dot-v"
											style="bottom:{(ov.value/totalMemes)*100}%"
											title="{participant?.display_name}: {ov.value}/{totalMemes}"
										>{participant?.display_name?.slice(0,1)??'?'}</span>
									{/each}
								</div>
								<span class="sl-emoji-label">💀</span>
							</div>

							<!-- Who voted -->
							<div class="hud-who-voted sl-who-voted">
								{#each session.participants as p}
									{@const voted = votes.some(v => v.meme_id === sm.meme.id && v.user_id === p.id)}
									<div class="voted-avatar" class:voted-done={voted} title="{p.display_name}{voted?'  ✓':''}">
										{p.display_name.slice(0,2).toUpperCase()}
										{#if voted}<span class="voted-check">✓</span>{/if}
									</div>
								{/each}
							</div>
						</div>

						<!-- Transport controls -->
						<div class="sl-transport">
							{#if isLocalVideo}
								<div class="sl-media-btns">
									<button class="btn-icon btn-glass hud-icon-btn" onclick={() => { if (localVideoEl) { localVideoEl.paused ? localVideoEl.play() : localVideoEl.pause(); } }}>
										{isPlaying ? '⏸' : '▶'}
									</button>
									<button class="btn-icon btn-glass hud-icon-btn" class:hud-muted={localVideoMuted} onclick={() => { if (localVideoEl) { localVideoEl.muted = !localVideoEl.muted; } }}>
										{localVideoMuted ? '🔇' : '🔊'}
									</button>
								</div>
							{/if}
							<div class="sl-fun-row">
								{#each FUN_BUTTONS as emoji}
									<button class="fun-btn" onclick={() => sendFunTap(emoji)} title={emoji}>{emoji}</button>
								{/each}
							</div>
							<div class="sl-nav-btns">
								<button class="btn-glass sl-nav-btn" onclick={prev} disabled={currentIndex === 0}>‹ Anterior</button>
								{#if currentIndex === session.session_memes.length - 1}
									<button class="btn-glass sl-nav-btn" onclick={showRanking}>📊 Ranking</button>
								{:else}
									<button class="btn-primary sl-nav-btn" class:hud-next-ready={nextVoters.includes(myId)} onclick={voteNext}>Siguiente ›</button>
								{/if}
							</div>
						</div>

					</div><!-- /sesh-left -->

					<!-- Video stage (center column) -->
					<div class="stage-wrap">
						<div
							class="video-stage"
							class:video-stage-vertical={isVertical}
							style="--plat-c: {PLAT.c}"
						>
								<!-- SYNCED badge -->
								{#if connectedUsers > 1}
									<div class="synced-badge">
										<span class="synced-dot"></span>SYNCED
									</div>
								{/if}

								<!-- Superfav flash -->
								{#if (() => {
									const mVotes = votes.filter(v => v.meme_id === sm.meme.id);
									return mVotes.length >= session.participants.length && mVotes.every(v => v.value === totalMemes);
								})()}
									<div class="superfav-stage-flash">⭐ ¡SUPER FAVORITO!</div>
								{/if}

								<!-- Embed -->
								{#key sm.meme.id}
								{#if embed.type === 'youtube' && embed.embedUrl}
									<iframe src={embed.embedUrl} title="YouTube" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope" allowfullscreen={true} class="stage-embed"></iframe>
								{:else if embed.type === 'tiktok' && mediaStatus[String(sm.meme.id)]?.status === 'ready'}
									<div class="sync-media-wrap stage-embed-wrap">
										<video src="/api/sessions/{session.id}/media/{sm.meme.id}?token={authVal.token}" controls={false} class="stage-video" use:localVideoSync></video>
									</div>
								{:else if embed.type === 'tiktok' && embed.embedUrl}
									<div class="sync-media-wrap stage-embed-wrap">
										{#if mediaStatus[String(sm.meme.id)]?.status === 'pending'}
											<div class="media-loading">⏬ Cargando vídeo local…</div>
										{:else if mediaStatus[String(sm.meme.id)]?.status === 'slideshow'}
											<div class="media-loading slideshow-badge">🖼️ Slideshow de imágenes</div>
										{/if}
										<iframe src={embed.embedUrl} title="TikTok" allow="autoplay; fullscreen; encrypted-media" allowfullscreen={true} class="stage-embed"></iframe>
									</div>
								{:else if embed.type === 'instagram' && embed.embedUrl}
									<iframe src={embed.embedUrl} title="Instagram" allowfullscreen={true} class="stage-embed"></iframe>
								{:else if embed.type === 'twitter' && mediaStatus[String(sm.meme.id)]?.status === 'ready'}
									<div class="sync-media-wrap stage-embed-wrap">
										<video src="/api/sessions/{session.id}/media/{sm.meme.id}?token={authVal.token}" controls={false} class="stage-video" use:localVideoSync></video>
									</div>
								{:else if embed.type === 'twitter'}
									<div class="sync-media-wrap stage-embed-wrap">
										{#if mediaStatus[String(sm.meme.id)]?.status === 'pending'}
											<div class="media-loading">⏬ Cargando vídeo local…</div>
										{/if}
										{#if twitterEmbeds[sm.meme.id]}
											<!-- eslint-disable-next-line svelte/no-at-html-tags -->
											<div class="twitter-embed-wrap" use:tweetWidget>{@html twitterEmbeds[sm.meme.id]}</div>
										{:else if twitterEmbeds[sm.meme.id] === null}
											<div class="twitter-embed">
												<p class="tweet-hint">No se pudo cargar el tweet.</p>
												<a href={sm.meme.url} target="_blank" rel="noopener noreferrer" class="btn-secondary open-btn">🐦 Abrir en Twitter/X</a>
											</div>
										{:else}
											<div class="twitter-embed"><p class="tweet-hint">Cargando tweet…</p></div>
										{/if}
									</div>
								{:else if embed.type === 'image'}
									<img src={sm.meme.url} alt="meme" class="stage-image" />
								{:else}
									<!-- Placeholder for non-embeddable links -->
									<div class="stage-placeholder">
										<span class="stage-plat-glyph">{PLAT.g}</span>
										<a href={sm.meme.url} target="_blank" rel="noopener noreferrer" class="btn-glass" style="margin-top:1rem">🔗 Abrir enlace</a>
									</div>
								{/if}
								{/key}
							</div><!-- /video-stage -->
						</div><!-- /stage-wrap -->

					<!-- ── Sidebar column ── -->
					{#if noteVisible}
						<div class="sesh-sidebar">

							<!-- Participants -->
							<div class="sidebar-card">
								<div class="sidebar-card-header">
									<span class="eyebrow" style="font-size:0.6rem">En la sala</span>
									<span class="chip chip-teal" style="font-size:0.65rem;padding:0.15rem 0.55rem;display:inline-flex;align-items:center;gap:5px">
										<span class="live-dot"></span>{connectedUsers} online
									</span>
								</div>
								<div class="participants-list">
									{#each session.participants as p}
										{@const voted = votes.some(v => v.meme_id === currentMeme()?.meme?.id && v.user_id === p.id)}
										{@const isMe = p.id === authVal.user?.id}
										<div class="participant-row">
											<div class="participant-avatar" class:participant-voted={voted}>{p.display_name.slice(0,2).toUpperCase()}</div>
											<div class="participant-info">
												<div class="participant-name">
													{p.display_name}
													{#if isMe}<span class="muted" style="font-weight:400;font-size:0.72rem">(tú)</span>{/if}
												</div>
												<div class="participant-status" style="color:{voted ? 'var(--teal)' : 'var(--text-muted)'}">
													{voted ? '✓ ha votado' : 'votando…'}
												</div>
											</div>
											{#if voted}<span style="color:var(--teal);font-size:0.85rem">✓</span>{/if}
										</div>
									{/each}
								</div>
							</div>

							<!-- Reactions -->
							<div class="sidebar-card">
								<div class="sidebar-card-header">
									<span class="eyebrow" style="font-size:0.6rem">Reacciones en directo</span>
									<span class="chip" style="font-size:0.65rem;padding:0.15rem 0.55rem;display:inline-flex;align-items:center;gap:5px">
										<span class="live-dot" style="background:var(--teal);box-shadow:0 0 6px var(--teal)"></span>live
									</span>
								</div>
								<div class="reactions-grid">
									{#each FUN_BUTTONS as emoji}
										{@const count = emojiCounts[emoji] || 0}
										<button class="reaction-btn" class:reaction-active={count > 0} onclick={() => sendFunTap(emoji)}>
											<span>{emoji}</span>
											{#if count > 0}<span class="reaction-count">{count}</span>{/if}
										</button>
									{/each}
								</div>
							</div>

							<!-- Notepad -->
							<div class="sidebar-card notepad-grow">
								<div class="sidebar-card-header">
									<span class="eyebrow" style="font-size:0.6rem">Notepad compartido</span>
									<div style="display:flex;align-items:center;gap:0.5rem">
										<span class="chip" style="font-size:0.65rem;padding:0.15rem 0.55rem;display:inline-flex;align-items:center;gap:4px">
											<span class="live-dot" style="background:var(--teal);box-shadow:0 0 6px var(--teal)"></span>sync live
										</span>
										<button class="notepad-close" onclick={() => (noteVisible = false)}>✕</button>
									</div>
								</div>
								<textarea class="notepad-textarea" bind:value={noteText} oninput={(e) => sendNote(e.target.value)} placeholder="Apunta los momentazos, frases míticas, ideas…"></textarea>
							</div>

							<!-- SuperFav card -->
							<div class="sidebar-card superfav-card">
								<button class="superfav-btn" class:superfav-active={(() => {
									const mVotes = votes.filter(v => v.meme_id === sm.meme.id);
									return mVotes.length >= session.participants.length && mVotes.every(v => v.value === totalMemes);
								})()} onclick={() => { /* future: mark superfav */ }}>
									<span class="superfav-star">⭐</span>
									<div class="superfav-text">
										<div class="superfav-label">Marcar como Super Fav</div>
										<div class="superfav-hint">Aparecerá en la galería de carga.</div>
									</div>
								</button>
							</div>

							<a href="https://ko-fi.com/Z8Z81OW7UV" target="_blank" rel="noopener noreferrer" class="kofi-link-panel" title="Invítame un café ☕">☕</a>

						</div><!-- /sesh-sidebar -->
					{/if}

				</div><!-- /sesh-grid -->
			{/if}
		{/if}

		<!-- PLAYOFF VIEW (tie-breaking) -->
		{#if view === 'playoff'}
			{@const pair = playoffPairs[playoffIdx]}
			{#if pair}
				<div class="playoff-view">
					<div class="playoff-header">
						<h3>⚔️ Desempate {playoffIdx + 1}/{playoffPairs.length}</h3>
						<p class="playoff-sub">¿Cuál es mejor?</p>
					</div>
					<div class="playoff-pair">
						{#each [{key:'a', entry: pair.a}, {key:'b', entry: pair.b}] as side}
							{@const embed = detectEmbed(side.entry.url)}
							{@const previewSrc = rankingPreviewSrc(side.entry)}
							{@const myChoice = playoffVotes[playoffIdx]?.[authVal.user?.id]}
							{@const result = playoffResults[playoffIdx]}
							<button
								class="playoff-card"
								class:selected={myChoice === side.key}
								class:winner={result === side.key}
								class:loser={result && result !== side.key}
								onclick={() => castPlayoffVote(side.key)}
								disabled={!!myChoice}
							>
								<div class="playoff-thumb">
									{#if previewSrc}
										<img src={previewSrc} alt="" loading="lazy" referrerpolicy="no-referrer"/>
									{:else}
										<span class="playoff-icon">{({tiktok:'🎵',twitter:'🐦',youtube:'▶️',instagram:'📸',image:'🖼️',link:'🔗'})[embed.type] ?? '🔗'}</span>
									{/if}
								</div>
								<div class="playoff-info">
									<span class="playoff-score">{Math.round(side.entry.total_score / (side.entry.vote_count || 1) / session.session_memes.length * 100)}%</span>
									<span class="playoff-submitter">por {side.entry.submitted_by}</span>
								</div>
								{#if result === side.key}<div class="playoff-winner-badge">✅ Ganador</div>{/if}
							</button>
						{/each}
					</div>
					<div class="playoff-voters">
						{#each session.participants as p}
							{@const voted = !!playoffVotes[playoffIdx]?.[p.id]}
							<span class="playoff-voter-chip" class:voted>
								{p.display_name.slice(0,1).toUpperCase()} {voted ? '✓' : '…'}
							</span>
						{/each}
					</div>
				</div>
			{/if}
		{/if}

		<!-- RANKING VIEW -->
		{#if view === 'ranking'}
			{@const totalMemes = session.session_memes.length}
			{@const typeIcon = (t) => ({tiktok:'🎵',twitter:'🐦',youtube:'▶️',instagram:'📸',image:'🖼️',link:'🔗'})[t] ?? '🔗'}
			{@const typeAccent = (t) => ({tiktok:'#25f4ee',twitter:'#1da1f2',youtube:'#ff0000',instagram:'#f09433',image:'#9b6bff',link:'#5ee3d2'})[t] ?? '#9b6bff'}
			{@const avgSession = votes.length ? (votes.reduce((s,v) => s + v.value, 0) / votes.length).toFixed(1) : '—'}
			{@const superFavsCount = (() => {
				const n = session.participants.length;
				return session.session_memes.filter(sm => {
					const mv = votes.filter(v => v.meme_id === sm.meme.id);
					return mv.length >= n && mv.every(v => v.value === totalMemes);
				}).length;
			})()}

			<div class="rv-wrap">

				<!-- ── HERO ── -->
				<div class="rv-hero glass-strong">
					<div style="position:absolute;top:-50px;right:-20px;font-size:9rem;opacity:0.06;font-weight:800;pointer-events:none">🏆</div>

					<div class="rv-hero-top">
						{#if session.status === 'active'}
							<button class="btn-ghost rv-back" onclick={() => (view = 'presentation')}>
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
								Volver
							</button>
						{/if}
						<span class="rv-eyebrow">Sesión {session.status === 'finished' ? 'terminada' : 'en curso'}</span>
						<span class="chip chip-violet" style="font-size:0.65rem">{session.status === 'finished' ? '✓ FINISHED' : '▶ LIVE'}</span>
						{#if session.status === 'active'}
							<button class="btn-primary rv-finish" onclick={finishSession}>✅ Finalizar</button>
						{/if}
					</div>

					<h1 class="rv-session-name">{session.name}</h1>

					<div class="rv-stats">
						<div class="rv-stat">
							<div class="rv-stat-num">{ranking.length}</div>
							<div class="rv-stat-label">memes votados</div>
						</div>
						<div class="rv-stat">
							<div class="rv-stat-num rv-stat-accent">{avgSession}</div>
							<div class="rv-stat-label">nota media</div>
						</div>
						<div class="rv-stat">
							<div class="rv-stat-num">{superFavsCount}</div>
							<div class="rv-stat-label">super favs ⭐</div>
						</div>
						<div class="rv-stat">
							<div class="rv-stat-num">{session.participants.length}</div>
							<div class="rv-stat-label">participantes</div>
						</div>
						<div>
							<div class="rv-eyebrow" style="font-size:0.6rem;margin-bottom:0.4rem">Crew</div>
							<div style="display:inline-flex">
								{#each session.participants as p, i}
									<span class="rv-avatar" style="margin-left:{i===0?0:-8}px;z-index:{session.participants.length-i}" title={p.display_name}>
										{p.display_name.slice(0,2).toUpperCase()}
									</span>
								{/each}
							</div>
						</div>
					</div>
				</div>

				{#if !ranking.length}
					<div class="glass rv-empty">
						<p>No hay votos todavía</p>
					</div>
				{:else}
					{@const winner = ranking[0]}
					{@const winnerEmbed = detectEmbed(winner.url)}
					{@const winnerAvg = winner.vote_count ? winner.total_score / winner.vote_count : 0}
					{@const winnerPreview = rankingPreviewSrc(winner)}

					<!-- ── WINNER SPOTLIGHT ── -->
					<div class="rv-winner glass-strong">
						<!-- Thumbnail -->
						<a href={winner.url} target="_blank" rel="noopener noreferrer" class="rv-winner-thumb" style="border-color:{typeAccent(winnerEmbed.type)}33">
							{#if winnerPreview}
								<img src={winnerPreview} alt="" loading="lazy" referrerpolicy="no-referrer" />
							{:else}
								<span class="rv-winner-icon" style="color:{typeAccent(winnerEmbed.type)}">{typeIcon(winnerEmbed.type)}</span>
							{/if}
							<span class="rv-winner-platform" style="background:{typeAccent(winnerEmbed.type)}22;border-color:{typeAccent(winnerEmbed.type)}55;color:{typeAccent(winnerEmbed.type)}">
								{typeIcon(winnerEmbed.type)}
							</span>
						</a>

						<!-- Info -->
						<div class="rv-winner-info">
							<div class="rv-winner-badges">
								<span style="font-size:1.3rem">🥇</span>
								<span class="rv-eyebrow" style="color:var(--gold)">Ganador</span>
							</div>
							<p class="rv-winner-url">{winner.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 55)}{winner.url.length > 60 ? '…' : ''}</p>
							<div class="rv-winner-meta">
								<span style="color:{typeAccent(winnerEmbed.type)};font-weight:600">{winnerEmbed.type}</span>
								<span class="rv-dot">·</span>
								<span>añadido por <strong>{winner.submitted_by}</strong></span>
							</div>
							<!-- Per-user votes -->
							<div class="rv-winner-votes">
								{#each session.participants as p}
									{@const uv = votes.find(v => v.meme_id === winner.meme_id && v.user_id === p.id)}
									{@const high = uv && uv.value >= Math.round(totalMemes * 0.8)}
									{@const low  = uv && uv.value <= Math.round(totalMemes * 0.3)}
									<div class="rv-vote-chip"
										class:rv-vote-high={high}
										class:rv-vote-low={low}
										title="{p.display_name}: {uv ? uv.value + '/' + totalMemes : 'sin votar'}"
									>
										<span class="rv-vote-initial">{p.display_name.slice(0,1).toUpperCase()}</span>
										<strong class="rv-vote-val">{uv ? uv.value : '—'}</strong>
									</div>
								{/each}
							</div>
						</div>

						<!-- Big score -->
						<div class="rv-winner-score">
							<div class="rv-big-score">{winnerAvg.toFixed(1)}</div>
							<div class="rv-eyebrow" style="font-size:0.6rem;margin-top:0.3rem">nota media</div>
						</div>
					</div>

					<!-- ── TABS ── -->
					<div class="rv-tabs">
						<button class="rv-tab" class:active={resultTab === 'top'}     onclick={() => resultTab = 'top'}>🏆 Top 5</button>
						<button class="rv-tab" class:active={resultTab === 'bottom'}  onclick={() => resultTab = 'bottom'}>💀 Bottom 3</button>
						<button class="rv-tab" class:active={resultTab === 'players'} onclick={() => resultTab = 'players'}>👥 Por jugador</button>
					</div>

					<!-- ── TOP 5 ── -->
					{#if resultTab === 'top'}
						<div class="rv-rank-list">
							{#each ranking.slice(0, 5) as entry, i (entry.meme_id)}
								{@const embed = detectEmbed(entry.url)}
								{@const avg = entry.vote_count ? entry.total_score / entry.vote_count : 0}
								{@const medals = {0:'🥇',1:'🥈',2:'🥉'}}
								{@const isPodium = i < 3}
								{@const preview = rankingPreviewSrc(entry)}
								<div class="rv-rank-row glass" class:rv-rank-podium={isPodium}>
									<!-- Rank -->
									<div class="rv-rank-pos">
										{#if medals[i]}<span style="font-size:1.5rem">{medals[i]}</span>
										{:else}<span class="rv-rank-num">#{i+1}</span>{/if}
									</div>

									<!-- Platform thumb -->
									<a href={entry.url} target="_blank" rel="noopener noreferrer" class="rv-rank-thumb" style="background:linear-gradient(135deg,{typeAccent(embed.type)}33,{typeAccent(embed.type)}11);border-color:{typeAccent(embed.type)}22">
										{#if preview}
											<img src={preview} alt="" loading="lazy" referrerpolicy="no-referrer" />
										{:else}
											<span style="color:{typeAccent(embed.type)};font-size:1.3rem">{typeIcon(embed.type)}</span>
										{/if}
									</a>

									<!-- Info -->
									<div class="rv-rank-info">
										<div class="rv-rank-url">{entry.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}{entry.url.length > 53 ? '…' : ''}</div>
										<div class="rv-rank-sub">
											<span style="color:{typeAccent(embed.type)};font-size:0.72rem;font-weight:600">{embed.type}</span>
											<span class="rv-dot">·</span>
											<span>por {entry.submitted_by}</span>
										</div>
									</div>

									<!-- Per-user votes -->
									<div class="rv-rank-votes">
										{#each session.participants as p}
											{@const uv = votes.find(v => v.meme_id === entry.meme_id && v.user_id === p.id)}
											{@const high = uv && uv.value >= Math.round(totalMemes * 0.8)}
											{@const low  = uv && uv.value <= Math.round(totalMemes * 0.3)}
											<div class="rv-vote-chip"
												class:rv-vote-high={high}
												class:rv-vote-low={low}
												title="{p.display_name}: {uv ? uv.value + '/' + totalMemes : 'sin votar'}"
											>
												<span class="rv-vote-initial">{p.display_name.slice(0,1).toUpperCase()}</span>
												<strong class="rv-vote-val">{uv ? uv.value : '—'}</strong>
											</div>
										{/each}
									</div>

									<!-- Avg score -->
									<div class="rv-rank-avg">
										<div class="rv-rank-avg-num" style="color:var(--gold)">{avg.toFixed(1)}</div>
										<div class="rv-eyebrow" style="font-size:0.55rem">nota</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- ── BOTTOM 3 ── -->
					{#if resultTab === 'bottom'}
						<div class="rv-rank-list">
							{#each [...ranking].reverse().slice(0, 3) as entry, i (entry.meme_id)}
								{@const embed = detectEmbed(entry.url)}
								{@const avg = entry.vote_count ? entry.total_score / entry.vote_count : 0}
								{@const realIdx = ranking.findIndex(r => r.meme_id === entry.meme_id)}
								{@const preview = rankingPreviewSrc(entry)}
								{@const isDead = i === 0 && realIdx === ranking.length - 1}
								<div class="rv-rank-row glass rv-rank-bottom">
									<div class="rv-rank-pos">
										{#if isDead}<span style="font-size:1.5rem">💀</span>
										{:else}<span class="rv-rank-num" style="color:var(--coral-bright)">#{realIdx+1}</span>{/if}
									</div>

									<a href={entry.url} target="_blank" rel="noopener noreferrer" class="rv-rank-thumb" style="background:rgba(255,84,112,0.08);border-color:rgba(255,84,112,0.15)">
										{#if preview}
											<img src={preview} alt="" loading="lazy" referrerpolicy="no-referrer" />
										{:else}
											<span style="color:var(--coral-bright);font-size:1.3rem">{typeIcon(embed.type)}</span>
										{/if}
									</a>

									<div class="rv-rank-info">
										<div class="rv-rank-url">{entry.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}{entry.url.length > 53 ? '…' : ''}</div>
										<div class="rv-rank-sub">
											<span style="color:{typeAccent(embed.type)};font-size:0.72rem;font-weight:600">{embed.type}</span>
											<span class="rv-dot">·</span>
											<span>por {entry.submitted_by}</span>
										</div>
									</div>

									<div class="rv-rank-votes">
										{#each session.participants as p}
											{@const uv = votes.find(v => v.meme_id === entry.meme_id && v.user_id === p.id)}
											{@const high = uv && uv.value >= Math.round(totalMemes * 0.8)}
											{@const low  = uv && uv.value <= Math.round(totalMemes * 0.3)}
											<div class="rv-vote-chip" class:rv-vote-high={high} class:rv-vote-low={low}
												title="{p.display_name}: {uv ? uv.value + '/' + totalMemes : 'sin votar'}">
												<span class="rv-vote-initial">{p.display_name.slice(0,1).toUpperCase()}</span>
												<strong class="rv-vote-val">{uv ? uv.value : '—'}</strong>
											</div>
										{/each}
									</div>

									<div class="rv-rank-avg">
										<div class="rv-rank-avg-num" style="color:var(--coral-bright)">{avg.toFixed(1)}</div>
										<div class="rv-eyebrow" style="font-size:0.55rem">nota</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- ── BY PLAYER ── -->
					{#if resultTab === 'players'}
						<div class="rv-players-grid">
							{#each session.participants as p}
								{@const myVotes = votes.filter(v => v.user_id === p.id)}
								{@const avgGiven = myVotes.length ? (myVotes.reduce((s,v) => s + v.value, 0) / myVotes.length).toFixed(1) : '—'}
								{@const submitted = session.session_memes.filter(sm => sm.meme.user_id === p.id).length}
								{@const top5ids = ranking.slice(0, 5).map(r => r.meme_id)}
								{@const bot3ids = [...ranking].reverse().slice(0, 3).map(r => r.meme_id)}
								{@const inTop = session.session_memes.filter(sm => sm.meme.user_id === p.id && top5ids.includes(sm.meme.id)).length}
								{@const inBot = session.session_memes.filter(sm => sm.meme.user_id === p.id && bot3ids.includes(sm.meme.id)).length}
								{@const allGiven = votes.filter(v => v.user_id === p.id).map(v => v.value)}
								{@const isHarshest = allGiven.length && session.participants.every(pp => {
									const ov = votes.filter(v => v.user_id === pp.id).map(v => v.value);
									return !ov.length || (allGiven.reduce((s,x)=>s+x,0)/allGiven.length) <= (ov.reduce((s,x)=>s+x,0)/ov.length);
								})}
								{@const isKindest = allGiven.length && session.participants.every(pp => {
									const ov = votes.filter(v => v.user_id === pp.id).map(v => v.value);
									return !ov.length || (allGiven.reduce((s,x)=>s+x,0)/allGiven.length) >= (ov.reduce((s,x)=>s+x,0)/ov.length);
								})}
								<div class="rv-player-card glass">
									<div class="rv-player-header">
										<span class="rv-player-avatar">{p.display_name.slice(0,2).toUpperCase()}</span>
										<div>
											<div class="rv-player-name">{p.display_name}</div>
										</div>
										{#if isHarshest}<span class="chip chip-coral" style="font-size:0.65rem">😈 más duro</span>{/if}
										{#if isKindest}<span class="chip chip-teal" style="font-size:0.65rem">😇 más blando</span>{/if}
									</div>
									<div class="rv-player-stats">
										<div class="rv-mini-stat">
											<div class="rv-eyebrow" style="font-size:0.58rem">Memes aportados</div>
											<div class="rv-mini-num">{submitted}</div>
										</div>
										<div class="rv-mini-stat">
											<div class="rv-eyebrow" style="font-size:0.58rem">Nota media dada</div>
											<div class="rv-mini-num" style="font-family:var(--font-mono)">{avgGiven}</div>
										</div>
										<div class="rv-mini-stat">
											<div class="rv-eyebrow" style="font-size:0.58rem">En top 5</div>
											<div class="rv-mini-num" style="color:var(--gold)">{inTop}</div>
										</div>
										<div class="rv-mini-stat">
											<div class="rv-eyebrow" style="font-size:0.58rem">En bottom 3</div>
											<div class="rv-mini-num" style="color:var(--coral-bright)">{inBot}</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- ── HEATMAP (preserved) ── -->
					{@const _buckets = (() => {
						const arr = new Array(totalMemes + 1).fill(0);
						votes.forEach(v => { if (v.value >= 0 && v.value <= totalMemes) arr[v.value]++; });
						return arr;
					})()}
					{@const _maxBucket = Math.max(..._buckets, 1)}
					{@const _totalVotes = _buckets.reduce((s, c) => s + c, 0)}
					<div class="global-heatmap-wrap">
						<div class="global-heatmap-labels">
							<span>💀 Peor</span>
							<span class="heatmap-title">🌡️ {_totalVotes} votos · dónde cayeron</span>
							<span>🏆 Mejor</span>
						</div>
						<div class="global-heatmap">
							{#each _buckets as count, i}
								<div
									class="heatmap-cell"
									style="background:{heatColor(count / _maxBucket)};align-self:{count > 0 ? 'flex-end' : 'stretch'};height:{count > 0 ? Math.max(25, Math.round((count / _maxBucket) * 100)) : 15}%"
									title="Puntuación {i}: {count} voto{count !== 1 ? 's' : ''}"
								></div>
							{/each}
						</div>
						<!-- Emoji reactions -->
						{#if Object.keys(emojiCounts).length > 0}
							<div class="rv-reactions">
								<span class="rv-eyebrow" style="font-size:0.6rem">Reacciones</span>
								{#each Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]) as [emoji, count]}
									<span class="rv-reaction-item">{emoji}<strong>{count}</strong></span>
								{/each}
							</div>
						{/if}
					</div>

				{/if}
			</div><!-- /rv-wrap -->
		{/if}
	{:else}
		<p>Cargando...</p>
	{/if}
</div>

<style>
	/* ── Session header (new glassmorphism bar) ── */
	.session-header {
		margin-bottom: 1rem;
		padding: 0.75rem 1.1rem;
		border-radius: 14px;
	}
	.session-header-inner {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.sh-left {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex: 0 1 auto;
		min-width: 0;
	}
	.sh-title-group {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.sh-title {
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sh-live-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.68rem;
		padding: 0.18rem 0.55rem;
	}
	.sh-status-chip {
		font-size: 0.68rem;
		padding: 0.18rem 0.55rem;
	}
	.sh-meta {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.sh-timer {
		font-weight: 700;
		color: var(--coral);
	}
	.sh-sep { opacity: 0.4; }
	.sh-participant { color: var(--text-soft); }
	.sh-online { color: var(--teal); font-weight: 600; }
	.sh-progress {
		width: 200px;
		flex-shrink: 0;
	}
	.sh-prog-track {
		height: 5px;
		background: rgba(255,255,255,0.08);
		border-radius: 999px;
		overflow: hidden;
	}
	.sh-prog-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--teal), var(--violet));
		border-radius: 999px;
		transition: width 0.4s ease;
	}
	.sh-right {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}
	.sh-notepad-btn { font-size: 0.82rem; padding: 0.4rem 0.75rem; }
	.sh-notepad-active {
		background: rgba(94,227,210,0.12) !important;
		border-color: rgba(94,227,210,0.3) !important;
		color: var(--teal) !important;
	}

	.sync-toast {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-style: italic;
		animation: fadeIn 0.3s;
	}
	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	.chip {
		background: var(--glass-bg);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1px solid var(--glass-border);
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-soft);
	}
	.center-card {
		text-align: center;
		padding: 3rem 1.5rem;
	}
	.big-btn {
		margin-top: 1rem;
		padding: 1rem 2rem;
		font-size: 1.1rem;
	}
	.error {
		color: var(--accent);
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}

	/* Presentation */
	.presentation {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.progress-bar {
		text-align: center;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.bar {
		height: 4px;
		background: var(--bg-input);
		border-radius: 2px;
		margin-top: 0.3rem;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s;
	}

	.meme-display {
		min-height: 200px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}
	.meme-source {
		width: 100%;
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
	}
	/* Single-line unified source row (type + author + meta chips) */
	.meme-source-row {
		width: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.5rem;
		font-size: 0.78rem;
		padding-bottom: 0.1rem;
	}
	.meme-type {
		text-transform: uppercase;
		color: var(--accent);
		font-weight: 600;
	}
	.meme-author {
		color: var(--text-muted);
	}
	.embed-frame {
		width: 100%;
		aspect-ratio: 16/9;
		border: none;
		border-radius: 8px;
	}
	.meme-img {
		max-width: 100%;
		max-height: 400px;
		border-radius: 8px;
	}
	.meme-link {
		font-size: 1.1rem;
		padding: 2rem;
	}

	/* Voting */
	.voting {
		text-align: center;
	}
	/* ── Ranking slider ── */
	.voting {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0 0.25rem;
		width: 100%;
	}
	.rank-slider-wrap {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		max-width: 500px;
	}
	.rank-edge {
		font-size: 1.4rem;
		text-align: center;
		line-height: 1.2;
		flex-shrink: 0;
		user-select: none;
	}
	.rank-edge small { font-size: 0.58rem; color: var(--text-muted); display: block; }

	.rank-slider-track {
		position: relative;
		flex: 1;
		height: 48px; /* tall enough for badge + dots */
		display: flex;
		align-items: center;
	}

	/* The badge floats above the thumb */
	.rank-badge {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		background: var(--accent);
		color: #fff;
		font-size: 0.8rem;
		font-weight: 700;
		min-width: 28px;
		text-align: center;
		padding: 1px 6px;
		border-radius: 8px;
		pointer-events: none;
		z-index: 5;
		transition: left 0.05s;
		box-shadow: 0 2px 6px rgba(0,0,0,0.35);
	}
	.rank-badge::after {
		content: '';
		position: absolute;
		bottom: -4px;
		left: 50%;
		transform: translateX(-50%);
		border: 4px solid transparent;
		border-top-color: var(--accent);
		border-bottom: none;
	}

	/* The actual range input — gradient lives on the track pseudo-element */
	.rank-slider {
		width: 100%;
		-webkit-appearance: none;
		appearance: none;
		height: 14px;
		border-radius: 7px;
		background: transparent; /* gradient is on ::track below */
		outline: none;
		cursor: pointer;
		position: relative;
		z-index: 3;
	}
	.rank-slider::-webkit-slider-runnable-track {
		height: 14px;
		border-radius: 7px;
		background: linear-gradient(to right,
			#c53030 0%,
			#e53e3e 15%,
			#ed8936 35%,
			#ecc94b 55%,
			#68d391 75%,
			#38a169 100%
		);
		box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
	}
	.rank-slider::-moz-range-track {
		height: 14px;
		border-radius: 7px;
		background: linear-gradient(to right,
			#c53030 0%,
			#e53e3e 15%,
			#ed8936 35%,
			#ecc94b 55%,
			#68d391 75%,
			#38a169 100%
		);
	}
	.rank-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: #fff;
		border: 3px solid rgba(0,0,0,0.15);
		box-shadow: 0 2px 8px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.3);
		cursor: grab;
		transition: transform 0.12s, box-shadow 0.12s;
		position: relative;
		z-index: 4;
	}
	.rank-slider:hover::-webkit-slider-thumb {
		transform: scale(1.1);
		box-shadow: 0 3px 12px rgba(0,0,0,0.5), 0 0 0 3px rgba(255,255,255,0.4);
	}
	.rank-slider:active::-webkit-slider-thumb {
		transform: scale(1.18);
		cursor: grabbing;
	}
	.rank-slider::-moz-range-thumb {
		width: 28px; height: 28px;
		border-radius: 50%;
		background: #fff;
		border: 3px solid rgba(0,0,0,0.15);
		box-shadow: 0 2px 8px rgba(0,0,0,0.4);
		cursor: grab;
	}

	/* Dots: other users' votes, positioned above track */
	.other-vote-dot {
		position: absolute;
		top: -2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #4299e1;
		border: 2px solid #fff;
		transform: translateX(-50%);
		pointer-events: auto;
		z-index: 10;
		box-shadow: 0 0 0 2px #4299e1, 0 2px 6px rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: default;
	}
	.other-vote-initial {
		font-size: 0.55rem;
		font-weight: 800;
		color: #fff;
		line-height: 1;
		pointer-events: none;
		user-select: none;
	}

	.rank-hint {
		font-size: 0.83rem;
		color: var(--text-muted);
		margin: 0;
		text-align: center;
	}
	.rank-hint strong { color: var(--text); font-size: 1rem; }

	/* Nav */
	.nav-buttons {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	/* Ranking */
	/* ── Ranking view ── */
	.ranking-view {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.ranking-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 1.25rem 1.5rem;
		background: var(--glass-bg-strong);
		backdrop-filter: blur(32px) saturate(180%);
		-webkit-backdrop-filter: blur(32px) saturate(180%);
		border: 1px solid var(--glass-border-strong);
		border-radius: var(--r-lg);
		box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-md);
	}
	.ranking-actions { display: flex; gap: 0.5rem; }

	/* Podium */
	.podium {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		gap: 0.5rem;
		margin: 0.5rem 0 1rem;
		height: 220px;
	}
	.podium-entry {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		flex: 1;
		max-width: 120px;
	}
	.podium-media {
		width: 64px; height: 64px;
		border-radius: 12px;
		overflow: hidden;
		display: flex; align-items: center; justify-content: center;
		background: rgba(255,255,255,0.07);
		font-size: 2rem;
		text-decoration: none;
		border: 2px solid rgba(255,255,255,0.12);
		transition: transform 0.15s;
	}
	.podium-media:hover { transform: scale(1.06); }
	.podium-img { width: 100%; height: 100%; object-fit: cover; }
	.podium-icon { font-size: 2rem; }
	.podium-medal { font-size: 1.6rem; }
	.podium-score { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; }
	.podium-block {
		width: 100%;
		border-radius: 8px 8px 0 0;
	}
	.podium-block-1 { height: 80px; background: linear-gradient(180deg, #f6e05e, #d69e2e); }
	.podium-block-2 { height: 56px; background: linear-gradient(180deg, #e2e8f0, #a0aec0); }
	.podium-block-3 { height: 40px; background: linear-gradient(180deg, #fbd38d, #c05621); }
	.podium-1 { order: 2; }
	.podium-2 { order: 1; }
	.podium-3 { order: 3; }

	/* Full list */
	.ranking-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.ranking-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 10px;
		padding: 0.6rem 0.9rem;
		transition: background 0.15s;
	}
	.ranking-row:hover { background: rgba(255,255,255,0.06); }
	.ranking-row.top3 { border-color: rgba(246,224,94,0.25); }
	.ranking-row-bottom { border-color: rgba(229,62,62,0.18); }
	.ranking-pos-bottom { color: var(--accent); }
	.ranking-bar-fill-bottom {
		background: linear-gradient(to right, #1a1a1a, #6b1a1a, #c53030);
	}
	.ranking-divider {
		text-align: center;
		color: var(--text-muted);
		font-size: 0.75rem;
		padding: 0.25rem 0;
		opacity: 0.5;
		letter-spacing: 0.05em;
	}
	.ranking-pos {
		font-size: 1.1rem;
		font-weight: 700;
		min-width: 36px;
		text-align: center;
		flex-shrink: 0;
	}
	.ranking-type-icon {
		font-size: 1.4rem;
		width: 40px; height: 40px;
		border-radius: 8px;
		display: flex; align-items: center; justify-content: center;
		background: rgba(255,255,255,0.06);
		flex-shrink: 0;
		text-decoration: none;
		overflow: hidden;
	}
	.ranking-thumb {
		width: 40px; height: 40px; object-fit: cover;
	}
	.ranking-bar-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.ranking-bar-meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.78rem;
	}
	.ranking-submitter { color: var(--text-muted); }
	.ranking-pct { font-weight: 700; color: var(--text); }
	.ranking-bar-track {
		height: 6px;
		background: rgba(255,255,255,0.08);
		border-radius: 3px;
		overflow: hidden;
	}
	.ranking-bar-fill {
		height: 100%;
		background: linear-gradient(to right, #e53e3e, #ed8936, #ecc94b, #68d391);
		border-radius: 3px;
		transition: width 0.6s ease;
	}
	.ranking-user-votes {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		margin-top: 0.1rem;
	}
	.uv-chip {
		font-size: 0.7rem;
		background: rgba(255,255,255,0.07);
		border-radius: 6px;
		padding: 1px 6px;
		color: var(--text-muted);
		display: flex; gap: 3px; align-items: center;
	}
	.uv-chip.uv-mine { background: rgba(229,62,62,0.2); color: var(--text); }
	.uv-chip strong { color: var(--text); font-size: 0.75rem; }
	.tiktok-frame {
		aspect-ratio: 9/16;
		max-height: 560px;
	}
	.instagram-frame {
		aspect-ratio: 4/5;
		max-height: 500px;
	}
	.twitter-embed-wrap {
		width: 100%;
		display: flex;
		justify-content: center;
	}
	.twitter-embed {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem;
		color: var(--text-muted);
	}
	.tweet-hint {
		font-size: 0.85rem;
	}
	.open-btn {
		display: inline-block;
		padding: 0.6rem 1.2rem;
	}
	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem 0;
	}

	/* Ready system */
	.ready-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 320px;
		margin: 1rem auto;
	}
	.ready-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0;
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.ready-check {
		color: #4caf50;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.ready-wait {
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.ready-msg {
		color: var(--text-muted);
		font-size: 0.9rem;
		margin-top: 0.5rem;
	}
	.start-btn {
		margin-top: 0.75rem;
	}
	.start-ready-btn {
		animation: pulse-green 1s ease-in-out infinite alternate;
	}
	@keyframes pulse-green {
		from { box-shadow: 0 0 0 0 rgba(104, 211, 145, 0); }
		to   { box-shadow: 0 0 16px 4px rgba(104, 211, 145, 0.45); }
	}

	.btn-cancel-session {
		margin-top: 1.5rem;
		background: none;
		border: 1px solid rgba(229,62,62,0.3);
		color: rgba(229,62,62,0.7);
		border-radius: 8px;
		padding: 0.4rem 1rem;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.btn-cancel-session:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: rgba(229,62,62,0.08);
	}

	.fun-buttons-wrap {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
	}
	.fun-buttons-review {
		margin-top: 0.75rem;
	}
	.fun-buttons-label {
		font-size: 0.8rem;
		color: var(--text-muted);
		margin: 0;
	}
	.fun-buttons {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}
	.fun-btn {
		font-size: 1.6rem;
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 12px;
		padding: 0.4rem 0.6rem;
		cursor: pointer;
		transition: transform 0.1s, background 0.1s;
		line-height: 1;
	}
	.fun-btn-sm {
		font-size: 1.2rem;
		padding: 0.3rem 0.45rem;
		border-radius: 10px;
	}
	.fun-btn:hover  { background: rgba(255,255,255,0.12); }
	.fun-btn:active { transform: scale(0.88); }

	.floating-emoji {
		position: fixed;
		bottom: 12%;
		font-size: 2.8rem;
		pointer-events: none;
		z-index: 9999;
		animation: float-up 1.8s ease-out forwards;
		transform: translateX(-50%);
		filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
	}
	@keyframes float-up {
		0%   { opacity: 1;   transform: translateX(-50%) translateY(0)     scale(1); }
		60%  { opacity: 1;   transform: translateX(-50%) translateY(-120px) scale(1.2); }
		100% { opacity: 0;   transform: translateX(-50%) translateY(-220px) scale(0.8); }
	}

	.dl-progress-wrap {
		margin: 1.5rem auto 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		width: min(340px, 90%);
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 12px;
		padding: 1.25rem 1.5rem;
	}
	.dl-progress-label {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
		margin: 0;
		text-align: center;
	}
	.dl-failed {
		color: var(--accent);
		font-size: 0.8rem;
		font-weight: 400;
	}
	.dl-progress-bar {
		width: 100%;
		height: 10px;
		background: rgba(255,255,255,0.1);
		border-radius: 5px;
		overflow: hidden;
	}
	.dl-progress-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 5px;
		transition: width 0.5s ease;
		box-shadow: 0 0 8px rgba(229,62,62,0.5);
	}
	.dl-progress-stats {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem 0.75rem;
		width: 100%;
	}
	.dl-stat {
		font-size: 0.82rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.dl-speed {
		color: #68d391;
		font-weight: 600;
	}
	.dl-eta {
		color: #90cdf4; /* light blue */
	}
	.dl-progress-sub {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0;
		text-align: center;
		opacity: 0.65;
	}

	/* Shared wrapper for sync-capable embeds */
	.sync-media-wrap {
		position: relative;
		width: 100%;
	}

	.local-video {
		background: #000;
	}

	.unmute-overlay {
		position: absolute;
		bottom: 48px; /* above video controls */
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.75);
		color: #fff;
		border: none;
		border-radius: 20px;
		padding: 8px 18px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		z-index: 10;
		backdrop-filter: blur(4px);
		transition: background 0.15s;
	}
	.unmute-overlay:hover {
		background: rgba(229, 62, 62, 0.85);
	}

	/* ── Side nav layout ── */
	.meme-and-nav {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.meme-and-nav > .card { flex: 1; min-width: 0; }

	/* Left panel: prev button + fun emoji sidebar */
	.left-panel {
		width: 44px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.left-panel > .nav-side { width: 100%; height: 52px; flex: none; }
	.fun-side-buttons {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 2px 0;
	}
	.fun-btn-side {
		font-size: 1.2rem;
		padding: 0.2rem;
		border-radius: 8px;
		width: 38px;
		height: 38px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.08);
		cursor: pointer;
		transition: transform 0.1s, background 0.1s;
		line-height: 1;
	}
	.fun-btn-side:hover  { background: rgba(255,255,255,0.12); }
	.fun-btn-side:active { transform: scale(0.85); }

	/* Right panel: next nav + notepad (inline, same row as video) */
	.right-panel {
		flex-shrink: 0;
		width: 80px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		position: sticky;
		top: 1rem;
		align-self: flex-start;
	}
	.nav-side {
		width: 44px;
		flex-shrink: 0;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 12px;
		font-size: 2rem;
		color: var(--text);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		padding: 0;
		line-height: 1;
	}
	.nav-side:hover:not(:disabled) { background: rgba(255,255,255,0.1); }
	.nav-side:disabled { opacity: 0.2; cursor: not-allowed; }
	.nav-side.nav-ready {
		background: rgba(104,211,145,0.15);
		border-color: rgba(104,211,145,0.35);
	}
	.nav-side-wrap {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
	}
	.nav-side-wrap > .nav-side { flex: none; height: 52px; width: 100%; }
	.next-vote-dots {
		display: flex;
		flex-direction: column;
		gap: 5px;
		align-items: flex-start;
		padding: 4px 0;
		width: 100%;
	}
	.next-vote-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.next-vote-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: rgba(255,255,255,0.15);
		border: 2px solid rgba(255,255,255,0.2);
		transition: all 0.2s;
		flex-shrink: 0;
	}
	.next-vote-dot.voted {
		background: #68d391;
		border-color: #38a169;
		box-shadow: 0 0 8px rgba(104,211,145,0.7);
	}
	.next-vote-name {
		font-size: 0.65rem;
		color: var(--text-muted);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		max-width: 60px;
		text-overflow: ellipsis;
	}
	.next-vote-item.voted .next-vote-name {
		color: #68d391;
		font-weight: 700;
	}

	/* ── Presentation + notepad wrapper ── */
	.presentation-wrap {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}
	.presentation-wrap > .presentation { flex: 1; min-width: 0; }

	/* ── Notepad sidebar ── */
	.notepad-sidebar {
		width: 260px;
		flex-shrink: 0;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: sticky;
		top: 1rem;
		max-height: calc(100vh - 120px);
	}
	.notepad-header {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.notepad-close {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.9rem;
		padding: 0;
		line-height: 1;
	}
	.notepad-textarea {
		flex: 1;
		background: none;
		border: none;
		color: var(--text);
		font-size: 0.84rem;
		padding: 0.75rem;
		resize: none;
		font-family: inherit;
		line-height: 1.6;
		min-height: 300px;
	}
	.notepad-textarea:focus { outline: none; }
	.notepad-textarea::placeholder { color: var(--text-muted); opacity: 0.4; }

	/* ── Notepad toggle button ── */
	.session-header-top {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.session-header-top > .page-title { flex: 1; margin: 0; }
	.btn-notepad {
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 10px;
		padding: 0.35rem 0.6rem;
		font-size: 1.1rem;
		cursor: pointer;
		transition: background 0.15s;
		line-height: 1;
		flex-shrink: 0;
	}
	.btn-notepad:hover { background: rgba(255,255,255,0.12); }
	.btn-notepad.active {
		background: rgba(229,62,62,0.15);
		border-color: rgba(229,62,62,0.3);
	}

	/* ── Full-width rank slider ── */
	.rank-slider-full {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.rank-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	/* ── Used-score ticks ── */
	.taken-tick {
		position: absolute;
		top: -3px;
		width: 3px;
		height: 20px;
		background: rgba(229,62,62,0.55);
		border-radius: 2px;
		transform: translateX(-50%);
		pointer-events: none;
		z-index: 1;
	}

	/* ── Duplicate badge ── */
	.dup-badge {
		display: inline-block;
		background: rgba(229,62,62,0.2);
		color: var(--accent);
		border: 1px solid rgba(229,62,62,0.3);
		border-radius: 6px;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0 4px;
		margin-left: 4px;
		vertical-align: middle;
	}

	/* ── Ranking section labels ── */
	.ranking-section-label {
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		margin-top: 0.5rem;
	}
	.ranking-label-top {
		background: rgba(246,224,94,0.1);
		color: #f6e05e;
	}
	.ranking-label-cringe {
		background: rgba(229,62,62,0.1);
		color: var(--accent);
	}

	/* ── Session page (full-width) ── */
	.session-page {
		width: 100%;
		max-width: 1100px;
		margin: 0 auto;
		padding: 1rem 1.25rem 3rem;
		box-sizing: border-box;
	}
	/* Full-bleed presentation mode — height + overflow handled in grid section below */
	.session-page.pres-mode {
		max-width: 100%;
		padding: 0.6rem 0.75rem 0.55rem;
	}

	/* ── Shared cursors ── */
	.shared-cursor {
		position: fixed;
		pointer-events: none;
		z-index: 9998;
		transform: translate(-4px, -4px);
		transition: left 0.06s linear, top 0.06s linear;
		display: flex;
		align-items: flex-start;
		gap: 4px;
	}
	.shared-cursor-label {
		font-size: 0.65rem;
		background: var(--cc, #e53e3e);
		color: #fff;
		border-radius: 6px;
		padding: 1px 5px;
		margin-top: 14px;
		white-space: nowrap;
		box-shadow: 0 1px 4px rgba(0,0,0,0.4);
	}

	/* ── TikTok/video metadata row ── */
	.meme-meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.5rem;
		width: 100%;
		padding: 0 0.1rem;
	}
	.meta-chip {
		font-size: 0.72rem;
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 6px;
		padding: 1px 6px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.meta-uploader {
		color: var(--text);
		font-weight: 600;
		background: rgba(229,62,62,0.08);
		border-color: rgba(229,62,62,0.18);
	}

	/* ── Superfav flash ── */
	.superfav-flash {
		text-align: center;
		font-size: 1rem;
		font-weight: 800;
		color: #f6e05e;
		text-shadow: 0 0 12px rgba(246,224,94,0.6);
		animation: superfav-pop 0.4s ease-out;
		letter-spacing: 0.05em;
	}
	@keyframes superfav-pop {
		0%   { transform: scale(0.5); opacity: 0; }
		70%  { transform: scale(1.1); opacity: 1; }
		100% { transform: scale(1);   opacity: 1; }
	}

	/* ── Superfavorites pending gallery ── */
	.superfav-gallery {
		margin-top: 1.5rem;
		width: 100%;
		max-width: 400px;
	}
	.superfav-gallery-label {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin: 0 0 0.5rem;
		text-align: center;
	}
	.superfav-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.superfav-cell {
		aspect-ratio: 1;
		border-radius: 6px;
		overflow: hidden;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.08);
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
		transition: transform 0.15s;
	}
	.superfav-cell:hover { transform: scale(1.04); }
	.superfav-cell img { width: 100%; height: 100%; object-fit: cover; }
	.superfav-cell-icon { font-size: 1.4rem; }

	/* ── Playoff view ── */
	.playoff-view {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
		padding: 1rem 0;
	}
	.playoff-header { text-align: center; }
	.playoff-header h3 { margin: 0; font-size: 1.3rem; }
	.playoff-sub { margin: 0.25rem 0 0; color: var(--text-muted); font-size: 0.85rem; }
	.playoff-pair {
		display: flex;
		gap: 1rem;
		width: 100%;
		max-width: 600px;
	}
	.playoff-card {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		background: rgba(255,255,255,0.04);
		border: 2px solid rgba(255,255,255,0.1);
		border-radius: 14px;
		padding: 1rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, transform 0.15s;
		position: relative;
	}
	.playoff-card:hover:not(:disabled):not(.selected) {
		background: rgba(255,255,255,0.08);
		transform: scale(1.02);
	}
	.playoff-card.selected {
		border-color: var(--accent);
		background: rgba(229,62,62,0.1);
	}
	.playoff-card.winner {
		border-color: #68d391;
		background: rgba(104,211,145,0.1);
		animation: winner-glow 0.6s ease-out;
	}
	.playoff-card.loser { opacity: 0.4; }
	@keyframes winner-glow {
		0%   { box-shadow: 0 0 0 0 rgba(104,211,145,0); }
		50%  { box-shadow: 0 0 20px 6px rgba(104,211,145,0.4); }
		100% { box-shadow: 0 0 0 0 rgba(104,211,145,0); }
	}
	.playoff-card:disabled { cursor: default; }
	.playoff-thumb {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 10px;
		overflow: hidden;
		background: rgba(255,255,255,0.06);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.playoff-thumb img { width: 100%; height: 100%; object-fit: cover; }
	.playoff-icon { font-size: 2.5rem; }
	.playoff-info { display: flex; flex-direction: column; align-items: center; gap: 2px; }
	.playoff-score { font-size: 1.1rem; font-weight: 700; }
	.playoff-submitter { font-size: 0.72rem; color: var(--text-muted); }
	.playoff-winner-badge {
		position: absolute;
		top: 0.5rem; right: 0.5rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: #68d391;
	}
	.playoff-voters {
		display: flex;
		gap: 0.4rem;
	}
	.playoff-voter-chip {
		font-size: 0.72rem;
		background: rgba(255,255,255,0.06);
		border-radius: 8px;
		padding: 2px 8px;
		color: var(--text-muted);
		transition: background 0.2s, color 0.2s;
	}
	.playoff-voter-chip.voted {
		background: rgba(104,211,145,0.15);
		color: #68d391;
	}

	/* ── Inline notepad panel (flex sibling of right-panel in meme-and-nav) ── */
	.notepad-panel {
		width: 300px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: calc(100vh - 140px);
		align-self: flex-start;
		position: sticky;
		top: 1rem;
		overflow-y: auto;
	}
	.sidebar-card {
		background: var(--glass-bg);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid var(--glass-border);
		border-radius: 14px;
		overflow: hidden;
		flex-shrink: 0;
	}
	.notepad-grow {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.sidebar-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.7rem 0.85rem 0.5rem;
		gap: 0.5rem;
	}
	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--teal);
		box-shadow: 0 0 6px var(--teal);
		animation: statusPulse 1.4s ease-in-out infinite;
		flex-shrink: 0;
	}
	@keyframes statusPulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.75); }
	}

	/* Participants list */
	.participants-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0 0.85rem 0.85rem;
	}
	.participant-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.participant-avatar {
		width: 30px;
		height: 30px;
		border-radius: 10px;
		background: linear-gradient(135deg, var(--coral), var(--violet));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.participant-info {
		flex: 1;
		min-width: 0;
	}
	.participant-name {
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.2;
	}
	.participant-status {
		font-size: 0.7rem;
	}

	/* Reactions grid */
	.reactions-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 0 0.85rem 0.85rem;
	}
	.reaction-btn {
		position: relative;
		min-width: 38px;
		height: 38px;
		padding: 0 8px;
		border-radius: 11px;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255,255,255,0.08);
		color: var(--text);
		font-family: inherit;
		cursor: pointer;
		font-size: 1.1rem;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		transition: transform 0.1s, background 0.15s;
	}
	.reaction-btn.reaction-active {
		background: rgba(255,84,112,0.12);
		border-color: rgba(255,84,112,0.3);
	}
	.reaction-btn:hover { background: rgba(255,255,255,0.1); }
	.reaction-btn:active { transform: scale(0.88); }
	.reaction-count {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--coral-bright);
	}

	.notepad-panel .notepad-textarea,
	.sesh-sidebar .notepad-textarea {
		flex: 1;
		min-height: 160px;
	}
	.kofi-link-panel {
		display: block;
		text-align: center;
		font-size: 0.78rem;
		color: var(--text-muted);
		text-decoration: none;
		padding: 0.35rem 0.5rem;
		border-top: 1px solid rgba(255,255,255,0.06);
		transition: color 0.2s;
	}
	.kofi-link-panel:hover { color: var(--text); }

	/* ── Global vote density heatmap ── */
	.global-heatmap-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 1rem 1.1rem;
		background: var(--glass-bg);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid var(--glass-border);
		border-radius: var(--r-lg);
		box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-sm);
	}
	.global-heatmap-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.heatmap-title {
		font-weight: 600;
		letter-spacing: 0.03em;
	}
	.global-heatmap {
		display: flex;
		align-items: flex-end;
		height: 52px;
		border-radius: 6px;
		overflow: hidden;
		gap: 1px;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.06);
		padding: 0 1px 1px;
	}
	.heatmap-cell {
		flex: 1;
		border-radius: 2px 2px 0 0;
		min-width: 0;
		transition: opacity 0.15s;
		cursor: default;
	}
	.heatmap-cell:hover { opacity: 0.75; }

	/* ── Emoji reaction summary (ranking view) ── */
	.emoji-summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.4rem 0.75rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.07);
		border-radius: 10px;
		font-size: 0.82rem;
	}
	.emoji-summary-label {
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.emoji-summary-item {
		display: flex;
		align-items: center;
		gap: 3px;
		background: rgba(255,255,255,0.06);
		border-radius: 8px;
		padding: 2px 7px;
	}
	.emoji-summary-item strong {
		font-size: 0.75rem;
		color: var(--text);
	}

	.media-loading {
		font-size: 0.8rem;
		color: var(--text-muted);
		text-align: center;
		padding: 0.3rem 0;
		animation: fadeIn 0.3s;
	}
	.slideshow-badge {
		color: #90cdf4;
		font-weight: 600;
	}
	.out-of-sync-hint {
		font-size: 0.82rem;
		color: var(--accent);
		text-align: center;
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		background: rgba(255, 100, 60, 0.1);
		animation: fadeIn 0.3s;
	}
	.autoplay-hint {
		font-size: 0.82rem;
		color: var(--text-muted);
		text-align: center;
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.06);
		animation: fadeIn 0.3s;
	}

	/* ══════════════════════════════════════════
	   RESULTS VIEW  (.rv-*)
	══════════════════════════════════════════ */
	.rv-wrap {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ── Hero ── */
	.rv-hero {
		position: relative;
		overflow: hidden;
		padding: 1.5rem 1.75rem;
		border-radius: var(--r-lg);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.rv-hero-top {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.rv-back { flex-shrink: 0; }
	.rv-finish { margin-left: auto; }
	.rv-eyebrow {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
	.rv-session-name {
		font-size: clamp(1.4rem, 4vw, 2.2rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		margin: 0;
		line-height: 1.1;
	}
	.rv-stats {
		display: flex;
		align-items: flex-end;
		gap: 1.5rem;
		flex-wrap: wrap;
	}
	.rv-stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.rv-stat-num {
		font-size: 1.8rem;
		font-weight: 800;
		letter-spacing: -0.04em;
		font-family: var(--font-mono);
		line-height: 1;
	}
	.rv-stat-accent { color: var(--teal); }
	.rv-stat-label {
		font-size: 0.7rem;
		color: var(--text-muted);
		font-weight: 500;
	}
	.rv-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--coral), var(--violet));
		border: 2px solid var(--glass-bg-strong);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.62rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
	}

	/* ── Winner spotlight ── */
	.rv-winner {
		display: flex;
		gap: 1.25rem;
		align-items: flex-start;
		padding: 1.25rem 1.5rem;
		border-radius: var(--r-lg);
		position: relative;
		overflow: hidden;
	}
	.rv-winner-thumb {
		flex-shrink: 0;
		width: 120px;
		height: 120px;
		border-radius: 14px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid;
		text-decoration: none;
		position: relative;
		transition: transform 0.15s;
	}
	.rv-winner-thumb:hover { transform: scale(1.03); }
	.rv-winner-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.rv-winner-icon { font-size: 2.8rem; }
	.rv-winner-platform {
		position: absolute;
		bottom: 5px;
		right: 5px;
		font-size: 0.8rem;
		border-radius: 8px;
		border: 1px solid;
		padding: 1px 5px;
		backdrop-filter: blur(8px);
		line-height: 1.4;
	}
	.rv-winner-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.rv-winner-badges {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.rv-winner-url {
		font-size: 0.85rem;
		color: var(--text-soft);
		font-family: var(--font-mono);
		word-break: break-all;
		margin: 0;
	}
	.rv-winner-meta {
		font-size: 0.8rem;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.rv-winner-votes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.2rem;
	}
	.rv-winner-score {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}
	.rv-big-score {
		font-size: 2.8rem;
		font-weight: 800;
		letter-spacing: -0.05em;
		font-family: var(--font-mono);
		color: var(--gold);
		text-shadow: 0 0 24px rgba(255, 209, 102, 0.4);
		line-height: 1;
	}
	.rv-dot { opacity: 0.4; }

	/* ── Vote chips ── */
	.rv-vote-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		font-size: 0.72rem;
		transition: background 0.15s;
	}
	.rv-vote-chip.rv-vote-high {
		background: rgba(94, 227, 210, 0.12);
		border-color: rgba(94, 227, 210, 0.3);
		color: var(--teal);
	}
	.rv-vote-chip.rv-vote-low {
		background: rgba(255, 84, 112, 0.1);
		border-color: rgba(255, 84, 112, 0.25);
		color: var(--coral-bright);
	}
	.rv-vote-initial {
		font-size: 0.62rem;
		font-weight: 700;
		opacity: 0.65;
	}
	.rv-vote-val { font-weight: 700; }

	/* ── Tabs ── */
	.rv-tabs {
		display: flex;
		gap: 0.35rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--glass-border);
		border-radius: 12px;
		padding: 0.3rem;
	}
	.rv-tab {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border-radius: 9px;
		border: none;
		background: none;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.rv-tab:hover { background: rgba(255, 255, 255, 0.06); color: var(--text); }
	.rv-tab.active {
		background: var(--glass-bg-strong);
		color: var(--text);
		box-shadow: inset 0 1px 0 var(--glass-highlight);
	}

	/* ── Rank list ── */
	.rv-rank-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.rv-rank-row {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.75rem 1rem;
		border-radius: var(--r-md);
		transition: transform 0.12s;
	}
	.rv-rank-row:hover { transform: translateY(-1px); }
	.rv-rank-podium {
		border-color: rgba(255, 209, 102, 0.2) !important;
		box-shadow: inset 0 1px 0 rgba(255, 209, 102, 0.08), var(--shadow-sm);
	}
	.rv-rank-bottom {
		border-color: rgba(255, 84, 112, 0.18) !important;
	}
	.rv-rank-pos {
		flex-shrink: 0;
		width: 36px;
		text-align: center;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.rv-rank-num {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-muted);
	}
	.rv-rank-thumb {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		border-radius: 10px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid;
		text-decoration: none;
		transition: transform 0.12s;
	}
	.rv-rank-thumb:hover { transform: scale(1.06); }
	.rv-rank-thumb img { width: 100%; height: 100%; object-fit: cover; }
	.rv-rank-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.rv-rank-url {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text);
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rv-rank-sub {
		font-size: 0.74rem;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.rv-rank-votes {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		flex-shrink: 0;
	}
	.rv-rank-avg {
		flex-shrink: 0;
		text-align: center;
		min-width: 44px;
	}
	.rv-rank-avg-num {
		font-size: 1.2rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		font-family: var(--font-mono);
		line-height: 1;
	}

	/* ── Players grid ── */
	.rv-players-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
	}
	.rv-player-card {
		padding: 1.1rem 1.2rem;
		border-radius: var(--r-lg);
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.rv-player-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.rv-player-avatar {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--violet), var(--coral));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
	}
	.rv-player-name {
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.rv-player-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}
	.rv-mini-stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
	}
	.rv-mini-num {
		font-size: 1.3rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		font-family: var(--font-mono);
		line-height: 1;
	}

	/* ── Reactions ── */
	.rv-reactions {
		display: flex;
		align-items: center;
		gap: 0.4rem 0.6rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}
	.rv-reaction-item {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.85rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		padding: 2px 8px;
	}
	.rv-reaction-item strong {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	/* ── Empty state ── */
	.rv-empty {
		text-align: center;
		padding: 2.5rem 1.5rem;
		border-radius: var(--r-lg);
		color: var(--text-muted);
		font-size: 0.95rem;
	}

	/* ── Responsive tweaks for small screens ── */
	@media (max-width: 560px) {
		.rv-winner { flex-wrap: wrap; }
		.rv-winner-thumb { width: 90px; height: 90px; }
		.rv-winner-score { width: 100%; flex-direction: row; align-items: baseline; gap: 0.5rem; }
		.rv-big-score { font-size: 2rem; }
		.rv-rank-votes { display: none; } /* hide per-user chips on mobile to save space */
		.rv-stats { gap: 1rem; }
		.rv-stat-num { font-size: 1.4rem; }
	}

	/* ══════════════════════════════════════════
	   PRESENTATION GRID LAYOUT (v2 - handoff match)
	══════════════════════════════════════════ */

	/* Compact in-grid top bar */
	.pres-topbar {
		padding: 0.65rem 1rem;
		border-radius: 14px;
		display: flex;
		align-items: center;
		gap: 0.85rem;
		flex-shrink: 0;
	}
	.pres-back {
		width: 32px;
		height: 32px;
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	.pres-title-group {
		flex: 1;
		min-width: 0;
	}
	.pres-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.pres-name {
		font-size: 0.95rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pres-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.74rem;
		color: var(--text-muted);
		margin-top: 0.12rem;
	}
	.pres-sep { opacity: 0.4; }
	.pres-progress {
		width: 200px;
		flex-shrink: 0;
	}
	.pres-notepad-btn {
		font-size: 0.82rem;
		padding: 0.38rem 0.75rem;
		flex-shrink: 0;
		white-space: nowrap;
	}

	/* ── Pres-mode: full-height grid ── */
	.session-page.pres-mode {
		height: calc(100dvh - 52px);
		overflow: hidden;
	}

	/* Grid wrapper — 3 cols: left-hud | video | (sidebar) */
	.sesh-grid {
		display: grid;
		grid-template-columns: 220px 1fr;
		grid-template-rows: auto 1fr;
		gap: 0.6rem;
		height: 100%;
	}
	.sesh-with-sidebar {
		grid-template-columns: 220px 1fr 340px;
	}
	/* Topbar spans all columns */
	.sesh-full-row {
		grid-column: 1 / -1;
	}

	/* Left HUD column */
	.sesh-left {
		display: flex;
		flex-direction: column;
		gap: 0;
		border-radius: 16px;
		overflow: hidden;
		min-width: 0;
	}

	/* Meta section (platform badge + title + stats + submitter) */
	.sl-meta {
		padding: 0.75rem 0.85rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		border-bottom: 1px solid rgba(255,255,255,0.07);
	}
	.sl-plat-row {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
	}
	.sl-title-wrap { flex: 1; min-width: 0; }
	.sl-title {
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.sl-title-muted { color: var(--text-muted); font-style: italic; font-weight: 400; }
	.sl-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}
	.sl-uploader {
		font-size: 0.72rem;
		font-weight: 600;
	}
	.sl-submitter-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: var(--text-muted);
	}
	.sl-submitter-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Vertical vote area */
	.sl-vote {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.6rem 0.85rem;
		gap: 0.4rem;
		border-bottom: 1px solid rgba(255,255,255,0.07);
		min-height: 0;
	}
	.sl-vote-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}
	.sl-vote-display { display: flex; align-items: baseline; gap: 3px; }
	.sl-vote-num {
		font-size: 1.8rem;
		font-weight: 800;
		font-family: var(--font-mono);
		letter-spacing: -0.04em;
		line-height: 1;
		color: rgba(255,255,255,0.22);
		transition: color 0.2s;
	}
	.sl-vote-num.sl-vote-active { color: var(--coral-bright); }
	.sl-vote-denom { font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono); }

	/* Track area: emoji + slider + emoji */
	.sl-track-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		min-height: 0;
		width: 100%;
	}
	.sl-emoji-label { font-size: 1rem; line-height: 1; }
	.sl-track-wrap {
		flex: 1;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		width: 36px;
	}
	/* Gradient track (plain div, completely isolated from writing-mode) */
	.sl-track-visual {
		position: absolute;
		left: 50%;
		top: 0;
		width: 6px;
		height: 100%;
		transform: translateX(-50%);
		border-radius: 999px;
		background: linear-gradient(to top, #ff3b3b 0%, #ffb800 50%, #2bd4a7 100%);
		pointer-events: none;
		z-index: 0;
	}
	/* Vertical range input */
	.sl-range-v {
		writing-mode: vertical-lr;
		direction: rtl;
		-webkit-appearance: slider-vertical;
		appearance: none;
		width: 6px;
		height: 100%;
		cursor: pointer;
		background: transparent;
		border-radius: 999px;
		outline: none;
		border: none;
		flex-shrink: 0;
		position: relative;
		z-index: 1;
	}
	.sl-range-v::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 2px 8px rgba(0,0,0,0.5);
		cursor: pointer;
		border: 2px solid rgba(255,255,255,0.3);
		transition: transform 0.15s;
	}
	.sl-range-v::-webkit-slider-thumb:hover { transform: scale(1.18); }
	.sl-range-v::-moz-range-thumb {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 2px 8px rgba(0,0,0,0.5);
		border: 2px solid rgba(255,255,255,0.3);
		cursor: pointer;
	}
	/* Other-user vote dots (vertical positioning) */
	.other-vote-dot-v {
		position: absolute;
		left: calc(100% + 4px);
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--violet), var(--coral));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.5rem;
		font-weight: 800;
		color: #fff;
		transform: translateY(50%);
		pointer-events: none;
		z-index: 2;
	}

	/* Who voted row */
	.sl-who-voted {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		justify-content: center;
		width: 100%;
	}

	/* Transport section */
	.sl-transport {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.65rem 0.85rem 0.75rem;
	}
	.sl-media-btns { display: flex; gap: 0.35rem; }
	.sl-fun-row {
		display: flex;
		gap: 0.2rem;
		flex-wrap: wrap;
	}
	.sl-nav-btns { display: flex; gap: 0.4rem; }
	.sl-nav-btn {
		flex: 1;
		font-size: 0.8rem;
		padding: 0.45rem 0.5rem;
		border-radius: 10px;
		white-space: nowrap;
		text-align: center;
	}

	/* Stage wrap: centering container */
	.stage-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	/* Video stage */
	.video-stage {
		position: relative;
		border-radius: 18px;
		overflow: hidden;
		background: linear-gradient(135deg, color-mix(in srgb, var(--plat-c, #7c6fd4) 15%, transparent), color-mix(in srgb, var(--plat-c, #7c6fd4) 4%, transparent)), #0a0612;
		border: 1px solid rgba(255,255,255,0.08);
		box-shadow: 0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08);
		display: flex;
		align-items: center;
		justify-content: center;
		/* Default: wide (16/9) */
		width: 100%;
		aspect-ratio: 16/9;
		max-height: 100%;
	}
	.video-stage-vertical {
		aspect-ratio: 9/16;
		width: auto;
		height: 100%;
		max-width: min(100%, calc(100% * 9 / 16));
	}
	.stage-embed {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}
	.stage-embed-wrap {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.stage-video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.stage-image {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		display: block;
	}
	.stage-placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2rem;
		height: 100%;
		width: 100%;
	}
	.stage-plat-glyph {
		font-size: 5rem;
		opacity: 0.22;
		filter: saturate(0.6);
	}

	/* SYNCED badge */
	.synced-badge {
		position: absolute;
		top: 14px;
		left: 14px;
		z-index: 5;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: rgba(0,0,0,0.52);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid rgba(255,255,255,0.12);
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--text);
		pointer-events: none;
	}
	.synced-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #ff3b3b;
		box-shadow: 0 0 10px #ff3b3b;
		animation: statusPulse 1.4s ease-in-out infinite;
	}

	/* Superfav flash inside stage */
	.superfav-stage-flash {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 10;
		font-size: 1.3rem;
		font-weight: 800;
		background: linear-gradient(135deg, rgba(255,200,0,0.92), rgba(255,140,0,0.92));
		border-radius: 14px;
		padding: 0.5rem 1.3rem;
		color: #fff;
		white-space: nowrap;
		animation: superfavPop 0.3s cubic-bezier(0.175,0.885,0.32,1.275);
		pointer-events: none;
		box-shadow: 0 8px 32px rgba(255,180,0,0.4);
	}
	@keyframes superfavPop {
		from { transform: translate(-50%,-50%) scale(0.6); opacity: 0; }
		to   { transform: translate(-50%,-50%) scale(1);   opacity: 1; }
	}

	/* HUD bar */
	.sesh-hud {
		border-radius: 18px;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		flex-shrink: 0;
	}
	.hud-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.hud-meta-row { align-items: flex-start; gap: 1rem; }

	/* Platform badge (colored circle) */
	.hud-plat-badge {
		width: 42px;
		height: 42px;
		border-radius: 13px;
		border: 1px solid;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.25rem;
		flex-shrink: 0;
	}
	.hud-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.22rem;
	}
	.hud-title {
		font-size: 1.05rem;
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: -0.01em;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.hud-sub {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		font-size: 0.78rem;
		color: var(--text-muted);
	}
	.hud-meta-chips {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.35rem;
		flex-shrink: 0;
	}
	.hud-submitter-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		background: rgba(255,255,255,0.05);
		white-space: nowrap;
	}
	.hud-submitter-init {
		width: 20px;
		height: 20px;
		border-radius: 6px;
		background: linear-gradient(135deg, var(--coral), var(--violet));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.55rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
	}

	/* Vote section */
	.hud-vote-section {
		background: rgba(0,0,0,0.25);
		border: 1px solid rgba(255,255,255,0.06);
		border-radius: 14px;
		padding: 0.8rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.hud-vote-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.hud-vote-big {
		display: flex;
		align-items: baseline;
		gap: 4px;
	}
	.hud-vote-num {
		font-size: 2.4rem;
		font-weight: 800;
		font-family: var(--font-mono);
		letter-spacing: -0.04em;
		line-height: 1;
		background: rgba(255,255,255,0.15);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		transition: all 0.2s;
	}
	.hud-vote-num.hud-vote-num-active {
		background: linear-gradient(180deg, var(--coral-bright), var(--coral));
		-webkit-background-clip: text;
		background-clip: text;
	}
	.hud-vote-denom {
		font-size: 0.85rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}
	.hud-who-voted-wrap {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.35rem;
	}
	.hud-who-voted {
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}
	.voted-avatar {
		position: relative;
		width: 28px;
		height: 28px;
		border-radius: 9px;
		background: linear-gradient(135deg, var(--violet), var(--coral));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.58rem;
		font-weight: 800;
		color: #fff;
		filter: grayscale(0.7) opacity(0.4);
		transition: filter 0.2s;
		font-family: var(--font-mono);
	}
	.voted-avatar.voted-done { filter: none; }
	.voted-check {
		position: absolute;
		bottom: -3px;
		right: -3px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--teal);
		border: 2px solid #1a0a2a;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 6px;
		font-style: normal;
	}
	.hud-rank-track { margin-bottom: 0; }
	.hud-rank-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		color: var(--text-muted);
		margin-top: 0.2rem;
	}
	.hud-rank-hint {
		color: var(--text-soft);
		font-size: 0.7rem;
	}

	/* Transport row */
	.hud-transport-row { gap: 0.45rem; flex-wrap: wrap; }
	.hud-transport-btn {
		font-size: 0.88rem;
		padding: 0.5rem 0.9rem;
		border-radius: 12px;
		white-space: nowrap;
	}
	.hud-icon-btn {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		font-size: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.hud-muted { color: var(--coral) !important; }
	.hud-fun-row {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	.hud-spacer { flex: 1; min-width: 0.5rem; }
	.hud-notepad-btn { font-size: 0.9rem; padding: 0.45rem 0.7rem; flex-shrink: 0; }
	.hud-notepad-active {
		background: rgba(94,227,210,0.1) !important;
		border-color: rgba(94,227,210,0.35) !important;
		color: var(--teal) !important;
	}
	.hud-next-ready { box-shadow: 0 0 0 3px rgba(94,227,210,0.35); }

	/* Sidebar column */
	.sesh-sidebar {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
		height: 100%;
		min-height: 0;
	}
	.sesh-sidebar .notepad-textarea {
		flex: 1;
		min-height: 120px;
	}

	/* SuperFav card */
	.superfav-card { padding: 0; overflow: hidden; }
	.superfav-btn {
		width: 100%;
		padding: 0.9rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: inherit;
		color: var(--text);
		text-align: left;
		transition: background 0.15s;
	}
	.superfav-btn:hover { background: rgba(255,255,255,0.04); }
	.superfav-btn.superfav-active { background: rgba(255,200,0,0.08); }
	.superfav-star { font-size: 1.5rem; flex-shrink: 0; }
	.superfav-label { font-size: 0.88rem; font-weight: 600; line-height: 1.3; }
	.superfav-hint { font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem; }
	.participant-voted { border: 2px solid var(--teal); }

	/* Responsive */
	@media (max-width: 1200px) {
		.sesh-with-sidebar { grid-template-columns: 200px 1fr 300px; }
	}
	@media (max-width: 1024px) {
		.sesh-grid { grid-template-columns: 200px 1fr; }
		.sesh-with-sidebar { grid-template-columns: 200px 1fr 280px; }
	}
	@media (max-width: 800px) {
		.sesh-grid { grid-template-columns: 1fr; }
		.sesh-with-sidebar { grid-template-columns: 1fr; }
		.sesh-left { flex-direction: row; border-radius: 12px; }
		.session-page.pres-mode { height: auto; overflow: visible; }
	}
	@media (max-width: 600px) {
		.sl-fun-row { display: none; }
	}
</style>
