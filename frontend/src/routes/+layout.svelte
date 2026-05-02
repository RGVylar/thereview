<script>
	import '../app.css';
	import { auth } from '$lib/auth.js';
	import { api } from '$lib/api.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { children } = $props();

	let authVal = $state(null);
	let pageVal = $state(null);
	auth.subscribe((v) => (authVal = v));
	page.subscribe((v) => (pageVal = v));

	// Dev auto-login — only active during `vite dev`, never in production builds
	if (import.meta.env.DEV) {
		$effect(() => {
			if (authVal?.token) return;
			(async () => {
				try {
					await fetch('/api/auth/register', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ username: 'dev', display_name: 'Dev', password: 'dev123' })
					});
				} catch { /* ignore */ }
				try {
					const loginRes = await fetch('/api/auth/login', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ username: 'dev', password: 'dev123' })
					});
					if (!loginRes.ok) return;
					const { access_token } = await loginRes.json();
					const meRes = await fetch('/api/auth/me', {
						headers: { Authorization: `Bearer ${access_token}` }
					});
					if (!meRes.ok) return;
					const user = await meRes.json();
					auth.login(access_token, user);
				} catch { /* ignore */ }
			})();
		});
	}

	let extInstalled = $state(null); // null=detecting, true=installed, false=not installed
	let newUrl = $state('');
	let adding = $state(false);
	let addError = $state('');
	let pendingInvites = $state(0);
	let inviteInterval = null;

	// --- Extension detection ---
	$effect(() => {
		let done = false;
		function detect(v) {
			if (done) return;
			done = true;
			extInstalled = v;
		}
		try {
			if (window.__THEREVIEW_EXTENSION_INSTALLED === true) { detect(true); return; }
		} catch (_) {}
		function onMsg(e) {
			if (e?.data?.type === 'THEREVIEW_EXTENSION_PONG') detect(true);
		}
		function onEvent() { detect(true); }
		window.addEventListener('message', onMsg);
		document.addEventListener('thereview-extension-installed', onEvent);
		window.postMessage({ type: 'THEREVIEW_EXTENSION_PING' }, '*');
		let ticks = 0;
		const interval = setInterval(() => {
			ticks++;
			try { if (window.__THEREVIEW_EXTENSION_INSTALLED === true) detect(true); } catch (_) {}
			window.postMessage({ type: 'THEREVIEW_EXTENSION_PING' }, '*');
			if (ticks >= 6) { clearInterval(interval); detect(false); }
		}, 500);
		return () => {
			window.removeEventListener('message', onMsg);
			document.removeEventListener('thereview-extension-installed', onEvent);
			clearInterval(interval);
		};
	});

	// --- Invite count polling ---
	$effect(() => {
		if (!authVal?.token) {
			pendingInvites = 0;
			if (inviteInterval) clearInterval(inviteInterval);
			inviteInterval = null;
			return;
		}
		refreshInviteCount();
		if (inviteInterval) clearInterval(inviteInterval);
		inviteInterval = setInterval(refreshInviteCount, 15000);
		return () => { if (inviteInterval) clearInterval(inviteInterval); };
	});

	async function refreshInviteCount() {
		if (!authVal?.token) return;
		try {
			const sessions = await api('/api/sessions', { token: authVal.token });
			pendingInvites = sessions.filter(
				(s) => s.status === 'pending' && s.created_by !== authVal.user?.id
			).length;
		} catch { /* ignore */ }
	}

	async function addMeme(event) {
		event.preventDefault();
		addError = '';
		if (!newUrl || !newUrl.trim()) { addError = 'Introduce una URL'; return; }
		adding = true;
		try {
			await api('/api/memes', {
				method: 'POST',
				body: { url: newUrl.trim() },
				token: authVal.token,
			});
			newUrl = '';
			goto('/profile');
		} catch (err) {
			addError = err?.message || String(err);
		} finally {
			adding = false;
		}
	}

	function logout() {
		auth.logout();
		goto('/login');
	}

	function showInstallInstructions() {
		const a = document.createElement('a');
		a.href = '/thereview-extension.zip';
		a.download = 'thereview-extension.zip';
		a.click();
		setTimeout(() => {
			alert(
				'Extensión descargada ✓\n\n' +
				'Para instalarla en Brave / Chrome:\n' +
				'1) Descomprime el zip descargado\n' +
				'2) Abre brave://extensions (o chrome://extensions)\n' +
				'3) Activa "Developer mode" (esquina superior derecha)\n' +
				'4) Pulsa "Load unpacked" y selecciona la carpeta descomprimida'
			);
		}, 500);
	}

	function isActive(path) {
		return pageVal?.url?.pathname?.startsWith(path);
	}
</script>

{#if authVal?.token}
<nav class="navbar glass-nav">
	<!-- Brand -->
	<a href="/sessions" class="brand">
		<span class="brand-icon">🍿</span>
		<span class="brand-text">The Review</span>
	</a>

	<!-- Add-meme pill -->
	<form onsubmit={addMeme} class="add-pill">
		<svg class="add-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
			<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
		</svg>
		<input
			bind:value={newUrl}
			placeholder="Pega la URL del meme…"
			class="add-input"
		/>
		<button class="btn-primary add-submit" type="submit" disabled={adding}>
			{adding ? '…' : 'Añadir'}
		</button>
	</form>
	{#if addError}<div class="add-error">{addError}</div>{/if}

	<!-- Nav links -->
	<div class="nav-links">
		<a href="/profile" class="nav-link" class:active={isActive('/profile')}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
			</svg>
			<span>{authVal.user?.display_name}</span>
		</a>

		<a href="/sessions" class="nav-link" class:active={isActive('/sessions')}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
				<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
			</svg>
			<span>Sesiones</span>
			{#if pendingInvites > 0}
				<span class="badge">{pendingInvites}</span>
			{/if}
		</a>

		<a href="/rewind" class="nav-link" class:active={isActive('/rewind')}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
				<polygon points="11 19 2 12 11 5 11 19" fill="currentColor" stroke="none"/><polygon points="22 19 13 12 22 5 22 19" fill="currentColor" stroke="none"/>
			</svg>
			<span>Rewind</span>
		</a>

		{#if extInstalled === true}
			<span class="ext-pill ext-ok" title="Extensión instalada">
				<span class="ext-dot"></span>Ext. activa
			</span>
		{:else if extInstalled === null}
			<span class="ext-pill ext-pending">
				<span class="ext-dot pulsing"></span>Detectando…
			</span>
		{/if}

		<button class="btn-ghost nav-logout" onclick={logout}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
				<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
			</svg>
			<span>Salir</span>
		</button>
	</div>
</nav>
{/if}

{#if extInstalled === false}
<div class="ext-banner">
	<div class="ext-banner-content">
		<strong>Instala la extensión</strong>
		<span class="ext-banner-sub">Necesaria para reproducción sincronizada de TikTok/X/Twitter.</span>
	</div>
	<div class="ext-banner-actions">
		<button class="btn-primary" onclick={showInstallInstructions}>Instalar</button>
		<button class="btn-ghost" onclick={() => (extInstalled = null)}>Más tarde</button>
	</div>
</div>
{/if}

<svelte:head>
	<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</svelte:head>

<main>
	{@render children()}
</main>

<footer>
	<a href="https://ko-fi.com/Z8Z81OW7UV" target="_blank" rel="noopener noreferrer" class="kofi-link">
		☕ Invítame una
	</a>
</footer>

<style>
	/* ─── Navbar ─── */
	.glass-nav {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1.25rem;
		background: rgba(10, 6, 18, 0.7);
		backdrop-filter: blur(32px) saturate(180%);
		-webkit-backdrop-filter: blur(32px) saturate(180%);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		position: sticky;
		top: 0;
		z-index: 100;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-shrink: 0;
		text-decoration: none;
	}
	.brand-icon { font-size: 1.2rem; }
	.brand-text {
		font-size: 1rem;
		font-weight: 800;
		color: var(--text);
		letter-spacing: -0.02em;
	}

	/* Add-meme pill */
	.add-pill {
		flex: 1;
		max-width: 400px;
		display: flex;
		align-items: center;
		gap: 0;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		padding: 0.3rem 0.3rem 0.3rem 0.85rem;
		transition: border-color 0.2s, background 0.2s;
		position: relative;
	}
	.add-pill:focus-within {
		border-color: rgba(255, 84, 112, 0.5);
		background: rgba(255, 255, 255, 0.07);
	}
	.add-icon {
		color: var(--text-muted);
		flex-shrink: 0;
		margin-right: 0.5rem;
	}
	.add-input {
		flex: 1;
		background: transparent;
		border: none;
		padding: 0;
		font-size: 0.85rem;
		color: var(--text);
		width: 0;
		min-width: 0;
	}
	.add-input::placeholder { color: var(--text-dim); }
	.add-input:focus { outline: none; }
	.add-submit {
		padding: 0.35rem 0.9rem;
		font-size: 0.8rem;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.add-error {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		font-size: 0.75rem;
		color: var(--coral-bright);
	}

	/* Nav links */
	.nav-links {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-left: auto;
		flex-shrink: 0;
	}
	.nav-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.7rem;
		border-radius: var(--r-pill);
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-soft);
		text-decoration: none;
		transition: color 0.15s, background 0.15s;
	}
	.nav-link:hover { color: var(--text); background: rgba(255,255,255,0.06); }
	.nav-link.active {
		color: var(--text);
		background: rgba(255,255,255,0.1);
		border: 1px solid rgba(255,255,255,0.12);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-size: 0.65rem;
		font-weight: 700;
		background: var(--coral);
		color: #fff;
	}

	.nav-logout {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.7rem;
		font-size: 0.85rem;
		border-radius: var(--r-pill);
	}

	/* Extension pill */
	.ext-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
	}
	.ext-ok  { background: rgba(94,227,210,0.1); color: var(--teal); border: 1px solid rgba(94,227,210,0.25); }
	.ext-pending { background: rgba(255,165,0,0.08); color: #ff9800; border: 1px solid rgba(255,165,0,0.15); }

	.ext-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}
	.ext-dot.pulsing {
		animation: extPulse 1.2s ease-in-out infinite;
	}
	@keyframes extPulse {
		0%,100% { opacity: 1; transform: scale(1); }
		50%      { opacity: 0.4; transform: scale(1.5); }
	}

	/* Extension banner */
	.ext-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.45rem 1rem;
		background: rgba(220, 53, 69, 0.07);
		border-bottom: 1px solid rgba(220, 53, 69, 0.12);
		font-size: 0.85rem;
		flex-wrap: wrap;
	}
	.ext-banner-content {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}
	.ext-banner-sub { color: var(--text-muted); font-size: 0.8rem; }
	.ext-banner-actions { display: flex; gap: 0.5rem; }

	@media (max-width: 480px) {
		.ext-banner-sub { display: none; }
	}

	main { min-height: calc(100dvh - 52px - 48px); }

	footer {
		text-align: center;
		padding: 1rem 0 1.5rem;
	}
	.kofi-link {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--text-dim);
		text-decoration: none;
		padding: 0.35rem 0.85rem;
		border-radius: 99px;
		border: 1px solid rgba(255,255,255,0.08);
		transition: color 0.2s, border-color 0.2s;
	}
	.kofi-link:hover { color: var(--text-muted); border-color: rgba(255,255,255,0.15); }

	@media (max-width: 768px) {
		.glass-nav { flex-wrap: wrap; padding: 0.5rem 1rem; gap: 0.5rem; }
		.add-pill { order: 3; max-width: 100%; flex-basis: 100%; }
		.nav-links { gap: 0.15rem; }
		.nav-link span, .nav-logout span { display: none; }
		.nav-link, .nav-logout { padding: 0.4rem; }
	}
</style>
