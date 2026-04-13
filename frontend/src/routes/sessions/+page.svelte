<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';

	let authVal;
	auth.subscribe((v) => (authVal = v));

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
		if (!authVal?.token) {
			goto('/login');
			return;
		}
		loadSessions();
	});

	async function loadSessions() {
		try {
			sessions = await api('/api/sessions', { token: authVal.token });
		} catch (e) {
			error = e.message;
		}
	}

	async function openCreate() {
		showCreate = true;
		try {
			users = await api('/api/auth/users', { token: authVal.token });
		} catch (e) {
			error = e.message;
		}
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
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	function statusLabel(status) {
		const map = { pending: '⏳ Pendiente', active: '▶️ Activa', finished: '✅ Terminada' };
		return map[status] || status;
	}

	function isNewInvite(s) {
		return s.created_by !== authVal.user?.id && s.status === 'pending';
	}

	async function deleteSession(id) {
		if (!confirm('¿Seguro que quieres borrar esta sesión?')) return;
		try {
			await api(`/api/sessions/${id}`, { method: 'DELETE', token: authVal.token });
			sessions = sessions.filter((s) => s.id !== id);
		} catch (e) {
			error = e.message;
		}
	}
</script>

<div class="container">
	<div class="header">
		<h2 class="page-title">🎬 Sesiones</h2>
		{#if !showCreate}
			<button class="btn-primary" onclick={openCreate}>+ Nueva sesión</button>
		{/if}
	</div>

	{#if showCreate}
		<div class="card create-form">
			<h3>Crear sesión</h3>
			<input bind:value={name} placeholder="Nombre de la sesión (ej: Review Abril)" />

			<div class="config-row">
				<div class="config-field">
					<label class="label" for="meme-limit">Límite de memes (vacío = todos)</label>
					<input id="meme-limit" type="number" min="1" bind:value={memeLimit} placeholder="∞" />
				</div>
				<div class="config-field">
					<label class="label">Modo de mezcla</label>
					<div class="mode-toggle">
						<button class="mode-btn" class:selected={mixMode === 'shuffle'} onclick={() => (mixMode = 'shuffle')}>🔀 Mezclar</button>
						<button class="mode-btn" class:selected={mixMode === 'batched'} onclick={() => (mixMode = 'batched')}>📦 Por tandas</button>
					</div>
				</div>
			</div>

			<p class="label">Participantes:</p>
			<div class="user-list">
				{#each users as u (u.id)}
					<button
						class="user-chip"
						class:selected={selectedUserIds.includes(u.id)}
						onclick={() => toggleUser(u.id)}
					>
						{u.display_name}
						{#if u.id === authVal.user?.id}(tú){/if}
					</button>
				{/each}
			</div>

			{#if error}<p class="error">{error}</p>{/if}

			<div class="form-actions">
				<button class="btn-secondary" onclick={() => (showCreate = false)}>Cancelar</button>
				<button class="btn-primary" onclick={createSession} disabled={loading}>
					{loading ? 'Creando...' : 'Crear'}
				</button>
			</div>
		</div>
	{/if}

	<div class="session-list">
		{#each sessions as s (s.id)}
			<div class="card session-card-wrap" class:new-invite={isNewInvite(s)}>
				<a href="/sessions/{s.id}" class="session-card">
					<div class="session-header">
						<strong>{s.name}</strong>
						<div class="status-group">
							{#if isNewInvite(s)}<span class="badge-new">Nueva</span>{/if}
							<span class="status">{statusLabel(s.status)}</span>
						</div>
					</div>
					<div class="session-meta">
						<span>{s.meme_count} memes</span>
						<span>{s.participants.map((p) => p.display_name).join(', ')}</span>
					</div>
					<span class="date">{new Date(s.created_at).toLocaleDateString()}</span>
				</a>
				{#if s.created_by === authVal.user?.id}
					<div class="card-actions">
						<button class="btn-delete-session" onclick={() => deleteSession(s.id)}>🗑️ Borrar</button>
					</div>
				{/if}
			</div>
		{:else}
			<p class="empty">No hay sesiones. ¡Crea una para empezar la review!</p>
		{/each}
	</div>
</div>

<style>
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.create-form {
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.label {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-top: 0.25rem;
	}
	.user-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.user-chip {
		padding: 0.4rem 0.8rem;
		border-radius: 20px;
		font-size: 0.85rem;
		background: var(--bg-input);
		color: var(--text);
		border: 2px solid transparent;
	}
	.user-chip.selected {
		border-color: var(--accent);
		background: rgba(233, 69, 96, 0.2);
	}
	.form-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.error {
		color: var(--accent);
		font-size: 0.85rem;
	}
	.session-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.session-card {
		display: block;
		color: var(--text);
		padding: 1rem;
	}
	.session-card:hover strong {
		color: var(--accent);
		transition: color 0.15s;
	}
	.session-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.status {
		font-size: 0.8rem;
	}
	.session-meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 0.25rem;
	}
	.date {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: 2rem 0;
	}
	.config-row {
		display: flex;
		gap: 1rem;
	}
	.config-field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.config-field input {
		width: 100%;
	}
	.mode-toggle {
		display: flex;
		gap: 0.4rem;
	}
	.mode-btn {
		flex: 1;
		padding: 0.4rem 0.5rem;
		border-radius: 8px;
		font-size: 0.8rem;
		background: var(--bg-input);
		color: var(--text);
		border: 2px solid transparent;
	}
	.mode-btn.selected {
		border-color: var(--accent);
		background: rgba(233, 69, 96, 0.2);
	}
	.session-card-wrap {
		padding: 0;
		overflow: hidden;
	}
	.card-actions {
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		padding: 0.5rem 1rem;
		display: flex;
		justify-content: flex-end;
	}
	.btn-delete-session {
		background: none;
		border: none;
		font-size: 0.8rem;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		transition: color 0.15s, background 0.15s;
	}
	.btn-delete-session:hover {
		color: var(--accent);
		background: rgba(233, 69, 96, 0.1);
	}
	.new-invite {
		border: 1px solid var(--accent) !important;
	}
	.status-group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.badge-new {
		background: var(--accent);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.1rem 0.5rem;
		border-radius: 10px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
</style>
