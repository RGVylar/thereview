<script>
  import { auth } from '$lib/auth.js';
  import { api } from '$lib/api.js';

  let rewindData = $state(null);
  let error = $state(null);
  let authVal = $state(null);

  auth.subscribe((v) => (authVal = v));

  let loading = $derived(rewindData === null && !error);

  async function loadRewindData() {
    if (!authVal?.token) return;

    try {
      error = null;
      const response = await api('/api/memes/rewind/review-stats', { token: authVal.token });
      rewindData = response;
    } catch (err) {
      error = err.message;
      rewindData = { years: {} };
    }
  }

  $effect(() => {
    if (authVal?.token) {
      loadRewindData();
    }
  });

  function getThumbnail(url) {
    // Try to extract a thumbnail URL from various video platforms
    if (url.includes('tiktok')) {
      return '/images/tiktok-logo.png';
    } else if (url.includes('twitter') || url.includes('x.com')) {
      return '/images/twitter-logo.png';
    } else if (url.includes('instagram')) {
      return '/images/instagram-logo.png';
    } else if (url.includes('youtube')) {
      return '/images/youtube-logo.png';
    }
    return '/images/meme-placeholder.png';
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
</script>

<svelte:head>
  <title>Rewind - The Review</title>
</svelte:head>

{#if !authVal?.token}
  <div class="container">
    <p class="text-center">Please log in to view your rewind.</p>
  </div>
{:else if loading}
  <div class="container">
    <p class="text-center">Loading your rewind...</p>
  </div>
{:else if error}
  <div class="container">
    <p class="text-center error">Error: {error}</p>
  </div>
{:else if !rewindData?.years || Object.keys(rewindData.years).length === 0}
  <div class="container">
    <p class="text-center">No reviewed memes yet. Start reviewing to build your rewind!</p>
  </div>
{:else}
  <div class="rewind-container">
    <div class="rewind-header">
      <h1>🎬 Your Review Rewind</h1>
      <p class="subtitle">Year-by-year recap of your meme reviews</p>
    </div>

    {#each Object.entries(rewindData.years) as [year, yearData] (year)}
      <div class="year-section">
        <div class="year-header">
          <h2>{year}</h2>
          <div class="year-stats">
            <span class="stat-badge">{yearData.count} memes reviewed</span>
          </div>
        </div>

        <div class="year-highlights">
          {#if yearData.super_favorites && yearData.super_favorites.length > 0}
            <div class="highlight-card super-fav">
              <div class="highlight-title">⭐ Super Favorites ({yearData.super_favorites.length})</div>
              <div class="super-fav-grid">
                {#each yearData.super_favorites as meme (meme.id)}
                  <a href={meme.url} target="_blank" rel="noopener noreferrer" class="super-fav-item">
                    <div class="meme-thumbnail" style="background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);">
                      <img src={getThumbnail(meme.url)} alt="Super favorite" />
                      <div class="super-fav-badge">👑</div>
                    </div>
                    <div class="meme-info">
                      <div class="vote-badge">{meme.avg_vote}⭐</div>
                      <div class="date-small">{formatDate(meme.reviewed_at)}</div>
                    </div>
                  </a>
                {/each}
              </div>
            </div>
          {/if}

          {#if yearData.best_meme}
            <div class="highlight-card best">
              <div class="highlight-title">🏆 Best Meme of {year}</div>
              <div class="meme-card-mini">
                <div class="meme-thumbnail" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                  <img src={getThumbnail(yearData.best_meme.url)} alt="Best meme" />
                </div>
                <div class="meme-stats">
                  <div class="avg-vote">{yearData.best_meme.avg_vote}⭐</div>
                  <div class="vote-info">{yearData.best_meme.vote_count} votes</div>
                  <div class="reviewed-date">{formatDate(yearData.best_meme.reviewed_at)}</div>
                </div>
              </div>
            </div>
          {/if}

          {#if yearData.worst_meme && yearData.worst_meme.id !== yearData.best_meme?.id}
            <div class="highlight-card worst">
              <div class="highlight-title">📉 Worst Meme of {year}</div>
              <div class="meme-card-mini">
                <div class="meme-thumbnail" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                  <img src={getThumbnail(yearData.worst_meme.url)} alt="Worst meme" />
                </div>
                <div class="meme-stats">
                  <div class="avg-vote">{yearData.worst_meme.avg_vote}⭐</div>
                  <div class="vote-info">{yearData.worst_meme.vote_count} votes</div>
                  <div class="reviewed-date">{formatDate(yearData.worst_meme.reviewed_at)}</div>
                </div>
              </div>
            </div>
          {/if}
        </div>

        <div class="memes-grid">
          {#each yearData.memes as meme (meme.id)}
            <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-item">
              <div class="meme-thumbnail" style="background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);">
                <img src={getThumbnail(meme.url)} alt="Meme" />
              </div>
              <div class="meme-rating">
                <div class="vote-badge">
                  <span class="vote-value">{meme.avg_vote}</span>
                  <span class="vote-label">avg</span>
                </div>
              </div>
              <div class="meme-date">{formatDate(meme.reviewed_at)}</div>
            </a>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  :global(body) {
    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
  }

  .rewind-container {
    min-height: 100vh;
    padding: 2rem 1rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .rewind-header {
    text-align: center;
    margin-bottom: 3rem;
    color: white;
  }

  .rewind-header h1 {
    font-size: 3rem;
    margin: 0;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
  }

  .subtitle {
    font-size: 1.2rem;
    margin: 0.5rem 0 0 0;
    opacity: 0.9;
  }

  .year-section {
    max-width: 1200px;
    margin: 0 auto 4rem;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 1rem;
    padding: 2rem;
    backdrop-filter: blur(10px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  .year-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 3px solid #667eea;
  }

  .year-header h2 {
    margin: 0;
    font-size: 2rem;
    color: #333;
  }

  .year-stats {
    display: flex;
    gap: 1rem;
  }

  .stat-badge {
    background: #667eea;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 2rem;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .year-highlights {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  .highlight-card {
    border-radius: 0.75rem;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .highlight-card.best {
    border: 3px solid #ffd700;
    background: linear-gradient(135deg, #fff9e6 0%, #fff5cc 100%);
  }

  .highlight-card.worst {
    border: 3px solid #ff6b6b;
    background: linear-gradient(135deg, #ffe0e0 0%, #ffcccc 100%);
  }

  .highlight-card.super-fav {
    border: 3px solid #ffd700;
    background: linear-gradient(135deg, #fffef0 0%, #fffde7 100%);
  }

  .super-fav-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 0.75rem;
    padding: 1rem;
  }

  .super-fav-item {
    position: relative;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .super-fav-item .meme-thumbnail {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .super-fav-badge {
    position: absolute;
    top: -0.5rem;
    right: -0.5rem;
    font-size: 1.5rem;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
  }

  .super-fav-item .meme-info {
    text-align: center;
  }

  .super-fav-item .vote-badge {
    display: inline-block;
    background: #ffd700;
    color: #333;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .date-small {
    font-size: 0.65rem;
    color: #999;
    margin-top: 0.25rem;
  }

  .highlight-title {
    padding: 1rem;
    font-weight: 700;
    font-size: 1rem;
    text-align: center;
    background: rgba(0, 0, 0, 0.05);
  }

  .meme-card-mini {
    padding: 1rem;
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .meme-thumbnail {
    width: 80px;
    height: 80px;
    border-radius: 0.5rem;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .meme-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .meme-stats {
    flex: 1;
  }

  .avg-vote {
    font-size: 1.3rem;
    font-weight: 700;
    color: #333;
  }

  .vote-info {
    font-size: 0.85rem;
    color: #666;
  }

  .reviewed-date {
    font-size: 0.8rem;
    color: #999;
    margin-top: 0.25rem;
  }

  .memes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 1rem;
  }

  .meme-item {
    position: relative;
    border-radius: 0.5rem;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    text-decoration: none;
    display: block;
  }

  .meme-item:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
  }

  .meme-item .meme-thumbnail {
    width: 100%;
    height: 120px;
    border-radius: 0.5rem;
  }

  .meme-rating {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .vote-badge {
    background: rgba(102, 126, 234, 0.95);
    color: white;
    padding: 0.4rem 0.6rem;
    border-radius: 0.3rem;
    font-size: 0.8rem;
    font-weight: 700;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1;
  }

  .vote-value {
    font-size: 0.95rem;
  }

  .vote-label {
    font-size: 0.65rem;
    opacity: 0.8;
  }

  .meme-date {
    padding: 0.5rem;
    font-size: 0.7rem;
    color: #666;
    background: rgba(0, 0, 0, 0.03);
    text-align: center;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
    text-align: center;
    color: white;
  }

  .error {
    color: #ff6b6b;
  }

  @media (max-width: 768px) {
    .rewind-header h1 {
      font-size: 2rem;
    }

    .year-section {
      padding: 1rem;
    }

    .year-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }

    .year-highlights {
      grid-template-columns: 1fr;
    }

    .memes-grid {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 0.75rem;
    }

    .meme-item .meme-thumbnail {
      height: 100px;
    }
  }
</style>
