<script>
	import { api } from '$lib/api.js';
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleLogin() {
		error = '';
		loading = true;
		try {
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

<div class="login-page">
	<div class="login-card glass-strong fade-in">
		<!-- Brand badge -->
		<div class="brand-badge">
			<span class="badge-icon">🍿</span>
		</div>

		<h1 class="login-title">The Review</h1>
		<p class="login-sub">Meme review con los panas</p>

		<form onsubmit={(e) => { e.preventDefault(); handleLogin(); }}>
			<div class="field">
				<label class="field-label" for="username">Username</label>
				<input
					id="username"
					bind:value={username}
					placeholder="tu_username"
					required
					autocomplete="username"
				/>
			</div>
			<div class="field">
				<label class="field-label" for="password">Password</label>
				<input
					id="password"
					bind:value={password}
					type="password"
					placeholder="••••••••"
					required
					autocomplete="current-password"
				/>
			</div>

			{#if error}
				<p class="login-error">{error}</p>
			{/if}

			<button class="btn-primary login-btn" type="submit" disabled={loading}>
				{#if loading}
					<span class="dots"><span></span><span></span><span></span></span>
				{:else}
					Entrar
				{/if}
			</button>
		</form>

		<p class="switch">¿No tienes cuenta? <a href="/register">Regístrate</a></p>

		<!-- Feature chips -->
		<div class="feature-chips">
			<span class="chip chip-violet">🎬 Review sync</span>
			<span class="chip chip-teal">⚡ Real-time</span>
			<span class="chip chip-coral">🏆 Rankings</span>
		</div>
	</div>
</div>

<style>
	.login-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: calc(100dvh - 52px);
		padding: 2rem 1rem;
	}

	.login-card {
		width: 100%;
		max-width: 380px;
		padding: 2.5rem 2rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.brand-badge {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--coral-bright), var(--coral-deep));
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 1.25rem;
		box-shadow: 0 8px 32px rgba(255, 84, 112, 0.4);
	}
	.badge-icon { font-size: 2rem; line-height: 1; }

	.login-title {
		font-size: 2rem;
		font-weight: 800;
		letter-spacing: -0.03em;
		margin-bottom: 0.3rem;
	}
	.login-sub {
		font-size: 0.9rem;
		color: var(--text-muted);
		margin-bottom: 1.75rem;
	}

	form { display: flex; flex-direction: column; gap: 0.75rem; }

	.field { display: flex; flex-direction: column; gap: 0.3rem; text-align: left; }
	.field-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding-left: 0.25rem;
	}

	.login-error {
		color: var(--coral-bright);
		font-size: 0.85rem;
		text-align: left;
	}

	.login-btn {
		width: 100%;
		padding: 0.75rem;
		font-size: 0.95rem;
		margin-top: 0.25rem;
	}

	.switch {
		margin-top: 1.25rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.feature-chips {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid rgba(255,255,255,0.07);
	}
</style>
