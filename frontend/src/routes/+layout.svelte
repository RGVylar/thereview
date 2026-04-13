<script>
	import '../app.css';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { children } = $props();
	let authVal;
	let pageVal;
	auth.subscribe((v) => (authVal = v));
	page.subscribe((v) => (pageVal = v));

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
		<div class="nav-links">
			<a href="/memes" class:active={isActive('/memes')}>📦 Memes</a>
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
