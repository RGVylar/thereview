<script>
	import '../app.css';
	import { auth } from '$lib/auth.js';
	import { api } from '$lib/api.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { children } = $props();
	let authVal;
	let pageVal;
	auth.subscribe((v) => (authVal = v));
	page.subscribe((v) => (pageVal = v));
 
	let newUrl = $state('');
	let addError = $state('');
	let adding = $state(false);
 
async function addMeme() {
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

	function isActive(path) {
		return pageVal?.url?.pathname?.startsWith(path);
	}
</script>

{#if authVal?.token}
	<nav class="navbar">
		<a href="/" class="brand">🍿 The Review</a>
			<div class="nav-add">
				<form onsubmit|preventDefault={addMeme} class="nav-add-form">
				<input bind:value={newUrl} placeholder="Pega la URL del meme" />
				<button class="btn-primary" type="submit" disabled={adding}>{adding ? 'Añadiendo...' : 'Añadir'}</button>
			</form>
			{#if addError}<div class="nav-add-error">{addError}</div>{/if}
		</div>
		<div class="nav-links">
			<a href="/profile" class:active={isActive('/profile')}>👤 Perfil</a>
			<a href="/sessions" class:active={isActive('/sessions')}>🎬 Sesiones</a>
			<span class="nav-user">👤 {authVal.user?.display_name}</span>
			<button class="btn-ghost" onclick={logout}>Salir</button>
		</div>
	</nav>
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
	.nav-user {
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	main {
		padding: 1rem 0;
	}
</style>
