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
				body: { name: name.trim(), user_ids: selectedUserIds },
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
			<a href="/sessions/{s.id}" class="card session-card">
				<div class="session-header">
					<strong>{s.name}</strong>
					<span class="status">{statusLabel(s.status)}</span>
				</div>
				<div class="session-meta">
					<span>{s.meme_count} memes</span>
					<span>{s.participants.map((p) => p.display_name).join(', ')}</span>
				</div>
				<span class="date">{new Date(s.created_at).toLocaleDateString()}</span>
			</a>
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
		transition: transform 0.15s;
	}
	.session-card:hover {
		transform: translateY(-2px);
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
</style>
