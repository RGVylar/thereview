<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';

	let authVal = $state(null);
	auth.subscribe((v) => { authVal = v; });

	let sessions = $state([]);
	let showCreate = $state(false);
	let name = $state('');
	let users = $state([]);
	let selectedUserIds = $state([]);
	let memeLimit = $state('');
	let mixMode = $state('shuffle');
	let error = $state('');
	let loading = $state(false);

	let activeSessions  = $derived(sessions.filter(s => s.status !== 'finished'));
	let finishedSessions = $derived(sessions.filter(s => s.status === 'finished'));

	$effect(() => {
		if (!authVal?.token) { goto('/login'); return; }
		loadSessions();
	});

	async function loadSessions() {
		try {
			sessions = await api('/api/sessions', { token: authVal.token });
		} catch (e) { error = e.message; }
	}

	async function openCreate() {
		showCreate = true;
		try {
			users = await api('/api/auth/users', { token: authVal.token });
			// Auto-select current user
			if (authVal.user && !selectedUserIds.includes(authVal.user.id)) {
				selectedUserIds = [authVal.user.id];
			}
		} catch (e) { error = e.message; }
	}

	function toggleUser(id) {
		if (selectedUserIds.includes(id)) {
			selectedUserIds = selectedUserIds.filter((u) => u !== id);
		} else {
			selectedUserIds = [...selectedUserIds, id];
		}
	}

	async function createSession() {
		if (!name.trim() || selectedUserIds.length === 0) return;
		error = '';
		loading = true;
		try {
			const session = await api('/api/sessions', {
				method: 'POST',
				body: {
					name: name.trim(),
					user_ids: selectedUserIds,
					meme_limit: memeLimit ? parseInt(memeLimit) : null,
					mix_mode: mixMode
				},
				token: authVal.token
			});
			goto(`/sessions/${session.id}`);
		} catch (e) { error = e.message; }
		finally { loading = false; }
	}

	function statusInfo(status) {
		const map = {
			pending:  { label: 'Pendiente', dot: '#ffd166', chip: 'chip-gold' },
			active:   { label: 'Activa',    dot: '#5ee3d2', chip: 'chip-teal' },
			finished: { label: 'Terminada', dot: '#9b6bff', chip: 'chip-violet' },
		};
		return map[status] || map.pending;
	}

	function isNewInvite(s) {
		return s.created_by !== authVal.user?.id && s.status === 'pending';
	}

	function initials(name) {
		return name.slice(0, 2).toUpperCase();
	}

	async function deleteSession(id) {
		if (!confirm('¿Seguro que quieres borrar esta sesión?')) return;
		try {
			await api(`/api/sessions/${id}`, { method: 'DELETE', token: authVal.token });
			sessions = sessions.filter((s) => s.id !== id);
		} catch (e) { error = e.message; }
	}
</script>

<div class="container-wide">

	<!-- Page header -->
	<header class="page-header">
		<div>
			<div class="eyebrow">Sesiones</div>
			<h1 class="page-title">Tus reviews</h1>
			{#if sessions.length > 0}
				<p class="page-sub">{activeSessions.length} activas · {finishedSessions.length} en tu historial</p>
			{/if}
		</div>
		{#if !showCreate}
			<button class="btn-primary" onclick={openCreate}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
				</svg>
				Nueva sesión
			</button>
		{/if}
	</header>

	<!-- Create form -->
	{#if showCreate}
		<div class="glass-strong create-card fade-in">
			<div class="create-header">
				<div>
					<h2 class="create-title">Crear nueva sesión</h2>
					<p class="create-sub">Mezcla los memes de los participantes y empieza la review</p>
				</div>
				<button class="btn-ghost btn-icon-sm" onclick={() => (showCreate = false)} aria-label="Cerrar">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</div>

			<div class="create-fields">
				<div class="field">
					<label class="field-label" for="sname">Nombre</label>
					<input id="sname" bind:value={name} placeholder="Review Mayo 2025…" />
				</div>
				<div class="field">
					<label class="field-label" for="meme-limit">Límite de memes</label>
					<input id="meme-limit" type="number" min="1" bind:value={memeLimit} placeholder="∞ (todos)" />
				</div>
				<div class="field">
					<span class="field-label">Modo de mezcla</span>
					<div class="seg-group">
						<button type="button" class="seg-btn" class:active={mixMode === 'shuffle'} onclick={() => (mixMode = 'shuffle')}>🔀 Mezclar</button>
						<button type="button" class="seg-btn" class:active={mixMode === 'batched'} onclick={() => (mixMode = 'batched')}>📦 Por tandas</button>
					</div>
				</div>
			</div>

			<div class="field">
				<span class="field-label">Participantes · {selectedUserIds.length} seleccionados</span>
				<div class="user-chips">
					{#each users as u (u.id)}
						{@const selected = selectedUserIds.includes(u.id)}
						<button
							type="button"
							class="user-chip"
							class:selected
							onclick={() => toggleUser(u.id)}
						>
							<span class="user-chip-avatar">{initials(u.display_name)}</span>
							{u.display_name}{u.id === authVal.user?.id ? ' (tú)' : ''}
						</button>
					{/each}
				</div>
			</div>

			{#if error}<p class="form-error">{error}</p>{/if}

			<div class="form-actions">
				<button class="btn-ghost" onclick={() => (showCreate = false)}>Cancelar</button>
				<button class="btn-primary" onclick={createSession} disabled={loading}>
					{loading ? 'Creando…' : 'Crear sesión'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Sessions -->
	{#if sessions.length === 0 && !showCreate}
		<div class="empty-state glass">
			<span class="empty-icon">🎬</span>
			<p class="empty-title">Sin sesiones aún</p>
			<p class="empty-sub">Crea una sesión para empezar la review con los panas.</p>
			<button class="btn-primary" onclick={openCreate}>Crear primera sesión</button>
		</div>
	{/if}

	{#if activeSessions.length > 0}
		<section class="session-section">
			<div class="eyebrow section-label">Activas · Pendientes</div>
			<div class="session-grid session-grid-active">
				{#each activeSessions as s (s.id)}
					{@const si = statusInfo(s.status)}
					{@const invite = isNewInvite(s)}
					<div class="session-card glass" class:invite class:is-active={s.status === 'active'}>
						<!-- Radial gradient overlay for active sessions -->
						{#if s.status === 'active'}
							<div class="card-glow"></div>
						{/if}

						<a href="/sessions/{s.id}" class="session-link">
							<div class="card-top">
								<div class="card-left">
									{#if invite}
										<span class="chip chip-coral invite-chip">🔔 Nueva invitación</span>
									{/if}
									<h3 class="card-name">{s.name}</h3>
									<div class="status-row">
										<span class="status-dot" style="background:{si.dot};box-shadow:0 0 8px {si.dot}88"></span>
										<span class="status-label">{si.label}</span>
									</div>
								</div>
								<div class="card-count">
									<div class="count-num">{s.meme_count}</div>
									<div class="eyebrow count-label">memes</div>
								</div>
							</div>

							{#if s.status === 'active' && s.meme_count > 0}
								<div class="progress-section">
									<div class="progress-meta">
										<span>Progreso</span>
										<span class="progress-val">{s.current_position ?? 0}/{s.meme_count}</span>
									</div>
									<div class="progress-track">
										<div class="progress-fill" style="width:{Math.round(((s.current_position ?? 0) / s.meme_count) * 100)}%"></div>
									</div>
								</div>
							{/if}

							<div class="card-footer-inner">
								<div class="avatar-stack">
									{#each s.participants.slice(0, 5) as p, i}
										<span class="avatar-bubble" style="margin-left:{i===0?0:-8}px;z-index:{10-i}" title={p.display_name}>
											{initials(p.display_name)}
										</span>
									{/each}
									{#if s.participants.length > 5}
										<span class="avatar-more">+{s.participants.length - 5}</span>
									{/if}
								</div>
								<span class="card-date">{new Date(s.created_at).toLocaleDateString('es-ES', { day:'2-digit', month:'short' })}</span>
							</div>
						</a>

						{#if s.created_by === authVal.user?.id}
							<div class="card-actions">
								<button class="btn-delete" onclick={() => deleteSession(s.id)}>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
									</svg>
									Borrar
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if finishedSessions.length > 0}
		<section class="session-section">
			<div class="eyebrow section-label">Historial</div>
			<div class="session-grid session-grid-finished">
				{#each finishedSessions as s (s.id)}
					{@const si = statusInfo(s.status)}
					<div class="session-card glass session-card-finished">
						<a href="/sessions/{s.id}" class="session-link">
							<div class="card-top">
								<div class="card-left">
									<h3 class="card-name">{s.name}</h3>
									<div class="status-row">
										<span class="status-dot" style="background:{si.dot};box-shadow:0 0 8px {si.dot}88"></span>
										<span class="status-label">{si.label}</span>
									</div>
								</div>
								<div class="card-count">
									<div class="count-num">{s.meme_count}</div>
									<div class="eyebrow count-label">memes</div>
								</div>
							</div>

							<div class="card-footer-inner">
								<div class="avatar-stack">
									{#each s.participants.slice(0, 5) as p, i}
										<span class="avatar-bubble" style="margin-left:{i===0?0:-8}px;z-index:{10-i}" title={p.display_name}>
											{initials(p.display_name)}
										</span>
									{/each}
								</div>
								<span class="card-date">{new Date(s.created_at).toLocaleDateString('es-ES', { day:'2-digit', month:'short' })}</span>
							</div>
						</a>

						{#if s.created_by === authVal.user?.id}
							<div class="card-actions">
								<button class="btn-delete" onclick={() => deleteSession(s.id)}>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
									</svg>
									Borrar
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	/* ── Header ── */
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		margin-bottom: 1.75rem;
		padding-top: 0.5rem;
		gap: 1rem;
	}
	.eyebrow { margin-bottom: 0.4rem; }
	.page-title {
		font-size: clamp(1.6rem, 4vw, 2.25rem);
		font-weight: 800;
		letter-spacing: -0.025em;
		line-height: 1.1;
	}
	.page-sub {
		margin-top: 0.4rem;
		font-size: 0.95rem;
		color: var(--text-muted);
	}

	/* ── Create modal ── */
	.create-card {
		padding: 1.75rem;
		margin-bottom: 1.75rem;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.create-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.create-title {
		font-size: 1.3rem;
		font-weight: 700;
		letter-spacing: -0.015em;
	}
	.create-sub {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-top: 0.2rem;
	}
	.btn-icon-sm {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 0;
		cursor: pointer;
		background: none;
		border: none;
		color: var(--text-muted);
		transition: background 0.15s, color 0.15s;
	}
	.btn-icon-sm:hover { background: rgba(255,255,255,0.08); color: var(--text); }

	.create-fields {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 1rem;
	}
	@media (max-width: 640px) {
		.create-fields { grid-template-columns: 1fr; }
	}

	.field { display: flex; flex-direction: column; gap: 0.4rem; }
	.field-label {
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-family: var(--font-mono);
	}

	/* Segmented control */
	.seg-group {
		display: flex;
		gap: 4px;
		padding: 4px;
		background: rgba(255,255,255,0.04);
		border-radius: 14px;
		border: 1px solid var(--glass-border);
	}
	.seg-btn {
		flex: 1;
		background: transparent;
		border: none;
		color: var(--text-soft);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		padding: 0.5rem 0.75rem;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.15s;
	}
	.seg-btn.active {
		background: rgba(255,255,255,0.1);
		color: var(--text);
		box-shadow: inset 0 1px 0 rgba(255,255,255,0.15);
	}

	/* User chips */
	.user-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.user-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.35rem 0.75rem 0.35rem 0.35rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 500;
		background: rgba(255,255,255,0.04);
		border: 1.5px solid rgba(255,255,255,0.1);
		color: var(--text-soft);
		cursor: pointer;
		font-family: inherit;
		transition: all 0.15s;
	}
	.user-chip.selected {
		background: rgba(255,84,112,0.15);
		border-color: rgba(255,84,112,0.5);
		color: #fff;
	}
	.user-chip-avatar {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--coral), var(--violet));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.58rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
	}

	.form-error { color: var(--coral-bright); font-size: 0.85rem; }
	.form-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(255,255,255,0.06);
	}

	/* ── Sections ── */
	.session-section { margin-bottom: 2.25rem; }
	.section-label { margin-bottom: 0.85rem; }

	.session-grid {
		display: grid;
		gap: 1rem;
	}
	.session-grid-active {
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
	}
	.session-grid-finished {
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	}
	@media (max-width: 600px) {
		.session-grid-active,
		.session-grid-finished { grid-template-columns: 1fr; }
	}

	/* ── Session card ── */
	.session-card {
		position: relative;
		overflow: hidden;
		border-radius: var(--r-lg);
		transition: transform 0.18s, box-shadow 0.18s;
	}
	.session-card:hover { transform: translateY(-3px); }
	.session-card.invite {
		border-color: rgba(255,84,112,0.5) !important;
	}
	.session-card-finished { opacity: 0.85; }
	.session-card-finished:hover { opacity: 1; }

	/* Teal gradient for active sessions */
	.card-glow {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(circle at 100% 0%, rgba(94,227,210,0.18), transparent 60%);
		z-index: 0;
	}

	.session-link {
		display: block;
		padding: 1.25rem;
		text-decoration: none;
		color: var(--text);
		position: relative;
		z-index: 1;
	}

	/* Card top */
	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.card-left { flex: 1; min-width: 0; }
	.invite-chip { display: inline-flex; margin-bottom: 0.5rem; font-size: 0.72rem; }

	.card-name {
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.25;
	}
	.session-link:hover .card-name { color: var(--coral-bright); }

	.status-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.status-label {
		font-size: 0.78rem;
		color: var(--text-muted);
		font-weight: 500;
	}

	/* Meme count */
	.card-count { text-align: right; flex-shrink: 0; }
	.count-num {
		font-size: 1.8rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		font-family: var(--font-mono);
		line-height: 1;
	}
	.count-label { font-size: 0.58rem; margin-top: 0.15rem; }

	/* Progress */
	.progress-section { margin-bottom: 0.85rem; }
	.progress-meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.78rem;
		color: var(--text-muted);
		margin-bottom: 0.4rem;
	}
	.progress-val { font-family: var(--font-mono); color: var(--text-soft); }
	.progress-track {
		height: 6px;
		background: rgba(255,255,255,0.08);
		border-radius: 999px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #5ee3d2, #9b6bff);
		box-shadow: 0 0 12px rgba(94,227,210,0.5);
		border-radius: 999px;
		transition: width 0.4s ease;
	}

	/* Footer */
	.card-footer-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.avatar-stack { display: inline-flex; align-items: center; }
	.avatar-bubble {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--violet), var(--coral));
		border: 2px solid rgba(10,6,18,0.6);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.58rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
	}
	.avatar-more {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: rgba(255,255,255,0.1);
		border: 2px solid rgba(10,6,18,0.6);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.58rem;
		color: var(--text-muted);
		margin-left: -8px;
	}
	.card-date {
		font-size: 0.75rem;
		color: var(--text-dim);
		font-family: var(--font-mono);
	}

	/* Card actions (delete) */
	.card-actions {
		border-top: 1px solid rgba(255,255,255,0.06);
		padding: 0.5rem 1.25rem;
		display: flex;
		justify-content: flex-end;
		position: relative;
		z-index: 1;
	}
	.btn-delete {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: none;
		font-size: 0.78rem;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: 8px;
		font-family: inherit;
		transition: color 0.15s, background 0.15s;
	}
	.btn-delete:hover { color: var(--coral-bright); background: rgba(255,84,112,0.08); }

	/* ── Empty state ── */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3.5rem 2rem;
		text-align: center;
		margin-bottom: 1.5rem;
	}
	.empty-icon { font-size: 2.5rem; margin-bottom: 0.25rem; }
	.empty-title { font-size: 1.1rem; font-weight: 700; }
	.empty-sub { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
</style>
