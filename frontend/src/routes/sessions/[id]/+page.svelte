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

	/** Svelte action: after the HTML is injected, tell Twitter widgets to render */
	function tweetWidget(node) {
		const tryLoad = () => {
			if (window.twttr?.widgets) {
				window.twttr.widgets.load(node);
			}
		};
		tryLoad();
		// Retry in case widgets.js hasn't finished loading yet
		const t = setTimeout(tryLoad, 800);
		return { destroy() { clearTimeout(t); } };
	}

	$effect(() => {
		if (!authVal?.token) {
			goto('/login');
			return;
		}
		loadSession();
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

	async function startSession() {
		try {
			session = await api(`/api/sessions/${session.id}/start`, {
				method: 'POST',
				token: authVal.token
			});
		} catch (e) {
			error = e.message;
		}
	}

	async function finishSession() {
		try {
			session = await api(`/api/sessions/${session.id}/finish`, {
				method: 'POST',
				token: authVal.token
			});
			ranking = await api(`/api/sessions/${session.id}/votes/ranking`, { token: authVal.token });
			view = 'ranking';
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
		if (currentIndex > 0) currentIndex--;
	}

	function next() {
		if (currentIndex < session.session_memes.length - 1) currentIndex++;
	}

	function getMemeVoteTotal(memeId) {
		return votes
			.filter((v) => v.meme_id === memeId)
			.reduce((sum, v) => sum + v.value, 0);
	}
</script>

<div class="container">
	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if session}
		<div class="session-header">
			<h2 class="page-title">{session.name}</h2>
			<div class="participants">
				{#each session.participants as p}
					<span class="chip">{p.display_name}</span>
				{/each}
			</div>
		</div>

		<!-- PENDING -->
		{#if session.status === 'pending'}
			<div class="card center-card">
				<p>{session.session_memes.length} memes listos para la review</p>
				<button class="btn-primary big-btn" onclick={startSession}>
					▶️ Iniciar sesión
				</button>
			</div>
		{/if}

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

						{#if embed.type === 'youtube' && embed.embedUrl}
							<iframe
								src={embed.embedUrl}
								title="YouTube"
								allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
								allowfullscreen
								class="embed-frame"
							></iframe>
						{:else if embed.type === 'tiktok' && embed.embedUrl}
							<iframe
								src={embed.embedUrl}
								title="TikTok"
								allow="autoplay"
								allowfullscreen
								class="embed-frame tiktok-frame"
							></iframe>
						{:else if embed.type === 'instagram' && embed.embedUrl}
							<iframe
								src={embed.embedUrl}
								title="Instagram"
								allowfullscreen
								class="embed-frame instagram-frame"
							></iframe>
						{:else if embed.type === 'twitter'}
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
						{:else if embed.type === 'image'}
							<img src={sm.meme.url} alt="meme" class="meme-img" />
						{:else}
							<a href={sm.meme.url} target="_blank" rel="noopener noreferrer" class="meme-link">
								🔗 Abrir {embed.type}
							</a>
						{/if}
					</div>

					<!-- Voting -->
					<div class="voting">
						<p class="vote-label">Tu voto:</p>
						<div class="vote-buttons">
							{#each [1, 2, 3, 4, 5] as val}
								<button
									class="vote-btn"
									class:active={myVote?.value === val}
									onclick={() => castVote(sm.meme.id, val)}
								>
									{val}
								</button>
							{/each}
						</div>
						<p class="vote-total">Total: {getMemeVoteTotal(sm.meme.id)}</p>
					</div>

					<!-- Navigation -->
					<div class="nav-buttons">
						<button class="btn-secondary" onclick={prev} disabled={currentIndex === 0}>
							← Anterior
						</button>
						{#if currentIndex === session.session_memes.length - 1}
							<button class="btn-primary" onclick={() => (view = 'ranking')}>
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
			<div class="ranking-view">
				<div class="ranking-header">
					<h3>📊 Ranking</h3>
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

				{#each ranking.length ? ranking : [] as entry, i (entry.meme_id)}
					{@const rankEmbed = detectEmbed(entry.url)}
					<div class="card ranking-card">
						<div class="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</div>
						{#if rankEmbed.type === 'image'}
							<img src={entry.url} alt="meme" class="rank-thumb" />
						{/if}
						<div class="rank-info">
							<a href={entry.url} target="_blank" rel="noopener noreferrer">
								{entry.url.length > 60 ? entry.url.slice(0, 60) + '...' : entry.url}
							</a>
							<span class="rank-meta">by {entry.submitted_by} · {entry.vote_count} votos</span>
						</div>
						<div class="rank-score">{entry.total_score} pts</div>
					</div>
				{:else}
					<p class="empty">No hay votos todavía</p>
				{/each}
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
	.participants {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
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
	.vote-label {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
	}
	.vote-buttons {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
	}
	.vote-btn {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--bg-input);
		color: var(--text);
		font-size: 1.2rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.vote-btn.active {
		background: var(--accent);
		color: #fff;
	}
	.vote-total {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	/* Nav */
	.nav-buttons {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}

	/* Ranking */
	.ranking-view {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.ranking-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.ranking-actions {
		display: flex;
		gap: 0.5rem;
	}
	.ranking-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
	}
	.rank {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--accent);
		min-width: 40px;
	}
	.rank-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.rank-info a {
		font-size: 0.85rem;
		word-break: break-all;
	}
	.rank-meta {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.rank-score {
		font-size: 1.8rem;
		font-weight: 700;
	}
	.rank-thumb {
		width: 56px;
		height: 56px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
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
</style>
