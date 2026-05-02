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
			pending:  { label: 'Pendiente', dot: '#ffd166' },
			active:   { label: 'Activa',    dot: '#5ee3d2' },
			finished: { label: 'Terminada', dot: '#9b6bff' },
		};
		return map[status] || map.pending;
	}

	function isNewInvite(s) {
		return s.created_by !== authVal.user?.id && s.status === 'pending';
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
	<div class="page-header">
		<div>
			<p class="eyebrow">Tu colección</p>
			<h1 class="page-title">Sesiones</h1>
		</div>
		{#if !showCreate}
			<button class="btn-primary" onclick={openCreate}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
				</svg>
				Nueva sesión
			</button>
		{/if}
	</div>

	<!-- Create form -->
	{#if showCreate}
		<div class="glass-strong create-card fade-in">
			<h2 class="create-title">Nueva sesión</h2>

			<div class="field">
				<label class="field-label" for="sname">Nombre</label>
				<input id="sname" bind:value={name} placeholder="Review Mayo 2025…" />
			</div>

			<div class="config-row">
				<div class="field">
					<label class="field-label" for="meme-limit">Límite de memes</label>
					<input id="meme-limit" type="number" min="1" bind:value={memeLimit} placeholder="∞ todos" />
				</div>
				<div class="field">
					<span class="field-label">Modo de mezcla</span>
					<div class="mode-toggle">
						<button type="button" class="mode-btn" class:active={mixMode === 'shuffle'} onclick={() => (mixMode = 'shuffle')}>
							🔀 Mezclar
						</button>
						<button type="button" class="mode-btn" class:active={mixMode === 'batched'} onclick={() => (mixMode = 'batched')}>
							📦 Por tandas
						</button>
					</div>
				</div>
			</div>

			<div class="field">
				<span class="field-label">Participantes</span>
				<div class="user-chips">
					{#each users as u (u.id)}
						<button
							type="button"
							class="user-chip"
							class:selected={selectedUserIds.includes(u.id)}
							onclick={() => toggleUser(u.id)}
						>
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

	<!-- Session list -->
	<div class="session-grid">
		{#each sessions as s (s.id)}
			{@const si = statusInfo(s.status)}
			{@const invite = isNewInvite(s)}
			<div class="session-card glass" class:invite>
				<a href="/sessions/{s.id}" class="session-link">
					<!-- Top row: name + status -->
					<div class="card-top">
						<div class="card-name-row">
							{#if invite}
								<span class="chip chip-coral" style="font-size:0.65rem;padding:0.2rem 0.55rem;">Nueva</span>
							{/if}
							<span class="card-name">{s.name}</span>
						</div>
						<span class="status-dot-label">
							<span class="status-dot" style="background:{si.dot};box-shadow:0 0 8px {si.dot}66"></span>
							{si.label}
						</span>
					</div>

					<!-- Progress bar for active sessions -->
					{#if s.status === 'active' && s.meme_count > 0}
						<div class="progress-wrap">
							<div class="progress-bar" style="width:{Math.round((s.current_position ?? 0) / s.meme_count * 100)}%"></div>
						</div>
					{/if}

					<!-- Meta -->
					<div class="card-meta">
						<span>{s.meme_count} memes</span>
						<span class="meta-sep">·</span>
						<span>{s.participants.map((p) => p.display_name).join(', ')}</span>
						<span class="meta-sep">·</span>
						<span>{new Date(s.created_at).toLocaleDateString('es-ES', { day:'numeric', month:'short' })}</span>
					</div>
				</a>

				{#if s.created_by === authVal.user?.id}
					<div class="card-footer">
						<button class="btn-delete" onclick={() => deleteSession(s.id)}>
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
							</svg>
							Borrar
						</button>
					</div>
				{/if}
			</div>
		{:else}
			<div class="empty-state glass">
				<span class="empty-icon">🎬</span>
				<p class="empty-title">Sin sesiones aún</p>
				<p class="empty-sub">Crea una sesión para empezar la review con los panas.</p>
				<button class="btn-primary" onclick={openCreate}>
					Crear primera sesión
				</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		margin-bottom: 1.5rem;
		padding-top: 0.5rem;
	}
	.page-title {
		font-size: 1.9rem;
		font-weight: 800;
		letter-spacing: -0.025em;
		line-height: 1;
		margin-top: 0.3rem;
	}

	/* Create form */
	.create-card {
		padding: 1.75rem;
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.create-title {
		font-size: 1.2rem;
		font-weight: 700;
		letter-spacing: -0.015em;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-family: var(--font-mono);
	}
	.config-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.mode-toggle { display: flex; gap: 0.4rem; }
	.mode-btn {
		flex: 1;
		padding: 0.5rem;
		border-radius: var(--r-md);
		font-size: 0.82rem;
		background: var(--glass-bg-input);
		border: 1px solid var(--glass-border);
		color: var(--text-soft);
	}
	.mode-btn.active {
		background: rgba(255, 84, 112, 0.15);
		border-color: rgba(255, 84, 112, 0.4);
		color: var(--coral-bright);
	}
	.user-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.user-chip {
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		font-size: 0.82rem;
		background: var(--glass-bg-input);
		border: 1px solid var(--glass-border);
		color: var(--text-soft);
	}
	.user-chip.selected {
		background: rgba(255, 84, 112, 0.15);
		border-color: rgba(255, 84, 112, 0.4);
		color: var(--coral-bright);
	}
	.form-error { color: var(--coral-bright); font-size: 0.85rem; }
	.form-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		padding-top: 0.25rem;
		border-top: 1px solid rgba(255,255,255,0.06);
	}

	/* Session grid */
	.session-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.session-card {
		overflow: hidden;
		border-radius: var(--r-lg);
		transition: transform 0.15s, box-shadow 0.15s;
	}
	.session-card:hover { transform: translateY(-1px); }
	.session-card.invite {
		border-color: rgba(255, 84, 112, 0.4) !important;
		box-shadow: inset 0 1px 0 var(--glass-highlight), 0 0 0 1px rgba(255,84,112,0.2), var(--shadow-md);
	}

	.session-link {
		display: block;
		padding: 1.1rem 1.25rem;
		text-decoration: none;
		color: var(--text);
	}

	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 0.6rem;
	}
	.card-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.card-name {
		font-weight: 700;
		font-size: 1rem;
		letter-spacing: -0.01em;
	}
	.session-link:hover .card-name { color: var(--coral-bright); }

	.status-dot-label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--text-muted);
		font-weight: 500;
		flex-shrink: 0;
	}
	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.progress-wrap {
		height: 3px;
		background: rgba(255,255,255,0.07);
		border-radius: 99px;
		overflow: hidden;
		margin-bottom: 0.6rem;
	}
	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, var(--coral-bright), var(--violet));
		border-radius: 99px;
		transition: width 0.4s ease;
	}

	.card-meta {
		font-size: 0.8rem;
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.meta-sep { opacity: 0.4; }

	.card-footer {
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		padding: 0.5rem 1.25rem;
		display: flex;
		justify-content: flex-end;
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
		transition: color 0.15s, background 0.15s;
	}
	.btn-delete:hover { color: var(--coral-bright); background: rgba(255,84,112,0.08); }

	/* Empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3rem 2rem;
		text-align: center;
	}
	.empty-icon { font-size: 2.5rem; margin-bottom: 0.25rem; }
	.empty-title { font-size: 1.1rem; font-weight: 700; }
	.empty-sub { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.5rem; }
</style>
