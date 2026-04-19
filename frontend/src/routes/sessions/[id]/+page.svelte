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
	let dlTotal   = $derived(Object.keys(mediaStatus).filter(k => k !== '_progress').length);
	let dlReady   = $derived(Object.values(mediaStatus).filter(s => s?.status === 'ready').length);
	let dlFailed  = $derived(Object.values(mediaStatus).filter(s => s?.status === 'failed').length);
	let dlPending = $derived(Object.values(mediaStatus).filter(s => s?.status === 'pending').length);
	let dlSettled = $derived(dlTotal > 0 && dlPending === 0);
	let dlPct     = $derived(dlTotal > 0 ? Math.round(((dlReady + dlFailed) / dlTotal) * 100) : 0);

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
					if (msg.emoji === '🐒') playMonkeySound();
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

	function sendFunTap(emoji) {
		if (emoji === '🐒') playMonkeySound();
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'fun_tap', emoji }));
		}
		spawnEmoji(emoji, authVal?.user?.display_name ?? '');
	}

	function playMonkeySound() {
		try {
			const ctx = new AudioContext();
			// 5 rapid "ooh-aah" sweeps using sawtooth oscillators
			const sweeps = [
				{ start: 0,    freqA: 420, freqB: 260, dur: 0.14 },
				{ start: 0.15, freqA: 460, freqB: 280, dur: 0.14 },
				{ start: 0.30, freqA: 500, freqB: 300, dur: 0.14 },
				{ start: 0.45, freqA: 550, freqB: 320, dur: 0.16 },
				{ start: 0.62, freqA: 600, freqB: 350, dur: 0.18 },
			];
			sweeps.forEach(({ start, freqA, freqB, dur }) => {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = 'sawtooth';
				osc.frequency.setValueAtTime(freqA, ctx.currentTime + start);
				osc.frequency.linearRampToValueAtTime(freqB, ctx.currentTime + start + dur);
				gain.gain.setValueAtTime(0, ctx.currentTime + start);
				gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + start + 0.02);
				gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
				osc.start(ctx.currentTime + start);
				osc.stop(ctx.currentTime + start + dur + 0.01);
			});
		} catch { /* AudioContext not available */ }
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
	let noteVisible = $state(false);
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
	onmousemove={onMouseMove}
	role="presentation"
>
	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if session}
		<div class="session-header">
			<div class="session-header-top">
				<h2 class="page-title">{session.name}</h2>
				{#if session.status === 'active'}
					<button
						class="btn-notepad"
						class:active={noteVisible}
						onclick={() => (noteVisible = !noteVisible)}
						title="Notas compartidas"
					>📝</button>
				{/if}
			</div>
			<div class="header-meta">
				<div class="participants">
					{#each session.participants as p}
						{@const pbs = playbackStates[p.id]}
						<span class="chip">
							{#if pbs?.playing}<span title="Reproduciendo">🟢</span>{:else if pbs}<span title="Pausado">⏸</span>{/if}
							{p.display_name}
						</span>
					{/each}
				</div>
				{#if session.status === 'active'}
					<div class="sync-bar">
						<span class="timer">⏱️ {elapsed}</span>
						<span class="connected">🟢 {connectedUsers} online</span>
					</div>
				{/if}
					{#if autoplayReady === false}
						<p class="autoplay-hint">Activa este embed con un primer Play local para que la sincronización automática funcione desde el inicio.</p>
					{/if}
					{#if outOfSync}
						<p class="out-of-sync-hint">▶ Pulsa Play en el player para unirte al grupo</p>
					{/if}
					{#if syncMessage}
					<p class="sync-toast">{syncMessage}</p>
				{/if}
			</div>
		</div>

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
							<p class="dl-progress-sub"><span class="dl-failed">{dlFailed} no disponibles</span></p>
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
				<div class="presentation-wrap" class:notepad-open={noteVisible}>
				<div class="presentation">
					<div class="progress-bar">
						<span>{currentIndex + 1} / {session.session_memes.length}</span>
						<div class="bar">
							<div
								class="fill"
								style="width: {((currentIndex + 1) / session.session_memes.length) * 100}%"
							></div>
						</div>
					</div>

				<div class="meme-and-nav">
					<button
						class="nav-side nav-side-prev"
						onclick={prev}
						disabled={currentIndex === 0}
						title="Anterior"
					>‹</button>

					<div class="card meme-display">
						<div class="meme-source">
							<span class="meme-type">{embed.type}
								{#if sm.extra_count > 0}<span class="dup-badge">×{sm.extra_count + 1}</span>{/if}
							</span>
							<span class="meme-author">by {session.participants.find(p => p.id === sm.meme.user_id)?.display_name || '?'}</span>
						</div>
						{#if mediaStatus[String(sm.meme.id)]?.meta}
							{@const meta = mediaStatus[String(sm.meme.id)].meta}
							<div class="meme-meta-row">
								{#if meta.uploader}<span class="meta-chip meta-uploader">👤 {meta.uploader}</span>{/if}
								{#if meta.view_count}<span class="meta-chip">👁 {meta.view_count >= 1_000_000 ? (meta.view_count/1_000_000).toFixed(1)+'M' : meta.view_count >= 1_000 ? (meta.view_count/1_000).toFixed(0)+'K' : meta.view_count}</span>{/if}
								{#if meta.like_count}<span class="meta-chip">❤️ {meta.like_count >= 1_000_000 ? (meta.like_count/1_000_000).toFixed(1)+'M' : meta.like_count >= 1_000 ? (meta.like_count/1_000).toFixed(0)+'K' : meta.like_count}</span>{/if}
								{#if meta.comment_count}<span class="meta-chip">💬 {meta.comment_count >= 1_000 ? (meta.comment_count/1_000).toFixed(0)+'K' : meta.comment_count}</span>{/if}
								{#if meta.duration}<span class="meta-chip">⏱ {meta.duration >= 60 ? Math.floor(meta.duration/60)+'m' + (meta.duration%60 > 0 ? (meta.duration%60)+'s' : '') : meta.duration+'s'}</span>{/if}
							</div>
						{/if}

						{#key sm.meme.id}
						{#if embed.type === 'youtube' && embed.embedUrl}
							<iframe
								src={embed.embedUrl}
								title="YouTube"
								allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
								allowfullscreen={true}
								class="embed-frame"
							></iframe>
						{:else if embed.type === 'tiktok' && mediaStatus[String(sm.meme.id)]?.status === 'ready'}
							<div class="sync-media-wrap">
								<!-- Local download — plain <video> bypasses all autoplay/iframe restrictions -->
								<video
									src="/api/sessions/{session.id}/media/{sm.meme.id}?token={authVal.token}"
									controls
									class="embed-frame tiktok-frame local-video"
									use:localVideoSync
								></video>
								{#if localVideoMuted}
									<button class="unmute-overlay" onclick={() => { if (localVideoEl) { localVideoEl.muted = false; } }}>
										🔇 Haz clic para activar el sonido
									</button>
								{/if}
							</div>
						{:else if embed.type === 'tiktok' && embed.embedUrl}
							<div class="sync-media-wrap">
								{#if mediaStatus[String(sm.meme.id)]?.status === 'pending'}
									<div class="media-loading">⏬ Cargando vídeo local…</div>
								{/if}
								<iframe
									src={embed.embedUrl}
									title="TikTok"
									allow="autoplay; fullscreen; encrypted-media"
									allowfullscreen={true}
									class="embed-frame tiktok-frame"
								></iframe>
							</div>
						{:else if embed.type === 'instagram' && embed.embedUrl}
							<iframe
								src={embed.embedUrl}
								title="Instagram"
								allowfullscreen={true}
								class="embed-frame instagram-frame"
							></iframe>
						{:else if embed.type === 'twitter' && mediaStatus[String(sm.meme.id)]?.status === 'ready'}
							<div class="sync-media-wrap">
								<video
									src="/api/sessions/{session.id}/media/{sm.meme.id}?token={authVal.token}"
									controls
									class="embed-frame local-video"
									use:localVideoSync
								></video>
								{#if localVideoMuted}
									<button class="unmute-overlay" onclick={() => { if (localVideoEl) { localVideoEl.muted = false; } }}>
										🔇 Haz clic para activar el sonido
									</button>
								{/if}
							</div>
						{:else if embed.type === 'twitter'}
							<div class="sync-media-wrap">
								{#if mediaStatus[String(sm.meme.id)]?.status === 'pending'}
									<div class="media-loading">⏬ Cargando vídeo local…</div>
								{/if}
								{#if twitterEmbeds[sm.meme.id]}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="twitter-embed-wrap" use:tweetWidget>{@html twitterEmbeds[sm.meme.id]}</div>
								{:else if twitterEmbeds[sm.meme.id] === null}
									<div class="twitter-embed">
										<p class="tweet-hint">No se pudo cargar el tweet.</p>
										<a href={sm.meme.url} target="_blank" rel="noopener noreferrer" class="btn-secondary open-btn">
											🐦 Abrir en Twitter/X
										</a>
									</div>
								{:else}
									<div class="twitter-embed">
										<p class="tweet-hint">Cargando tweet…</p>
									</div>
								{/if}
							</div>
						{:else if embed.type === 'image'}
							<img src={sm.meme.url} alt="meme" class="meme-img" />
						{:else}
							<a href={sm.meme.url} target="_blank" rel="noopener noreferrer" class="meme-link">
								🔗 Abrir {embed.type}
							</a>
						{/if}
						{/key}

						{#if true}
						{@const totalMemes = session.session_memes.length}
						{@const sliderVal = myVote?.value ?? null}
						{@const rankPct = sliderVal !== null ? sliderVal / totalMemes : null}
						{@const usedOther = getUsedOtherScores(sm.meme.id)}
						<div class="voting">
							<div class="rank-slider-full">
								<div class="rank-labels">
									<span>💀 Peor</span>
									<span>🏆 Mejor</span>
								</div>
								<div class="rank-slider-track">
									{#if sliderVal !== null}
										<div class="rank-badge" style="left: {rankPct * 100}%">{sliderVal}</div>
									{/if}
									<input
										type="range"
										min="0"
										max={totalMemes}
										value={sliderVal ?? Math.round(totalMemes / 2)}
										class="rank-slider"
										onchange={(e) => {
											const resolved = resolveScore(+e.target.value, sm.meme.id, totalMemes);
											e.target.value = resolved;
											castVote(sm.meme.id, resolved);
										}}
									/>
									<!-- Other users' votes as dots -->
									{#each votes.filter(v => v.meme_id === sm.meme.id && v.user_id !== authVal.user?.id) as ov}
										{@const participant = session.participants.find(p => p.id === ov.user_id)}
										<span
											class="other-vote-dot"
											title="{participant?.display_name}: {ov.value}/{totalMemes}"
											style="left: {(ov.value / totalMemes) * 100}%"
										></span>
									{/each}
									<!-- Taken score ticks (used in other memes by this user) -->
									{#each [...usedOther] as taken}
										<span class="taken-tick" style="left: {(taken / totalMemes) * 100}%"></span>
									{/each}
								</div>
							</div>
							{#if sliderVal === null}
								<p class="rank-hint">Desliza para posicionar este meme</p>
							{:else}
								<p class="rank-hint">
									Posición <strong>{sliderVal}</strong> de {totalMemes}
									· {#if rankPct < 0.25}💀 fondo
									{:else if rankPct < 0.5}😐 medio-bajo
									{:else if rankPct < 0.75}😄 medio-alto
									{:else}🔥 top
									{/if}
								</p>
							{/if}
						</div>

						<!-- Superfav auto-trigger: if all voted max, show ⭐ flash -->
						{#if (() => {
							const mVotes = votes.filter(v => v.meme_id === sm.meme.id);
							const total = session.session_memes.length;
							return mVotes.length >= session.participants.length && mVotes.every(v => v.value === total);
						})()}
							<div class="superfav-flash">⭐ ¡SUPER FAVORITO!</div>
						{/if}

						<!-- Reaction buttons during review -->
						<div class="fun-buttons-wrap fun-buttons-review">
							<div class="fun-buttons">
								{#each FUN_BUTTONS as emoji}
									<button class="fun-btn fun-btn-sm" onclick={() => sendFunTap(emoji)}>{emoji}</button>
								{/each}
							</div>
						</div>
					{/if}
					</div><!-- /card meme-display -->

					<!-- Right nav: next or ver ranking -->
					<div class="nav-side-wrap">
						{#if currentIndex === session.session_memes.length - 1}
							<button class="nav-side nav-side-rank" onclick={showRanking} title="Ver ranking">📊</button>
						{:else}
							<button
								class="nav-side"
								class:nav-ready={nextVoters.includes(authVal.user?.id)}
								onclick={voteNext}
								title="Siguiente"
							>›</button>
							{#if nextVoters.length > 0 || session.participants.length > 1}
								<div class="next-vote-dots">
									{#each session.participants as p}
										<span
											class="next-vote-dot"
											class:voted={nextVoters.includes(p.id)}
											title={p.display_name}
										></span>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				</div><!-- /meme-and-nav -->

				</div><!-- /presentation -->

				<!-- Notepad sidebar -->
				{#if noteVisible}
					<div class="notepad-sidebar">
						<div class="notepad-header">
							<span>📝 Notas</span>
							<button class="notepad-close" onclick={() => (noteVisible = false)}>✕</button>
						</div>
						<textarea
							class="notepad-textarea"
							bind:value={noteText}
							oninput={(e) => sendNote(e.target.value)}
							placeholder="Notas compartidas — todo el mundo ve los cambios en tiempo real…"
						></textarea>
					</div>
				{/if}

				</div><!-- /presentation-wrap -->
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
			{@const maxScore = ranking[0]?.total_score || 1}
			{@const totalMemes = session.session_memes.length}
			{@const typeIcon = (t) => ({tiktok:'🎵',twitter:'🐦',youtube:'▶️',instagram:'📸',image:'🖼️',link:'🔗'})[t] ?? '🔗'}
			<div class="ranking-view">
				<div class="ranking-header">
					<h3>🏆 Resultados</h3>
					{#if session.status === 'active'}
						<div class="ranking-actions">
							<button class="btn-secondary" onclick={() => (view = 'presentation')}>
								← Volver a memes
							</button>
							<button class="btn-primary" onclick={finishSession}>
								✅ Finalizar sesión
							</button>
						</div>
					{/if}
				</div>

				{#if !ranking.length}
					<p class="empty">No hay votos todavía</p>
				{:else}
					<!-- Podium top 3 -->
					{#if ranking.length >= 3}
						<div class="podium">
							<!-- 2nd -->
							<div class="podium-entry podium-2">
								<a href={ranking[1].url} target="_blank" rel="noopener noreferrer" class="podium-media">
									{#if rankingPreviewSrc(ranking[1])}
										<img src={rankingPreviewSrc(ranking[1])} alt="" class="podium-img" loading="lazy" referrerpolicy="no-referrer" />
									{:else}
										<span class="podium-icon">{typeIcon(detectEmbed(ranking[1].url).type)}</span>
									{/if}
								</a>
								<div class="podium-medal">🥈</div>
								<div class="podium-score">{ranking[1].vote_count ? Math.round(ranking[1].total_score / ranking[1].vote_count / totalMemes * 100) : 0}%</div>
								<div class="podium-block podium-block-2"></div>
							</div>
							<!-- 1st -->
							<div class="podium-entry podium-1">
								<a href={ranking[0].url} target="_blank" rel="noopener noreferrer" class="podium-media">
									{#if rankingPreviewSrc(ranking[0])}
										<img src={rankingPreviewSrc(ranking[0])} alt="" class="podium-img" loading="lazy" referrerpolicy="no-referrer" />
									{:else}
										<span class="podium-icon">{typeIcon(detectEmbed(ranking[0].url).type)}</span>
									{/if}
								</a>
								<div class="podium-medal">🥇</div>
								<div class="podium-score">{ranking[0].vote_count ? Math.round(ranking[0].total_score / ranking[0].vote_count / totalMemes * 100) : 0}%</div>
								<div class="podium-block podium-block-1"></div>
							</div>
							<!-- 3rd -->
							<div class="podium-entry podium-3">
								<a href={ranking[2].url} target="_blank" rel="noopener noreferrer" class="podium-media">
									{#if rankingPreviewSrc(ranking[2])}
										<img src={rankingPreviewSrc(ranking[2])} alt="" class="podium-img" loading="lazy" referrerpolicy="no-referrer" />
									{:else}
										<span class="podium-icon">{typeIcon(detectEmbed(ranking[2].url).type)}</span>
									{/if}
								</a>
								<div class="podium-medal">🥉</div>
								<div class="podium-score">{ranking[2].vote_count ? Math.round(ranking[2].total_score / ranking[2].vote_count / totalMemes * 100) : 0}%</div>
								<div class="podium-block podium-block-3"></div>
							</div>
						</div>
					{/if}

					<!-- TOP BASED + CRINGE -->
					{@const topEntries = ranking.slice(0, 5)}
					{@const cringe = ranking.length > 5 ? ranking.slice(-5).filter(b => !topEntries.find(t => t.meme_id === b.meme_id)) : []}
					{@const midCount = Math.max(0, ranking.length - topEntries.length - cringe.length)}

					{#if topEntries.length > 0}
						<div class="ranking-section-label ranking-label-top">🏆 TOP BASED</div>
						<div class="ranking-list">
							{#each topEntries as entry, i (entry.meme_id)}
								{@const embed = detectEmbed(entry.url)}
								{@const avg = entry.vote_count ? entry.total_score / entry.vote_count : 0}
								{@const pct = Math.round(avg / totalMemes * 100)}
								{@const barPct = Math.round(entry.total_score / maxScore * 100)}
								{@const previewSrc = rankingPreviewSrc(entry)}
								<div class="ranking-row top3">
									<div class="ranking-pos">
										{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
									</div>
									<a href={entry.url} target="_blank" rel="noopener noreferrer" class="ranking-type-icon" title={entry.url}>
										{#if previewSrc}
											<img src={previewSrc} alt="" class="ranking-thumb" loading="lazy" referrerpolicy="no-referrer" />
										{:else}
											{typeIcon(embed.type)}
										{/if}
									</a>
									<div class="ranking-bar-wrap">
										<div class="ranking-bar-meta">
											<span class="ranking-submitter">por {entry.submitted_by}</span>
											<span class="ranking-pct">{pct}%</span>
										</div>
										<div class="ranking-bar-track">
											<div class="ranking-bar-fill" style="width:{barPct}%"></div>
										</div>
										<div class="ranking-user-votes">
											{#each session.participants as p}
												{@const uv = votes.find(v => v.meme_id === entry.meme_id && v.user_id === p.id)}
												<span class="uv-chip" class:uv-mine={p.id === authVal.user?.id} title="{p.display_name}: {uv ? uv.value + '/' + totalMemes : 'sin votar'}">
													{p.display_name.slice(0,1).toUpperCase()}
													{#if uv}<strong>{uv.value}</strong>{:else}—{/if}
												</span>
											{/each}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if cringe.length > 0}
						{#if midCount > 0}
							<div class="ranking-divider"><span>· · · {midCount} sin mostrar · · ·</span></div>
						{/if}
						<div class="ranking-section-label ranking-label-cringe">💩 CRINGE</div>
						<div class="ranking-list">
							{#each cringe as entry (entry.meme_id)}
								{@const realIndex = ranking.findIndex(r => r.meme_id === entry.meme_id)}
								{@const embed = detectEmbed(entry.url)}
								{@const avg = entry.vote_count ? entry.total_score / entry.vote_count : 0}
								{@const pct = Math.round(avg / totalMemes * 100)}
								{@const barPct = Math.round(entry.total_score / maxScore * 100)}
								{@const previewSrc = rankingPreviewSrc(entry)}
								<div class="ranking-row ranking-row-bottom">
									<div class="ranking-pos ranking-pos-bottom">
										{realIndex === ranking.length - 1 ? '💀' : `#${realIndex + 1}`}
									</div>
									<a href={entry.url} target="_blank" rel="noopener noreferrer" class="ranking-type-icon" title={entry.url}>
										{#if previewSrc}
											<img src={previewSrc} alt="" class="ranking-thumb" loading="lazy" referrerpolicy="no-referrer" />
										{:else}
											{typeIcon(embed.type)}
										{/if}
									</a>
									<div class="ranking-bar-wrap">
										<div class="ranking-bar-meta">
											<span class="ranking-submitter">por {entry.submitted_by}</span>
											<span class="ranking-pct">{pct}%</span>
										</div>
										<div class="ranking-bar-track">
											<div class="ranking-bar-fill ranking-bar-fill-bottom" style="width:{barPct}%"></div>
										</div>
										<div class="ranking-user-votes">
											{#each session.participants as p}
												{@const uv = votes.find(v => v.meme_id === entry.meme_id && v.user_id === p.id)}
												<span class="uv-chip" class:uv-mine={p.id === authVal.user?.id} title="{p.display_name}: {uv ? uv.value + '/' + totalMemes : 'sin votar'}">
													{p.display_name.slice(0,1).toUpperCase()}
													{#if uv}<strong>{uv.value}</strong>{:else}—{/if}
												</span>
											{/each}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	{:else}
		<p>Cargando...</p>
	{/if}
</div>

<style>
	.session-header {
		margin-bottom: 1rem;
	}
	.header-meta {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.participants {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.sync-bar {
		display: flex;
		gap: 1rem;
		align-items: center;
		font-size: 0.85rem;
	}
	.timer {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}
	.connected {
		color: var(--text-muted);
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
		background: var(--bg-input);
		padding: 0.3rem 0.7rem;
		border-radius: 20px;
		font-size: 0.8rem;
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

	/* Dots: other users' votes, positioned below track */
	.other-vote-dot {
		position: absolute;
		bottom: 2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #90cdf4;
		border: 2px solid #63b3ed;
		transform: translateX(-50%);
		pointer-events: none;
		z-index: 2;
		box-shadow: 0 1px 3px rgba(0,0,0,0.3);
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
		align-items: stretch;
	}
	.meme-and-nav > .card { flex: 1; min-width: 0; }
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
		width: 44px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.nav-side-wrap > .nav-side { flex: 1; width: 100%; }
	.next-vote-dots {
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: center;
		padding: 2px 0;
	}
	.next-vote-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: rgba(255,255,255,0.15);
		border: 2px solid rgba(255,255,255,0.1);
		transition: all 0.2s;
		flex-shrink: 0;
	}
	.next-vote-dot.voted { background: #68d391; border-color: #38a169; }

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
		max-width: 100%;
		padding: 0 1rem;
		box-sizing: border-box;
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

	.media-loading {
		font-size: 0.8rem;
		color: var(--text-muted);
		text-align: center;
		padding: 0.3rem 0;
		animation: fadeIn 0.3s;
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
</style>
