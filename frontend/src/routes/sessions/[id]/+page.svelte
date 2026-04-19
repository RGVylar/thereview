<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { detectEmbed } from '$lib/embed.js';
	import monkeySoundUrl from '../../../monkey.ogg?url';

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

	// Download progress derived from mediaStatus (excludes _progress key)
	let dlTotal   = $derived(Object.keys(mediaStatus).filter(k => k !== '_progress').length);
	let dlReady   = $derived(Object.values(mediaStatus).filter(s => s === 'ready').length);
	let dlFailed  = $derived(Object.values(mediaStatus).filter(s => s === 'failed').length);
	let dlPending = $derived(Object.values(mediaStatus).filter(s => s === 'pending').length);
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

		const onPlay        = () => sendPlayback('play');
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

	function connectWs(sessionId, token) {
		if (ws) ws.close();
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${location.host}/api/sessions/${sessionId}/ws?token=${encodeURIComponent(token)}`;
		const socket = new WebSocket(url);

		socket.onopen = () => {
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
					playbackStates = {};
					autoplayReady = null;
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
					ranking = await api(`/api/sessions/${session.id}/votes/ranking`, { token: authVal.token });
					view = 'ranking';
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
				} else if (msg.type === 'join' || msg.type === 'leave') {
					connectedUsers = msg.count;
					syncMessage = `${msg.user} ${msg.type === 'join' ? 'se ha unido' : 'se ha ido'}`;
					setTimeout(() => { syncMessage = ''; }, 3000);
				}
			} catch {}
		};

		socket.onclose = () => {
			ws = null;
			window.postMessage({ type: 'THEREVIEW_LEAVE_SYNC' }, '*');
			if (extPlaybackHandler) {
				window.removeEventListener('message', extPlaybackHandler);
				extPlaybackHandler = null;
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
				const pending = Object.values(statuses).some((s) => s === 'pending');
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
				ranking = await api(`/api/sessions/${id}/votes/ranking`, { token: authVal.token });
				view = 'ranking';
			}
			if (session.status === 'pending' || session.status === 'active') {
				if (!ws || ws.readyState !== WebSocket.OPEN) {
					connectWs(session.id, authVal.token);
				}
			}
			if (session.status === 'active') {
				startTimer(session.started_at);
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

	let monkeyAudio = null;
	function playMonkeySound() {
		try {
			if (!monkeyAudio) monkeyAudio = new Audio(monkeySoundUrl);
			monkeyAudio.currentTime = 0;
			monkeyAudio.play().catch(() => {});
		} catch {
			/* ignore */
		}
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
			ranking = await api(`/api/sessions/${session.id}/votes/ranking`, { token: authVal.token });
			view = 'ranking';
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
		} catch (e) {
			error = e.message;
		}
	}

	function getMyVote(memeId) {
		return votes.find(
			(v) => v.meme_id === memeId && v.user_id === authVal.user?.id
		);
	}

	function currentMeme() {
		if (!session?.session_memes?.length) return null;
		return session.session_memes[currentIndex];
	}

	function prev() {
		if (currentIndex > 0) {
			currentIndex--;
			playbackStates = {};
			autoplayReady = null;
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'navigate', index: currentIndex }));
			}
		}
	}

	function next() {
		if (currentIndex < session.session_memes.length - 1) {
			currentIndex++;
			playbackStates = {};
			autoplayReady = null;
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

<div class="container">
	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if session}
		<div class="session-header">
			<h2 class="page-title">{session.name}</h2>
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

					<div class="card meme-display">
						<div class="meme-source">
							<span class="meme-type">{embed.type}</span>
							<span class="meme-author">by {session.participants.find(p => p.id === sm.meme.user_id)?.display_name || '?'}</span>
						</div>

						{#key sm.meme.id}
						{#if embed.type === 'youtube' && embed.embedUrl}
							<iframe
								src={embed.embedUrl}
								title="YouTube"
								allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
								allowfullscreen={true}
								class="embed-frame"
							></iframe>
						{:else if embed.type === 'tiktok' && mediaStatus[String(sm.meme.id)] === 'ready'}
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
								{#if mediaStatus[String(sm.meme.id)] === 'pending'}
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
						{:else if embed.type === 'twitter' && mediaStatus[String(sm.meme.id)] === 'ready'}
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
								{#if mediaStatus[String(sm.meme.id)] === 'pending'}
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
						<div class="voting">
							<div class="rank-slider-wrap">
								<span class="rank-edge rank-bad">💀<br><small>Peor</small></span>
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
										onchange={(e) => castVote(sm.meme.id, +e.target.value)}
									/>
									<!-- Other users' votes as dots below the track -->
									{#each votes.filter(v => v.meme_id === sm.meme.id && v.user_id !== authVal.user?.id) as ov}
										{@const participant = session.participants.find(p => p.id === ov.user_id)}
										<span
											class="other-vote-dot"
											title="{participant?.display_name}: {ov.value}/{totalMemes}"
											style="left: {(ov.value / totalMemes) * 100}%"
										></span>
									{/each}
								</div>
								<span class="rank-edge rank-good">🏆<br><small>Mejor</small></span>
							</div>
							{#if sliderVal === null}
								<p class="rank-hint">Desliza para colocar este meme en el ranking</p>
							{:else}
								<p class="rank-hint">
									Puesto <strong>{sliderVal}</strong> de {totalMemes}
									· {#if rankPct < 0.25}💀 fondo
									{:else if rankPct < 0.5}😐 medio-bajo
									{:else if rankPct < 0.75}😄 medio-alto
									{:else}🔥 top
									{/if}
								</p>
							{/if}
						</div>

						<!-- Reaction buttons during review -->
						<div class="fun-buttons-wrap fun-buttons-review">
							<div class="fun-buttons">
								{#each FUN_BUTTONS as emoji}
									<button class="fun-btn fun-btn-sm" onclick={() => sendFunTap(emoji)}>{emoji}</button>
								{/each}
							</div>
						</div>
					{/if}
					</div>

					<!-- Navigation -->
					<div class="nav-buttons">
						<button class="btn-secondary" onclick={prev} disabled={currentIndex === 0}>
							← Anterior
						</button>
						{#if currentIndex === session.session_memes.length - 1}
							<button class="btn-primary" onclick={async () => {
								ranking = await api(`/api/sessions/${session.id}/votes/ranking`, { token: authVal.token });
								view = 'ranking';
								if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'show_ranking' }));
							}}>
								📊 Ver ranking
							</button>
						{:else}
							<button class="btn-primary" onclick={next}>
								Siguiente →
							</button>
						{/if}
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
									{#if detectEmbed(ranking[1].url).type === 'image'}
										<img src={ranking[1].url} alt="2nd" class="podium-img" />
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
									{#if detectEmbed(ranking[0].url).type === 'image'}
										<img src={ranking[0].url} alt="1st" class="podium-img" />
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
									{#if detectEmbed(ranking[2].url).type === 'image'}
										<img src={ranking[2].url} alt="3rd" class="podium-img" />
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

					<!-- Full list -->
					<div class="ranking-list">
						{#each ranking as entry, i (entry.meme_id)}
							{@const embed = detectEmbed(entry.url)}
							{@const avg = entry.vote_count ? entry.total_score / entry.vote_count : 0}
							{@const pct = Math.round(avg / totalMemes * 100)}
							{@const barPct = Math.round(entry.total_score / maxScore * 100)}
							{@const myVoteHere = votes.find(v => v.meme_id === entry.meme_id && v.user_id === authVal.user?.id)}
							<div class="ranking-row" class:top3={i < 3}>
								<div class="ranking-pos">
									{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
								</div>
								<a href={entry.url} target="_blank" rel="noopener noreferrer" class="ranking-type-icon" title={entry.url}>
									{#if embed.type === 'image'}
										<img src={entry.url} alt="" class="ranking-thumb" />
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
