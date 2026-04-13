<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { detectEmbed } from '$lib/embed.js';

	let authVal;
	auth.subscribe((v) => (authVal = v));

	let memes = $state([]);
	let error = $state('');
	let loading = $state(true);
	let twitterEmbeds = $state({});

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
		loadMemes();
	});

	async function loadMemes() {
		error = '';
		loading = true;
		try {
			const data = await api('/api/memes?pending=false', { token: authVal.token });
			memes = data.map((m) => ({ ...m, embed: detectEmbed(m.url) }));
			for (const m of memes) {
				if (m.embed.type === 'twitter') await loadTwitterEmbed(m.id, m.url);
			}
		} catch (e) {
			error = e.message || String(e);
		} finally {
			loading = false;
		}
	}

	async function loadTwitterEmbed(memeId, url) {
		if (twitterEmbeds[memeId] !== undefined) return;
		const embed = detectEmbed(url);
		if (embed.type !== 'twitter' || !embed.oEmbedUrl) {
			twitterEmbeds = { ...twitterEmbeds, [memeId]: null };
			return;
		}
		try {
			const res = await fetch(embed.oEmbedUrl);
			if (res.ok) {
				const data = await res.json();
				twitterEmbeds = { ...twitterEmbeds, [memeId]: data.html };
			} else {
				twitterEmbeds = { ...twitterEmbeds, [memeId]: null };
			}
		} catch {
			twitterEmbeds = { ...twitterEmbeds, [memeId]: null };
		}
	}

	async function deleteMeme(id) {
		try {
			await api(`/api/memes/${id}`, { method: 'DELETE', token: authVal.token });
			await loadMemes();
		} catch (e) {
			error = e.message || String(e);
		}
	}
</script>

<div class="container">
	<h2 class="page-title">📦 Mis Memes</h2>

	{#if loading}
		<p class="loading-text">Cargando...</p>
	{:else}
		{#if error}
			<p class="error">{error}</p>
		{/if}

		<div class="meme-list">
			{#each memes as meme (meme.id)}
				<div class="card meme-card">
					<div class="meme-header">
						<div class="meme-tags">
							<span class="meme-type">{meme.embed.type.toUpperCase()}</span>
							{#if meme.reviewed_at}
								<span class="badge reviewed">✅ Revisado</span>
							{:else}
								<span class="badge pending">⏳ Pendiente</span>
							{/if}
						</div>
						{#if !meme.reviewed_at}
							<button class="btn-ghost" onclick={() => deleteMeme(meme.id)}>✕</button>
						{/if}
					</div>

					{#if meme.embed.type === 'youtube' && meme.embed.embedUrl}
						<iframe src={meme.embed.embedUrl} class="embed-frame" title="YouTube" allowfullscreen></iframe>
					{:else if meme.embed.type === 'image'}
						<img src={meme.url} alt="meme" class="meme-preview" />
					{:else if meme.embed.type === 'tiktok' && meme.embed.embedUrl}
						<iframe src={meme.embed.embedUrl} class="embed-frame tiktok-frame" allowfullscreen></iframe>
					{:else if meme.embed.type === 'instagram' && meme.embed.embedUrl}
						<iframe src={meme.embed.embedUrl} class="embed-frame instagram-frame" allowfullscreen></iframe>
					{:else if meme.embed.type === 'twitter'}
						{#if twitterEmbeds[meme.id]}
							<div class="twitter-embed-wrap" use:tweetWidget>{@html twitterEmbeds[meme.id]}</div>
						{:else if twitterEmbeds[meme.id] === null}
							<a href={meme.url} target="_blank" rel="noopener noreferrer" class="btn-secondary open-btn">Abrir en Twitter/X</a>
						{:else}
							<p class="tweet-hint">Cargando tweet…</p>
						{/if}
					{:else}
						<a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-link">🔗 Abrir enlace</a>
					{/if}

					<span class="meme-date">{new Date(meme.created_at).toLocaleString()}</span>
				</div>
			{/each}

			{#if memes.length === 0}
				<div class="card empty-card">
					<p class="empty-icon">🎬</p>
					<p class="empty-text">No tienes memes añadidos aún.</p>
					<p class="empty-hint">Usa el formulario de arriba para pegar una URL.</p>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.loading-text {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem 0;
	}
	.meme-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.meme-card {
		padding: 1rem;
	}
	.meme-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.meme-tags {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.meme-type {
		text-transform: uppercase;
		color: var(--accent);
		font-weight: 600;
		font-size: 0.75rem;
	}
	.badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 10px;
		font-weight: 600;
	}
	.badge.reviewed {
		background: rgba(39, 174, 96, 0.2);
		color: #27ae60;
	}
	.badge.pending {
		background: rgba(241, 196, 15, 0.2);
		color: #f1c40f;
	}
	.embed-frame {
		width: 100%;
		aspect-ratio: 16/9;
		border: none;
		border-radius: 8px;
	}
	.meme-preview {
		max-width: 100%;
		border-radius: 8px;
	}
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
	.tweet-hint {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.meme-link {
		font-size: 1rem;
		display: block;
		padding: 1rem 0;
	}
	.meme-date {
		display: block;
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.open-btn {
		display: inline-block;
		padding: 0.5rem 1rem;
	}
	.error {
		color: var(--accent);
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}
	.empty-card {
		text-align: center;
		padding: 3rem 1.5rem;
	}
	.empty-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}
	.empty-text {
		font-size: 1.1rem;
		margin-bottom: 0.25rem;
	}
	.empty-hint {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
</style>
