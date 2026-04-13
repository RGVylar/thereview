<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';

	let username = $state('');
	let displayName = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleRegister() {
		error = '';
		loading = true;
		try {
			await api('/api/auth/register', {
				method: 'POST',
				body: { username, display_name: displayName, password }
			});
			// Auto-login
			const tokenData = await api('/api/auth/login', {
				method: 'POST',
				body: { username, password }
			});
			const user = await api('/api/auth/me', { token: tokenData.access_token });
			auth.login(tokenData.access_token, user);
			goto('/sessions');
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
</script>

<div class="container auth-page">
	<div class="card auth-card">
		<h1>🍿 Registro</h1>
		<p class="subtitle">Únete a la review</p>

		<form onsubmit={(e) => { e.preventDefault(); handleRegister(); }}>
			<input bind:value={username} placeholder="Username" required />
			<input bind:value={displayName} placeholder="Nombre para mostrar" required />
			<input bind:value={password} type="password" placeholder="Password" required />
			{#if error}<p class="error">{error}</p>{/if}
			<button class="btn-primary" type="submit" disabled={loading}>
				{loading ? 'Creando...' : 'Crear cuenta'}
			</button>
		</form>

		<p class="switch">¿Ya tienes cuenta? <a href="/login">Inicia sesión</a></p>
	</div>
</div>

<style>
	.auth-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 80dvh;
	}
	.auth-card {
		width: 100%;
		max-width: 380px;
		text-align: center;
	}
	.auth-card h1 {
		font-size: 2rem;
		margin-bottom: 0.25rem;
	}
	.subtitle {
		color: var(--text-muted);
		margin-bottom: 1.5rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.error {
		color: var(--accent);
		font-size: 0.85rem;
	}
	.switch {
		margin-top: 1rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
</style>
