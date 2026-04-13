<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { detectEmbed } from '$lib/embed.js';

	let authVal;
	auth.subscribe((v) => (authVal = v));

	let memes = $state([]);
	let newUrl = $state('');
	let error = $state('');
	let loading = $state(false);

	$effect(() => {
		if (!authVal?.token) {
			goto('/login');
			return;
		}
		loadMemes();
	});

	async function loadMemes() {
		try {
			memes = await api('/api/memes?pending=true', { token: authVal.token });
		} catch (e) {
			error = e.message;
		}
	}

	async function addMeme() {
		if (!newUrl.trim()) return;
		error = '';
		loading = true;
		try {
			await api('/api/memes', {
				method: 'POST',
				body: { url: newUrl.trim() },
				token: authVal.token
			});
			newUrl = '';
			await loadMemes();
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function deleteMeme(id) {
		try {
			await api(`/api/memes/${id}`, { method: 'DELETE', token: authVal.token });
			await loadMemes();
		} catch (e) {
			error = e.message;
		}
	}
</script>

<div class="container">
	<h2 class="page-title">📦 Mis Memes</h2>

	<form class="add-form" onsubmit={(e) => { e.preventDefault(); addMeme(); }}>
		<input bind:value={newUrl} placeholder="Pega la URL del meme (TikTok, Twitter, etc.)" />
		<button class="btn-primary" type="submit" disabled={loading}>
			{loading ? '...' : '+ Añadir'}
		</button>
	</form>

	{#if error}<p class="error">{error}</p>{/if}

	<div class="meme-list">
		{#each memes as meme (meme.id)}
			{@const embed = detectEmbed(meme.url)}
			<div class="card meme-card">
				<div class="meme-meta">
					<span class="meme-type">{embed.type}</span>
					<button class="btn-ghost" onclick={() => deleteMeme(meme.id)}>✕</button>
				</div>
				<a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-url">
					{meme.url}
				</a>
				{#if embed.type === 'image'}
					<img src={meme.url} alt="meme" class="meme-preview" />
				{/if}
				<span class="meme-date">{new Date(meme.created_at).toLocaleDateString()}</span>
			</div>
		{:else}
			<p class="empty">No tienes memes pendientes. ¡Añade algunos!</p>
		{/each}
	</div>
</div>

<style>
	.add-form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.add-form input {
		flex: 1;
	}
	.add-form button {
		white-space: nowrap;
	}
	.error {
		color: var(--accent);
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}
	.meme-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.meme-card {
		padding: 1rem;
	}
	.meme-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.meme-type {
		font-size: 0.75rem;
		text-transform: uppercase;
		color: var(--accent);
		font-weight: 600;
	}
	.meme-url {
		display: block;
		font-size: 0.85rem;
		word-break: break-all;
		margin-bottom: 0.5rem;
	}
	.meme-preview {
		max-width: 100%;
		border-radius: 8px;
		margin-bottom: 0.5rem;
	}
	.meme-date {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem 0;
	}
</style>
