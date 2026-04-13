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

	// Pagination state
	let page = $state(1);
	let perPage = $state(10);
	let totalMemes = $state(0);

	// ── Dead-video detection ────────────────────────────────────────────────────
	/** Set of meme IDs confirmed as deleted/unavailable */
	let deadIds = $state(new Set());
	let checkingDead = $state(false);

	async function checkDeadVideos() {
		if (checkingDead) return;
		checkingDead = true;
		deadIds = new Set();

		const tiktokMemes = memes.filter((m) => m.embed?.type === 'tiktok');

		await Promise.all(
			tiktokMemes.map(async (meme) => {
				try {
					// Extract numeric video ID from any tiktok share URL
					const match = meme.url.match(/\/video\/(\d+)/);
					if (!match) return;
					const videoId = match[1];
					const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/video/${videoId}`)}`;
					const res = await fetch(oembedUrl);
					if (!res.ok) {
						deadIds = new Set([...deadIds, meme.id]);
					}
				} catch {
					// network failure — don't mark as dead
				}
			})
		);

		checkingDead = false;
	}

	async function deleteDeadVideos() {
		const ids = [...deadIds];
		for (const id of ids) {
			try {
				await api(`/api/memes/${id}`, { method: 'DELETE', token: authVal.token });
			} catch {
				// skip ones we can't delete (e.g. already reviewed)
			}
		}
		deadIds = new Set();
		await loadMemes();
	}

	// ── TikTok import state ───────────────────────────────────────────────────
	let showImport = $state(false);
	let importStep = $state('idle'); // idle | parsed | importing | done
	let importUrls = $state([]);     // extracted TikTok URLs
	let importDone = $state(0);      // successfully imported count
	let importFailed = $state(0);
	let importSkipped = $state(0);   // already existed
	let importError = $state('');
	let importSources = $state({ favorites: true, likes: false });

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
				const res = await api(`/api/memes?pending=false&page=${page}&per_page=${perPage}`, { token: authVal.token });
				let items = res;
				if (!Array.isArray(res)) {
					items = res.items || [];
					totalMemes = res.total || 0;
				} else {
					totalMemes = items.length;
				}

				const mapped = items.map((m) => ({ ...m, embed: detectEmbed(m.url) }));

				// If page became empty (e.g. after deletes), step back and reload
				if (mapped.length === 0 && page > 1) {
					page = Math.max(1, page - 1);
					loading = false;
					return loadMemes();
				}

				deadIds = new Set();
				memes = mapped;
				for (const m of memes) {
					if (m.embed.type === 'twitter') await loadTwitterEmbed(m.id, m.url);
				}
				// Auto-check for dead TikTok videos in background
				if (mapped.some((m) => m.embed?.type === 'tiktok')) checkDeadVideos();
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

	// ── TikTok import ────────────────────────────────────────────────────────

	/**
	 * Parse TikTok data export. Accepts:
	 *  - user_data.json  (full export JSON)
	 *  - Favorite Videos.txt  (plain list of URLs, one per line)
	 *  - A .zip file with any of the above inside
	 */
	async function handleImportFile(e) {
		importError = '';
		importUrls = [];
		importStep = 'idle';

		const file = e.target.files?.[0];
		if (!file) return;

		try {
			let urls = [];

			if (file.name.endsWith('.zip')) {
				urls = await parseZip(file);
			} else if (file.name.endsWith('.json')) {
				const text = await file.text();
				const parsed = JSON.parse(text);
				urls = extractUrlsFromJson(parsed);
				if (urls.length === 0) {
					// Show available sections to help diagnose unknown format
					const activityKeys = parsed?.Activity ? Object.keys(parsed.Activity).join(', ') : '';
					const topKeys = Object.keys(parsed).join(', ');
					importError = `No se encontraron vídeos en "Guardados / Favoritos". Secciones disponibles en Activity: [${activityKeys || topKeys}]. Prueba a subir el .zip completo.`;
					return;
				}
			} else if (file.name.endsWith('.txt')) {
				const text = await file.text();
				urls = extractUrlsFromText(text);
			} else {
				importError = 'Formato no soportado. Usa el archivo user_data.json o el .zip de TikTok.';
				return;
			}

			if (urls.length === 0) {
				importError = 'No se encontraron vídeos guardados en el archivo.';
				return;
			}

			importUrls = urls;
			importStep = 'parsed';
		} catch (err) {
			importError = 'Error al leer el archivo: ' + (err?.message || String(err));
		}

		// Reset input so same file can be picked again
		e.target.value = '';
	}

	/** Extract TikTok URLs from the user_data.json structure.
	 *  Respects importSources checkboxes (favorites / likes). */
	function extractUrlsFromJson(data) {
		const found = new Set();

		// Root container — try each known structural variant
		const root =
			data?.['Likes and Favorites'] ||                   // current format (top-level)
			data?.Activity?.['Likes and Favorites'] ||         // older format under Activity
			data?.Activity ||                                  // even older exports
			data;

		if (importSources.favorites) {
			const favLists = [
				root?.['Favorite Videos']?.FavoriteVideoList,
				root?.FavoriteVideoList,
				// French / Spanish
				root?.['Vidéos favorites']?.FavoriteVideoList,
				root?.['Videos favoritos']?.FavoriteVideoList,
			];
			for (const list of favLists) {
				if (!Array.isArray(list)) continue;
				for (const item of list) {
					const url = item?.Link || item?.link || item?.Url || item?.url || item?.VideoLink;
					if (url && isTikTokShareUrl(url)) found.add(url);
				}
			}
		}

		if (importSources.likes) {
			const likeLists = [
				root?.['Like List']?.ItemFavoriteList,
				root?.ItemFavoriteList,
			];
			for (const list of likeLists) {
				if (!Array.isArray(list)) continue;
				for (const item of list) {
					const url = item?.Link || item?.link || item?.Url || item?.url || item?.VideoLink;
					if (url && isTikTokShareUrl(url)) found.add(url);
				}
			}
		}

		return [...found];
	}

	/** Accept TikTok share URLs from data exports.
	 *  tiktokv.com/share/video/... is used in official exports, so we allow it. */
	function isTikTokShareUrl(url) {
		try {
			const parsed = new URL(url);
			const h = parsed.hostname.replace('www.', '');
			const isTikTokHost =
				h === 'tiktok.com' ||
				h === 'vm.tiktok.com' ||
				h === 'vt.tiktok.com' ||
				h === 'tiktokv.com';
			// tiktokv.com CDN serves raw media at /obj/ or /tos-* — skip those
			if (h === 'tiktokv.com' && !parsed.pathname.startsWith('/share/')) return false;
			return isTikTokHost;
		} catch {
			return false;
		}
	}

	/** Extract URLs from a plain-text file (one URL per line) */
	function extractUrlsFromText(text) {
		return text
			.split('\n')
			.map((l) => l.trim())
			.filter(isTikTokShareUrl);
	}

	function isTikTokUrl(url) {
		try {
			const h = new URL(url).hostname;
			return h.includes('tiktok.com') || h.includes('tiktokv.com');
		} catch {
			return false;
		}
	}

	/** Parse a .zip file looking for user_data.json or Favorite Videos.txt */
	async function parseZip(file) {
		// Dynamically load JSZip from CDN (no npm dep needed)
		if (!window.JSZip) {
			await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
		}
		const zip = await window.JSZip.loadAsync(file);

		// Try user_data.json first
		const jsonFile = zip.file(/user_data\.json/i)[0];
		if (jsonFile) {
			const text = await jsonFile.async('text');
			return extractUrlsFromJson(JSON.parse(text));
		}

		// Try Favorite Videos.txt
		const txtFile = zip.file(/favorite.*videos/i)[0] || zip.file(/Favoris/i)[0];
		if (txtFile) {
			const text = await txtFile.async('text');
			return extractUrlsFromText(text);
		}

		return [];
	}

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.onload = resolve;
			s.onerror = () => reject(new Error('No se pudo cargar ' + src));
			document.head.appendChild(s);
		});
	}

	async function runImport() {
		importStep = 'importing';
		importDone = 0;
		importFailed = 0;
		importSkipped = 0;

		for (const url of importUrls) {
			try {
				await api('/api/memes', {
					method: 'POST',
					body: { url },
					token: authVal.token,
				});
				importDone++;
			} catch (e) {
				if (e?.message?.includes('already exists') || e?.message === 'Meme already exists') {
					importSkipped++;
				} else {
					importFailed++;
				}
			}
		}

		importStep = 'done';
		await loadMemes();
	}

	function resetImport() {
		showImport = false;
		importStep = 'idle';
		importUrls = [];
		importDone = 0;
		importFailed = 0;
		importSkipped = 0;
		importError = '';			importSources = { favorites: true, likes: false };	}
</script>

<div class="container">
	<div class="profile-header">
		<h2 class="page-title">📦 Mis Memes</h2>
		<button class="btn-secondary import-btn" onclick={() => (showImport = !showImport)}>
			🎵 Importar TikToks
		</button>
	</div>

	<!-- TikTok import panel -->
	{#if showImport}
		<div class="card import-panel">
			<h3 class="import-title">📥 Importar guardados de TikTok</h3>

			{#if importStep === 'idle'}
				<ol class="import-steps">
					<li>Abre TikTok en el móvil o en <a href="https://www.tiktok.com/setting" target="_blank" rel="noopener noreferrer">tiktok.com/setting</a></li>
					<li>Ve a <strong>Privacidad → Descarga tus datos</strong></li>
					<li>Elige formato <strong>JSON</strong> y solicita el archivo</li>
					<li>Cuando TikTok te mande el aviso, descarga el ZIP</li>
					<li>Sube aquí el ZIP o el archivo <code>user_data.json</code> que hay dentro</li>
				</ol>

				<p class="import-source-label">¿Qué quieres importar?</p>
				<div class="import-sources">
					<label class="source-check">
						<input type="checkbox" bind:checked={importSources.favorites} />
						<span>⭐ Favoritos</span>
					</label>
					<label class="source-check">
						<input type="checkbox" bind:checked={importSources.likes} />
						<span>❤️ Me gusta</span>
					</label>
				</div>

				<label class="file-label">
					<input
						type="file"
						accept=".zip,.json,.txt"
						onchange={handleImportFile}
						class="file-input"
					/>
					<span class="file-btn btn-primary">📂 Seleccionar archivo</span>
				</label>

				{#if importError}
					<p class="import-error">{importError}</p>
				{/if}
			{/if}

			{#if importStep === 'parsed'}
				<p class="import-found">
					✅ Se encontraron <strong>{importUrls.length}</strong> vídeos guardados.
				</p>
				<div class="import-preview">
					{#each importUrls.slice(0, 5) as url}
						<span class="import-url">{url}</span>
					{/each}
					{#if importUrls.length > 5}
						<span class="import-more">… y {importUrls.length - 5} más</span>
					{/if}
				</div>
				<div class="import-actions">
					<button class="btn-secondary" onclick={resetImport}>Cancelar</button>
					<button class="btn-primary" onclick={runImport}>
						⬆️ Importar todos
					</button>
				</div>
			{/if}

			{#if importStep === 'importing'}
				<div class="import-progress">
					<p>Importando… {importDone + importFailed + importSkipped} / {importUrls.length}</p>
					<div class="progress-bar-wrap">
						<div
							class="progress-bar-fill"
							style="width: {((importDone + importFailed + importSkipped) / importUrls.length) * 100}%"
						></div>
					</div>
				</div>
			{/if}

			{#if importStep === 'done'}
				<div class="import-result">
					<p class="import-ok">✅ {importDone} importados correctamente</p>
					{#if importSkipped > 0}
						<p class="import-skip">⏭️ {importSkipped} ya existían (omitidos)</p>
					{/if}
					{#if importFailed > 0}
						<p class="import-warn">⚠️ {importFailed} fallaron</p>
					{/if}
					<button class="btn-primary" onclick={resetImport}>Cerrar</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if loading}
		<p class="loading-text">Cargando...</p>
	{:else}
		{#if error}
			<p class="error">{error}</p>
		{/if}

		{#if !loading}
			<div class="pagination">
				<button class="btn-ghost" disabled={page <= 1 || loading} onclick={() => { page = Math.max(1, page - 1); loadMemes(); }}>« Anterior</button>
				<span class="page-indicator">Página {page} de {Math.max(1, Math.ceil(totalMemes / perPage))}</span>
				<button class="btn-ghost" disabled={page >= Math.max(1, Math.ceil(totalMemes / perPage)) || loading} onclick={() => { page = Math.min(Math.max(1, Math.ceil(totalMemes / perPage)), page + 1); loadMemes(); }}>Siguiente »</button>
			</div>
		{/if}

		{#if checkingDead}
			<div class="dead-notice dead-checking">🔍 Comprobando vídeos eliminados...</div>
		{:else if deadIds.size > 0}
			<div class="dead-notice">
				<span>🗑️ {deadIds.size} vídeo{deadIds.size > 1 ? 's' : ''} eliminado{deadIds.size > 1 ? 's' : ''} de TikTok en esta página</span>
				<button class="btn-danger" onclick={deleteDeadVideos}>Borrar de la lista</button>
			</div>
		{/if}

		<div class="meme-list">
			{#each memes as meme (meme.id)}
				<div class="card meme-card">
					<div class="meme-header">
						<div class="meme-tags">
							<span class="meme-type">{meme.embed.type.toUpperCase()}</span>
						{#if deadIds.has(meme.id)}
							<span class="badge dead">🗑️ Eliminado</span>
						{:else if meme.reviewed_at}
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
	.badge.dead {
		background: rgba(231, 76, 60, 0.2);
		color: #e74c3c;
	}

	/* Dead-video notice bar */
	.dead-notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: rgba(231, 76, 60, 0.12);
		border: 1px solid rgba(231, 76, 60, 0.3);
		border-radius: 8px;
		padding: 0.6rem 1rem;
		font-size: 0.88rem;
		margin-bottom: 0.75rem;
	}
	.dead-checking {
		color: var(--text-muted);
		background: var(--bg-input);
		border-color: transparent;
		justify-content: flex-start;
	}
	.btn-danger {
		background: #e74c3c;
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.35rem 0.8rem;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-danger:hover {
		background: #c0392b;
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

	/* ── Profile header ──────────────────────────────────── */
	.profile-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.profile-header .page-title {
		margin-bottom: 0;
	}
	.import-btn {
		white-space: nowrap;
		font-size: 0.85rem;
		padding: 0.45rem 0.9rem;
	}

	/* ── Import panel ────────────────────────────────────── */
	.import-panel {
		margin-bottom: 1.5rem;
	}
	.import-title {
		font-size: 1.1rem;
		font-weight: 700;
		margin-bottom: 1rem;
	}
	.import-steps {
		color: var(--text-muted);
		font-size: 0.88rem;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-bottom: 1.25rem;
	}
	.import-steps a {
		color: var(--accent);
	}
	.import-source-label {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
	}
	.import-sources {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1.25rem;
	}
	.source-check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		font-size: 0.95rem;
	}
	.source-check input[type='checkbox'] {
		width: 1rem;
		height: 1rem;
		width: auto;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.import-steps code {
		background: var(--bg-input);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.82rem;
	}
	.file-label {
		display: inline-block;
		cursor: pointer;
	}
	.file-input {
		display: none;
	}
	.file-btn {
		display: inline-block;
		width: auto;
		cursor: pointer;
	}
	.import-error {
		color: var(--accent);
		font-size: 0.85rem;
		margin-top: 0.75rem;
	}
	.import-found {
		font-size: 1rem;
		margin-bottom: 0.75rem;
	}
	.import-preview {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: var(--bg-input);
		border-radius: 8px;
		padding: 0.75rem;
		margin-bottom: 1rem;
		font-size: 0.78rem;
	}
	.import-url {
		color: var(--text-muted);
		word-break: break-all;
	}
	.import-more {
		color: var(--accent);
		font-weight: 600;
	}
	.import-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.import-progress {
		text-align: center;
	}
	.progress-bar-wrap {
		height: 6px;
		background: var(--bg-input);
		border-radius: 3px;
		margin-top: 0.75rem;
		overflow: hidden;
	}
	.progress-bar-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s ease;
	}
	.import-result {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.import-ok {
		color: #27ae60;
		font-weight: 600;
	}
	.import-skip {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.import-warn {
		color: #f1c40f;
		font-size: 0.85rem;
	}

	/* Pagination */
	.pagination {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: center;
		margin: 1rem 0;
	}
	.page-indicator {
		color: var(--text-muted);
		font-weight: 600;
	}
</style>
