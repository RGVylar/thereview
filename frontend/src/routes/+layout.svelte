<script>
	import '../app.css';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let { children } = $props();
	let authVal;
	auth.subscribe((v) => (authVal = v));

	function logout() {
		auth.logout();
		goto('/login');
	}
</script>

{#if authVal?.token}
	<nav class="navbar">
		<a href="/" class="brand">🍿 The Review</a>
		<div class="nav-links">
			<a href="/memes">Memes</a>
			<a href="/sessions">Sessions</a>
			<button class="btn-ghost" onclick={logout}>Logout</button>
		</div>
	</nav>
{/if}

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
	main {
		padding: 1rem 0;
	}
</style>
