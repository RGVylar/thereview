<script>
  import { onDestroy } from 'svelte';
  import { api } from '$lib/api.js';
  import { auth } from '$lib/auth.js';
  import { detectEmbed } from '$lib/embed.js';

  let memes = [];
  let error = '';
  let loading = false;
  let twitterEmbeds = {};

  let authVal;
  const unsub = auth.subscribe((v) => {
    authVal = v;
    if (authVal?.token) loadMemes();
  });
  onDestroy(() => unsub());

  // Svelte action: after HTML is injected, tell Twitter widgets to render
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

  async function loadMemes() {
    error = '';
    loading = true;
    try {
      const data = await api('/api/memes?pending=false', { token: authVal.token });
      memes = data.map((m) => ({ ...m, embed: detectEmbed(m.url) }));
      // Preload twitter embeds
      for (const m of memes) {
        if (m.embed.type === 'twitter') await loadTwitterEmbed(m.id, m.url);
      }
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
</script>

<div class="container">
  <h2 class="page-title">📦 Mis Memes</h2>

  {#if loading}
    <p>Cargando...</p>
  {:else}
    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="meme-list">
      {#each memes as meme (meme.id)}
        <div class="card meme-card">
          <div class="meme-meta">
            <span class="meme-type">{meme.embed.type.toUpperCase()}</span>
            <button class="btn-ghost" on:click={() => deleteMeme(meme.id)}>✕</button>
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
        <p class="empty">No tienes memes añadidos aún. Usa el formulario superior para añadir uno.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .meme-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .meme-card { padding: 1rem; }
  .embed-frame { width: 100%; aspect-ratio: 16/9; border: none; border-radius: 8px; }
  .meme-preview { max-width: 100%; border-radius: 8px; }
  .tiktok-frame { aspect-ratio: 9/16; }
  .instagram-frame { aspect-ratio: 4/5; }
  .twitter-embed-wrap { width: 100%; display: flex; justify-content: center; }
  .tweet-hint { color: var(--text-muted); }
  .empty { text-align: center; color: var(--text-muted); padding: 2rem 0; }
</style>
