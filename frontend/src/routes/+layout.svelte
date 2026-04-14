<script>
	import '../app.css';
	import { auth } from '$lib/auth.js';
	import { api } from '$lib/api.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let extInstalled = null; // null = detecting, true = installed, false = not installed

	onMount(() => {
		let responded = false;
		let pingInterval = null;
		let flagCheckInterval = null;
		let attempts = 0;
		const maxAttempts = 6;

		function cleanupListeners() {
			window.removeEventListener('message', handleMessage);
			document.removeEventListener('thereview-extension-installed', handleCustomEvent);
			window.removeEventListener('message', handlePageInjectMessage);
			if (pingInterval) clearInterval(pingInterval);
			if (flagCheckInterval) clearInterval(flagCheckInterval);
		}

		function markInstalled(reason) {
			console.debug('thereview: extension detected -', reason);
			responded = true;
			extInstalled = true;
			cleanupListeners();
		}

		function handleMessage(e) {
			if (!e?.data || e.data.type !== 'THEREVIEW_EXTENSION_PONG') return;
			markInstalled('pong message');
		}

		function handleCustomEvent(e) {
			console.debug('thereview: custom event received', e?.detail);
			markInstalled('custom event');
		}

		function handlePageInjectMessage(e) {
			if (!e?.data) return;
			if (e.data.type === 'THEREVIEW_EXTENSION_PONG') {
				markInstalled('page-inject pong');
			}
		}

		// Check immediately if flag is already set
		try {
			if (window.__THEREVIEW_EXTENSION_INSTALLED === true) {
				markInstalled('flag already set');
				return;
			}
		} catch (err) {
			// ignore
		}

		// Listen for all detection mechanisms
		window.addEventListener('message', handleMessage, false);
		window.addEventListener('message', handlePageInjectMessage, false);
		document.addEventListener('thereview-extension-installed', handleCustomEvent, false);

		// Send immediate ping
		window.postMessage({ type: 'THEREVIEW_EXTENSION_PING' }, '*');

		// Retry ping every 500ms for up to 3 seconds
		pingInterval = setInterval(() => {
			attempts++;
			console.debug('thereview: ping attempt', attempts);
			window.postMessage({ type: 'THEREVIEW_EXTENSION_PING' }, '*');
			if (responded || attempts >= maxAttempts) {
				clearInterval(pingInterval);
				if (!responded) {
					console.debug('thereview: no pong received, marking as not installed');
					extInstalled = false;
				}
			}
		}, 500);

		// Poll for the flag every 300ms
		flagCheckInterval = setInterval(() => {
			try {
				if (window.__THEREVIEW_EXTENSION_INSTALLED === true) {
					markInstalled('flag poll detected');
				}
			} catch (err) {
				// ignore
			}
		}, 300);

		return cleanupListeners;
	});
 
async function addMeme(event) {
	event.preventDefault();
	addError = '';
	if (!newUrl || !newUrl.trim()) {
		addError = 'Introduce una URL';
		return;
	}
	adding = true;
	try {
		await api('/api/memes', {
			method: 'POST',
			body: { url: newUrl.trim() },
			token: authVal.token,
		});
		newUrl = '';
		// Navigate to profile so user can see the embed immediately
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
		alert('Para probar la extensión en Brave:\n1) Abre brave://extensions\n2) Activa "Developer mode"\n3) Pulsa "Load unpacked" y selecciona la carpeta "extension" en el repositorio.');
	}

	function isActive(path) {
		return pageVal?.url?.pathname?.startsWith(path);
	}

	async function refreshInviteCount() {
		if (!authVal?.token) return;
		try {
			const sessions = await api('/api/sessions', { token: authVal.token });
			pendingInvites = sessions.filter(
				(s) => s.status === 'pending' && s.created_by !== authVal.user?.id
			).length;
		} catch {
			// ignore navbar badge errors
		}
	}

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
		return () => {
			if (inviteInterval) clearInterval(inviteInterval);
		};
	});

</script>

{#if authVal?.token}
	<nav class="navbar">
		<a href="/" class="brand">🍿 The Review</a>
			<div class="nav-add">
			<form onsubmit={addMeme} class="nav-add-form">
				<input bind:value={newUrl} placeholder="Pega la URL del meme" />
				<button class="btn-primary" type="submit" disabled={adding}>{adding ? 'Añadiendo...' : 'Añadir'}</button>
			</form>
			{#if addError}<div class="nav-add-error">{addError}</div>{/if}
		</div>
		<div class="nav-links">
			<a href="/profile" class:active={isActive('/profile')}>👤 Perfil</a>
			<a href="/sessions" class:active={isActive('/sessions')} class="sessions-link">
				🎬 Sesiones
				{#if pendingInvites > 0}
					<span class="invite-badge">{pendingInvites}</span>
				{/if}
			</a>
			<span class="nav-user">👤 {authVal.user?.display_name}</span>
			<button class="btn-ghost" onclick={logout}>Salir</button>
			{#if extInstalled === true}
				<span class="ext-status ext-connected" title="Extensión instalada">🔌 Extensión activa</span>
			{:else if extInstalled === null}
				<span class="ext-status ext-pending" title="Detectando extensión"><span class="dot"></span> Detectando extensión…</span>
			{/if}
		</div>
	</nav>
{/if}

{#if extInstalled === false}
	<div class="extension-banner extension-banner-urgent">
		<div class="banner-content">
			<strong>Por favor, instala la extensión</strong>
			<div class="banner-sub">Necesaria para reproducción sincronizada de TikTok/X/Twitter.</div>
		</div>
		<div class="banner-actions">
			<button class="btn-primary" onclick={showInstallInstructions}>Instalar / Ver instrucciones</button>
			<button class="btn-ghost" onclick={() => (extInstalled = null)}>Recordar más tarde</button>
		</div>
	</div>
{/if}

<svelte:head>
	<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</svelte:head>

<main>
	{@render children()}
</main>

<style>
	.navbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1.5rem;
		background: var(--bg-card);
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.brand {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--text);
	}
	.nav-links {
		display: flex;
		gap: 1rem;
		align-items: center;
	}
	.nav-links a {
		color: var(--text-muted);
		font-weight: 500;
		font-size: 0.9rem;
		padding: 0.3rem 0.6rem;
		border-radius: 8px;
		transition: color 0.2s, background 0.2s;
	}
	.nav-links a:hover,
	.nav-links a.active {
		color: var(--text);
		background: var(--bg-input);
	}
	.sessions-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.invite-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--accent);
		color: #fff;
	}
	.nav-user {
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.nav-add {
		flex: 1;
		max-width: 420px;
		margin: 0 1rem;
	}
	.nav-add-form {
		display: flex;
		gap: 0.4rem;
	}
	.nav-add-form input {
		flex: 1;
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
	}
	.nav-add-form button {
		white-space: nowrap;
		padding: 0.4rem 0.8rem;
		font-size: 0.85rem;
	}
	.nav-add-error {
		color: var(--accent);
		font-size: 0.75rem;
		margin-top: 0.25rem;
	}

	.ext-status {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		padding: 0.18rem 0.5rem;
		border-radius: 8px;
		margin-left: 0.5rem;
	}

	.ext-status .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ff9800;
		animation: pulse 1s infinite ease-in-out;
	}

	.ext-connected {
		background: rgba(40, 167, 69, 0.08);
		color: #28a745;
	}

	.ext-pending {
		background: rgba(255,165,0,0.06);
		color: #ff9800;
	}

	@keyframes pulse {
		0% { transform: scale(1); opacity: 1; }
		50% { transform: scale(1.4); opacity: 0.5; }
		100% { transform: scale(1); opacity: 1; }
	}

	.extension-banner {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: center;
		background: rgba(255, 165, 0, 0.06);
		color: var(--text);
		padding: 0.5rem 1rem;
		border-bottom: 1px solid rgba(255,165,0,0.08);
		font-size: 0.95rem;
	}

	.extension-banner-urgent {
		background: rgba(220,53,69,0.06);
		border-bottom: 1px solid rgba(220,53,69,0.08);
		color: var(--text);
	}

	.banner-content {
		display: flex;
		flex-direction: column;
	}

	.banner-sub {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.banner-actions {
		display: flex;
		gap: 0.5rem;
	}

	main {
		padding: 1rem 0;
	}

	@media (max-width: 640px) {
		.navbar {
			flex-wrap: wrap;
			gap: 0.5rem;
			padding: 0.5rem 1rem;
		}
		.nav-add {
			order: 3;
			max-width: 100%;
			margin: 0;
			flex-basis: 100%;
		}
		.nav-links {
			gap: 0.5rem;
			font-size: 0.85rem;
		}
	}
</style>
