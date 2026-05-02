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
	<!-- Floating brand badge -->
	<div class="floating-brand">
		<div class="brand-icon">🍿</div>
		<span class="brand-name">The Review</span>
	</div>

	<!-- Login card -->
	<div class="login-card glass-strong fade-in">
		<div class="card-header">
			<div class="eyebrow">Welcome back</div>
			<h1 class="login-title">Meme review<br/>con los panas</h1>
			<p class="login-sub">
				Acumula memes durante el mes,<br/>revísalos juntos, votad sin piedad.
			</p>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleLogin(); }}>
			<label class="field">
				<span class="field-label">Usuario</span>
				<input
					bind:value={username}
					placeholder="tu_username"
					required
					autocomplete="username"
				/>
			</label>
			<label class="field">
				<span class="field-label">Contraseña</span>
				<input
					bind:value={password}
					type="password"
					placeholder="••••••••"
					required
					autocomplete="current-password"
				/>
			</label>

			{#if error}
				<p class="login-error">{error}</p>
			{/if}

			<button class="btn-primary login-btn" type="submit" disabled={loading}>
				{loading ? 'Entrando…' : 'Entrar'}
			</button>
		</form>

		<div class="divider">
			<span class="divider-line"></span>
			<span class="eyebrow" style="font-size:0.62rem">o</span>
			<span class="divider-line"></span>
		</div>

		<p class="switch">¿No tienes cuenta? <a href="/register">Regístrate</a></p>
	</div>

	<!-- Bottom feature chips -->
	<div class="feature-chips">
		<span class="chip">🎬 Sync video</span>
		<span class="chip">🖱️ Cursores compartidos</span>
		<span class="chip">📝 Notepad live</span>
		<span class="chip">🏆 Rewind anual</span>
	</div>
</div>

<style>
	.login-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: calc(100dvh - 52px);
		padding: 2rem 1rem;
		position: relative;
	}

	/* ── Floating brand ── */
	.floating-brand {
		position: absolute;
		top: 8%;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.6rem;
		white-space: nowrap;
	}
	.brand-icon {
		width: 44px;
		height: 44px;
		border-radius: 14px;
		background: linear-gradient(135deg, var(--coral), var(--violet));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.4rem;
		box-shadow: 0 12px 40px rgba(255,84,112,0.45), inset 0 1px 0 rgba(255,255,255,0.4);
		flex-shrink: 0;
	}
	.brand-name {
		font-weight: 700;
		font-size: 1.1rem;
		letter-spacing: -0.01em;
	}

	/* ── Card ── */
	.login-card {
		width: 100%;
		max-width: 440px;
		padding: 2.5rem 2.25rem;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.card-header {
		text-align: center;
		margin-bottom: 1.75rem;
	}
	.card-header .eyebrow { margin-bottom: 0.5rem; }

	.login-title {
		font-size: 1.9rem;
		font-weight: 800;
		letter-spacing: -0.025em;
		line-height: 1.15;
		margin-bottom: 0.4rem;
	}
	.login-sub {
		font-size: 0.92rem;
		color: var(--text-muted);
		line-height: 1.5;
	}

	/* ── Form ── */
	form { display: flex; flex-direction: column; gap: 0.75rem; }

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.login-error {
		color: var(--coral-bright);
		font-size: 0.85rem;
	}

	.login-btn {
		width: 100%;
		padding: 0.85rem;
		font-size: 0.95rem;
		margin-top: 0.5rem;
	}

	/* ── Divider ── */
	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 1.5rem 0 1rem;
	}
	.divider-line {
		flex: 1;
		height: 1px;
		background: rgba(255,255,255,0.1);
	}

	.switch {
		text-align: center;
		font-size: 0.85rem;
		color: var(--text-soft);
	}
	.switch a {
		color: var(--coral-bright);
		font-weight: 600;
		text-decoration: none;
	}
	.switch a:hover { text-decoration: underline; }

	/* ── Bottom feature chips ── */
	.feature-chips {
		position: absolute;
		bottom: 7%;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
		white-space: nowrap;
	}

	@media (max-width: 600px) {
		.floating-brand { top: 3%; }
		.feature-chips { bottom: 2%; position: static; transform: none; margin-top: 2rem; }
		.login-page { padding-top: 5rem; padding-bottom: 1rem; align-items: flex-start; }
	}
</style>
