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

	// Filter + search state
	let filter = $state('all');
	let searchQuery = $state('');

	// Pagination state
	let page = $state(1);
	let perPage = $state(50);
	let totalMemes = $state(0);
	let pendingCount = $state(0);
	let reviewedCount = $derived(totalMemes - pendingCount);

	// Derived: memes for current month
	let thisMonthCount = $derived(() => {
		const now = new Date();
		return memes.filter((m) => {
			const d = new Date(m.created_at);
			return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
		}).length;
	});

	// Derived: filtered memes for display
	let filteredMemes = $derived(() => {
		let list = memes;
		if (filter === 'pending') list = list.filter((m) => !m.reviewed_at);
		else if (filter === 'reviewed') list = list.filter((m) => m.reviewed_at);
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(
				(m) =>
					(m.url || '').toLowerCase().includes(q) ||
					(m.embed?.type || '').toLowerCase().includes(q)
			);
		}
		return list;
	});

	// ── TikTok import state ──────────────────────────────────────────────────── ───────────────────────────────────────────────────
	let showImport = $state(false);
	let importStep = $state('idle'); // idle | parsed | importing | done
	let importUrls = $state([]);     // extracted TikTok URLs
	let importDone = $state(0);
	let importFailed = $state(0);
	let importSkipped = $state(0);   // already existed
	let importDead = $state(0);      // detected dead before import
	let importError = $state('');
	let importSources = $state({ favorites: true, likes: false });

	// Platform metadata for card thumbnails
	const PLATFORM_META = {
		tiktok:    { glyph: '🎵', accent: '#ff5470', label: 'TikTok' },
		twitter:   { glyph: '🐦', accent: '#1d9bf0', label: 'Twitter/X' },
		instagram: { glyph: '📸', accent: '#e1306c', label: 'Instagram' },
		youtube:   { glyph: '📺', accent: '#ff0000', label: 'YouTube' },
		image:     { glyph: '🖼️', accent: '#9b6bff', label: 'Imagen' },
		link:      { glyph: '🔗', accent: '#5ee3d2', label: 'Enlace' },
	};

	function getPlatformMeta(type) {
		return PLATFORM_META[type] || PLATFORM_META.link;
	}

	function thumbAspect(type) {
		return type === 'tiktok' || type === 'instagram' ? '4/5' : '16/9';
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
			const [res, pendingRes] = await Promise.all([
				api(`/api/memes?pending=false&page=${page}&per_page=${perPage}`, { token: authVal.token }),
				api(`/api/memes?pending=true&page=1&per_page=1`, { token: authVal.token }),
			]);
			let items = res;
			if (!Array.isArray(res)) {
				items = res.items || [];
				totalMemes = res.total || 0;
			} else {
				totalMemes = items.length;
			}
			pendingCount = Array.isArray(pendingRes) ? pendingRes.length : (pendingRes.total || 0);

			const mapped = items.map((m) => ({ ...m, embed: detectEmbed(m.url) }));

			// If page became empty (e.g. after deletes), step back and reload
			if (mapped.length === 0 && page > 1) {
				page = Math.max(1, page - 1);
				loading = false;
				return loadMemes();
			}

			memes = mapped;
		} catch (e) {
			error = e.message || String(e);
		} finally {
			loading = false;
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

	async function deleteAllMemes() {
		if (!confirm(`¿Borrar todos tus ${totalMemes} memes? Esta acción no se puede deshacer.`)) return;
		try {
			await api('/api/memes/all', { method: 'DELETE', token: authVal.token });
			page = 1;
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

		e.target.value = '';
	}

	function extractUrlsFromJson(data) {
		const found = new Set();
		const root =
			data?.['Likes and Favorites'] ||
			data?.Activity?.['Likes and Favorites'] ||
			data?.Activity ||
			data;

		if (importSources.favorites) {
			const favLists = [
				root?.['Favorite Videos']?.FavoriteVideoList,
				root?.FavoriteVideoList,
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

	function isTikTokShareUrl(url) {
		try {
			const parsed = new URL(url);
			const h = parsed.hostname.replace('www.', '');
			const isTikTokHost =
				h === 'tiktok.com' ||
				h === 'vm.tiktok.com' ||
				h === 'vt.tiktok.com' ||
				h === 'tiktokv.com';
			if (h === 'tiktokv.com' && !parsed.pathname.startsWith('/share/')) return false;
			return isTikTokHost;
		} catch {
			return false;
		}
	}

	function extractUrlsFromText(text) {
		return text
			.split('\n')
			.map((l) => l.trim())
			.filter(isTikTokShareUrl);
	}

	async function parseZip(file) {
		if (!window.JSZip) {
			await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
		}
		const zip = await window.JSZip.loadAsync(file);

		const jsonFile = zip.file(/user_data\.json/i)[0];
		if (jsonFile) {
			const text = await jsonFile.async('text');
			return extractUrlsFromJson(JSON.parse(text));
		}

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
		importDone = 0;
		importFailed = 0;
		importSkipped = 0;
		importDead = 0;

		importStep = 'checking';
		let urlsToImport = importUrls;
		const tiktokUrls = importUrls.filter((u) => {
			try {
				const h = new URL(u).hostname.replace('www.', '');
				return h === 'tiktok.com' || h === 'vm.tiktok.com' || h === 'vt.tiktok.com' || h === 'tiktokv.com';
			} catch { return false; }
		});
		if (tiktokUrls.length > 0) {
			try {
				const res = await api('/api/memes/check-dead', {
					method: 'POST',
					body: { urls: tiktokUrls },
					token: authVal.token,
				});
				const deadSet = new Set(res.dead || []);
				importDead = deadSet.size;
				urlsToImport = importUrls.filter((u) => !deadSet.has(u));
			} catch {
				// proceed with all URLs
			}
		}

		importStep = 'importing';
		for (const url of urlsToImport) {
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
		importDead = 0;
		importError = '';
		importSources = { favorites: true, likes: false };
	}
</script>

<div class="profile-page">

	<!-- ── Header ───────────────────────────────────────────────────── -->
	<header class="profile-header">
		<div class="profile-identity">
			<div class="avatar avatar-xl" aria-hidden="true">
				{(authVal?.user?.username || 'U').slice(0, 1).toUpperCase()}
			</div>
			<div>
				<div class="eyebrow" style="margin-bottom:0.25rem">Tu colección</div>
				<h1 class="h1" style="margin:0">{authVal?.user?.username || 'Mis Memes'}</h1>
			</div>
		</div>

		<div class="header-actions">
			{#if totalMemes > 0}
				<button class="btn-danger-sm" onclick={deleteAllMemes}>🗑️ Borrar todos</button>
			{/if}
			<button class="btn-glass" onclick={() => (showImport = !showImport)}>
				⬆️ Importar TikToks
			</button>
		</div>
	</header>

	<!-- ── Stats row ─────────────────────────────────────────────────── -->
	<div class="stats-grid">
		<div class="glass stat-card">
			<div class="eyebrow" style="font-size:0.62rem">Total</div>
			<div class="stat-num" style="color:#ffffff">{totalMemes}</div>
		</div>
		<div class="glass stat-card">
			<div class="eyebrow" style="font-size:0.62rem">Pendientes</div>
			<div class="stat-num" style="color:var(--gold)">{pendingCount}</div>
			<div class="stat-sub">{totalMemes > 0 ? Math.round(pendingCount / totalMemes * 100) : 0}% por revisar</div>
		</div>
		<div class="glass stat-card">
			<div class="eyebrow" style="font-size:0.62rem">Revisados</div>
			<div class="stat-num" style="color:var(--teal)">{reviewedCount}</div>
			<div class="stat-sub">✅ ya votados</div>
		</div>
		<div class="glass stat-card">
			<div class="eyebrow" style="font-size:0.62rem">Este mes</div>
			<div class="stat-num" style="color:var(--coral)">{thisMonthCount()}</div>
		</div>
	</div>

	<!-- ── Import modal ──────────────────────────────────────────────── -->
	{#if showImport}
		<div class="glass-strong import-modal fade-in">
			<div class="import-modal-header">
				<div>
					<h3 class="h3" style="margin:0">📥 Importar guardados de TikTok</h3>
					<p class="muted" style="font-size:0.85rem;margin-top:0.3rem">Sube tu user_data.json o el .zip de exportación</p>
				</div>
				<button class="btn-icon" onclick={resetImport} aria-label="Cerrar">✕</button>
			</div>

			{#if importStep === 'idle'}
				<div class="import-body">
					<!-- Steps column -->
					<ol class="import-steps">
						<li>Abre <span class="mono" style="color:var(--coral-bright)">tiktok.com/setting</span></li>
						<li>Ve a <strong>Privacidad → Descarga tus datos</strong></li>
						<li>Elige formato <strong>JSON</strong></li>
						<li>Cuando TikTok te mande el aviso, descarga el ZIP</li>
					</ol>

					<!-- Upload zone column -->
					<div class="upload-zone">
						<span class="upload-icon">⬆️</span>
						<span class="upload-label">Arrastra el archivo aquí</span>
						<span class="muted" style="font-size:0.78rem">.zip · .json · .txt</span>

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
							<span class="btn-primary" style="font-size:0.82rem;padding:0.5rem 1rem;cursor:pointer">📂 Seleccionar archivo</span>
						</label>

						{#if importError}
							<p class="import-error">{importError}</p>
						{/if}
					</div>
				</div>
			{/if}

			{#if importStep === 'parsed'}
				<div class="import-result-body">
					<p class="import-found">✅ Se encontraron <strong>{importUrls.length}</strong> vídeos guardados.</p>
					<div class="import-preview">
						{#each importUrls.slice(0, 5) as url}
							<span class="import-url">{url}</span>
						{/each}
						{#if importUrls.length > 5}
							<span class="import-more">… y {importUrls.length - 5} más</span>
						{/if}
					</div>
					<div class="import-actions">
						<button class="btn-glass" onclick={resetImport}>Cancelar</button>
						<button class="btn-primary" onclick={runImport}>⬆️ Importar todos</button>
					</div>
				</div>
			{/if}

			{#if importStep === 'checking'}
				<div class="import-progress">
					<p>🔍 Comprobando vídeos eliminados…</p>
					<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width: 30%"></div></div>
				</div>
			{/if}

			{#if importStep === 'importing'}
				<div class="import-progress">
					<p>Importando… {importDone + importFailed + importSkipped} / {importUrls.length - importDead}</p>
					<div class="progress-bar-wrap">
						<div
							class="progress-bar-fill"
							style="width: {((importDone + importFailed + importSkipped) / Math.max(1, importUrls.length - importDead)) * 100}%"
						></div>
					</div>
				</div>
			{/if}

			{#if importStep === 'done'}
				<div class="import-done">
					<p class="import-ok">✅ {importDone} importados correctamente</p>
					{#if importDead > 0}<p class="import-skip">🗑️ {importDead} eliminados en TikTok (omitidos)</p>{/if}
					{#if importSkipped > 0}<p class="import-skip">⏭️ {importSkipped} ya existían (omitidos)</p>{/if}
					{#if importFailed > 0}<p class="import-warn">⚠️ {importFailed} fallaron</p>{/if}
					<button class="btn-primary" onclick={resetImport}>Cerrar</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- ── Filter pills + search ──────────────────────────────────────── -->
	<div class="filter-row">
		<button
			class="filter-pill {filter === 'all' ? 'active' : ''}"
			onclick={() => (filter = 'all')}
		>
			Todos · {totalMemes}
		</button>
		<button
			class="filter-pill pending {filter === 'pending' ? 'active pending-active' : ''}"
			onclick={() => (filter = 'pending')}
		>
			Pendientes · {pendingCount}
		</button>
		<button
			class="filter-pill reviewed {filter === 'reviewed' ? 'active reviewed-active' : ''}"
			onclick={() => (filter = 'reviewed')}
		>
			Revisados · {reviewedCount}
		</button>
		<div style="flex:1"></div>
		<div class="search-box">
			<span class="search-icon">🔍</span>
			<input
				bind:value={searchQuery}
				placeholder="Buscar por plataforma o URL…"
				class="search-input"
			/>
		</div>
	</div>

	{#if error}
		<p class="load-error">⚠️ {error}</p>
	{/if}

	<!-- ── Pagination ─────────────────────────────────────────────────── -->
	{#if !loading && totalMemes > perPage}
		<div class="pagination">
			<button class="btn-ghost" disabled={page <= 1} onclick={() => { page = Math.max(1, page - 1); loadMemes(); }}>« Anterior</button>
			<span class="page-indicator mono">Página {page} de {Math.max(1, Math.ceil(totalMemes / perPage))}</span>
			<button class="btn-ghost" disabled={page >= Math.ceil(totalMemes / perPage)} onclick={() => { page++; loadMemes(); }}>Siguiente »</button>
		</div>
	{/if}

	<!-- ── Meme grid ──────────────────────────────────────────────────── -->
	{#if loading}
		<div class="loading-state">
			<div class="spinner"></div>
			<p class="muted">Cargando memes…</p>
		</div>
	{:else}
		<div class="meme-grid">
			{#each filteredMemes() as meme, idx (meme.id)}
				{@const meta = getPlatformMeta(meme.embed.type)}
				{@const isVertical = meme.embed.type === 'tiktok' || meme.embed.type === 'instagram'}
				<div class="meme-card glass fade-in" style="animation-delay:{idx * 0.04}s">
					<!-- Thumbnail -->
					<div
						class="meme-thumb"
						style="
							aspect-ratio: {thumbAspect(meme.embed.type)};
							background: linear-gradient(135deg, {meta.accent}33, {meta.accent}11), radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1), transparent 60%);
						"
					>
						<span class="thumb-glyph">{meta.glyph}</span>

						<!-- Platform badge (top-left) -->
						<span class="platform-badge">{meta.label}</span>

						<!-- Review status badge (top-right) -->
						<span
							class="status-badge"
							style="
								background: {meme.reviewed_at ? 'rgba(94,227,210,0.18)' : 'rgba(255,209,102,0.18)'};
								border-color: {meme.reviewed_at ? 'rgba(94,227,210,0.35)' : 'rgba(255,209,102,0.35)'};
								color: {meme.reviewed_at ? 'var(--teal)' : 'var(--gold)'};
							"
						>
							{meme.reviewed_at ? '✓ revisado' : '○ pendiente'}
						</span>
					</div>

					<!-- Info -->
					<div class="meme-info">
						<p class="meme-url">{meme.url}</p>
						<div class="meme-meta-row">
							<span class="muted mono" style="font-size:0.72rem">{new Date(meme.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
							<button class="delete-btn" onclick={() => deleteMeme(meme.id)} aria-label="Eliminar meme">✕</button>
						</div>
					</div>
				</div>
			{/each}

			{#if filteredMemes().length === 0 && !loading}
				<div class="glass empty-card">
					<p class="empty-icon">🎬</p>
					<p class="empty-text">
						{#if searchQuery || filter !== 'all'}
							No hay memes que coincidan con el filtro.
						{:else}
							No tienes memes añadidos aún.
						{/if}
					</p>
					{#if !searchQuery && filter === 'all'}
						<p class="muted" style="font-size:0.85rem">Usa el botón de arriba para importar TikToks.</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.profile-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* ── Header ── */
	.profile-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.profile-identity {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.avatar-xl {
		width: 60px;
		height: 60px;
		border-radius: 18px;
		font-size: 1.5rem;
		background: linear-gradient(135deg, var(--coral), var(--violet));
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		flex-shrink: 0;
		box-shadow: 0 8px 24px rgba(255,84,112,0.3);
	}
	.h1 { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em; }
	.header-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.btn-danger-sm {
		background: rgba(231, 76, 60, 0.12);
		color: #ff6b6b;
		border: 1px solid rgba(231, 76, 60, 0.25);
		border-radius: 8px;
		padding: 0.5rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-danger-sm:hover { background: rgba(231, 76, 60, 0.25); }

	/* ── Stats grid ── */
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}
	.stat-card {
		padding: 1.1rem 1.25rem;
	}
	.stat-num {
		font-family: var(--font-mono);
		font-size: 1.85rem;
		font-weight: 700;
		letter-spacing: -0.025em;
		margin-top: 0.3rem;
	}
	.stat-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		margin-top: 0.15rem;
	}

	/* ── Import modal ── */
	.import-modal {
		padding: 1.5rem;
	}
	.import-modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1.25rem;
		gap: 1rem;
	}
	.import-body {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.import-steps {
		color: var(--text-muted);
		font-size: 0.88rem;
		padding-left: 1.25rem;
		line-height: 1.7;
		margin: 0;
	}
	.import-steps li + li { margin-top: 0.3rem; }
	.upload-zone {
		border: 1.5px dashed rgba(255,255,255,0.2);
		border-radius: 14px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: rgba(255,255,255,0.02);
		text-align: center;
	}
	.upload-icon { font-size: 1.75rem; opacity: 0.7; }
	.upload-label { font-size: 0.88rem; font-weight: 500; }
	.import-sources {
		display: flex;
		gap: 1rem;
		margin-top: 0.25rem;
	}
	.source-check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		font-size: 0.88rem;
	}
	.source-check input { accent-color: var(--coral); cursor: pointer; }
	.file-label { display: inline-block; cursor: pointer; margin-top: 0.25rem; }
	.file-input { display: none; }
	.import-error { color: var(--coral-bright); font-size: 0.82rem; margin-top: 0.5rem; }
	.import-result-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.import-found { font-size: 1rem; }
	.import-preview {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		background: rgba(255,255,255,0.04);
		border-radius: 8px;
		padding: 0.75rem;
		font-size: 0.78rem;
	}
	.import-url { color: var(--text-muted); word-break: break-all; }
	.import-more { color: var(--coral-bright); font-weight: 600; }
	.import-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
	.import-progress { text-align: center; }
	.progress-bar-wrap {
		height: 6px;
		background: rgba(255,255,255,0.08);
		border-radius: 3px;
		margin-top: 0.75rem;
		overflow: hidden;
	}
	.progress-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--coral), var(--violet));
		transition: width 0.2s ease;
	}
	.import-done { display: flex; flex-direction: column; gap: 0.5rem; }
	.import-ok { color: var(--teal); font-weight: 600; }
	.import-skip { color: var(--text-muted); font-size: 0.85rem; }
	.import-warn { color: var(--gold); font-size: 0.85rem; }

	/* ── Filter row ── */
	.filter-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.filter-pill {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		background: transparent;
		border: 1px solid rgba(255,255,255,0.08);
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.filter-pill:hover { border-color: rgba(255,255,255,0.18); color: var(--text); }
	.filter-pill.active {
		background: rgba(255,255,255,0.1);
		border-color: rgba(255,255,255,0.18);
		color: #ffffff;
	}
	.filter-pill.pending-active {
		background: rgba(255,209,102,0.13);
		border-color: rgba(255,209,102,0.4);
		color: var(--gold);
	}
	.filter-pill.reviewed-active {
		background: rgba(94,227,210,0.13);
		border-color: rgba(94,227,210,0.4);
		color: var(--teal);
	}
	.search-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.85rem;
		background: rgba(255,255,255,0.04);
		border: 1px solid var(--glass-border);
		border-radius: 999px;
		width: 280px;
	}
	.search-icon { font-size: 0.85rem; opacity: 0.6; flex-shrink: 0; }
	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text);
		font-family: inherit;
		font-size: 0.85rem;
		min-width: 0;
	}
	.search-input::placeholder { color: var(--text-muted); }

	.load-error { color: var(--coral-bright); font-size: 0.85rem; }

	/* ── Pagination ── */
	.pagination {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: center;
	}
	.page-indicator { color: var(--text-muted); font-size: 0.85rem; }

	/* ── Loading state ── */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 4rem 0;
	}
	.spinner {
		width: 32px;
		height: 32px;
		border: 2px solid rgba(255,255,255,0.1);
		border-top-color: var(--coral);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	/* ── Meme grid ── */
	.meme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}
	.meme-card {
		padding: 0.85rem;
		transition: transform 0.18s, box-shadow 0.18s;
		cursor: default;
	}
	.meme-card:hover {
		transform: translateY(-3px);
		box-shadow: 0 16px 48px rgba(0,0,0,0.3);
	}

	/* Thumbnail */
	.meme-thumb {
		border-radius: 12px;
		border: 1px solid rgba(255,255,255,0.06);
		margin-bottom: 0.75rem;
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.thumb-glyph {
		font-size: 3rem;
		opacity: 0.45;
		filter: saturate(0.7);
		pointer-events: none;
	}
	.platform-badge {
		position: absolute;
		top: 8px;
		left: 8px;
		background: rgba(0,0,0,0.55);
		backdrop-filter: blur(6px);
		color: #fff;
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.18rem 0.5rem;
		border-radius: 6px;
		border: 1px solid rgba(255,255,255,0.1);
	}
	.status-badge {
		position: absolute;
		top: 8px;
		right: 8px;
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.18rem 0.5rem;
		border-radius: 6px;
		border: 1px solid;
	}

	/* Info */
	.meme-info {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.meme-url {
		font-size: 0.8rem;
		color: var(--text-soft);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin: 0;
	}
	.meme-meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.delete-btn {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		transition: color 0.15s, background 0.15s;
		line-height: 1;
	}
	.delete-btn:hover { color: var(--coral-bright); background: rgba(255,84,112,0.1); }

	/* ── Empty state ── */
	.empty-card {
		grid-column: 1 / -1;
		text-align: center;
		padding: 4rem 1.5rem;
	}
	.empty-icon { font-size: 3rem; margin-bottom: 0.5rem; }
	.empty-text { font-size: 1.05rem; margin-bottom: 0.25rem; }

	/* ── Responsive ── */
	@media (max-width: 900px) {
		.stats-grid { grid-template-columns: repeat(2, 1fr); }
	}
	@media (max-width: 600px) {
		.profile-page { padding: 1rem; gap: 1rem; }
		.stats-grid { grid-template-columns: repeat(2, 1fr); }
		.import-body { grid-template-columns: 1fr; }
		.filter-row { gap: 0.4rem; }
		.search-box { width: 100%; }
		.meme-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
		.profile-header { flex-direction: column; align-items: flex-start; }
	}
</style>
