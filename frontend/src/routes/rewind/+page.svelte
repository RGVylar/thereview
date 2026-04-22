<script>
  import { auth } from '$lib/auth.js';
  import { api } from '$lib/api.js';

  let rewindData = $state(null);
  let error = $state(null);
  let authVal = $state(null);
  let isLoading = $state(true);
  let failedThumbnails = $state(new Set());

  auth.subscribe((v) => (authVal = v));

  function handleImageError(memeId) {
    failedThumbnails.add(memeId);
    failedThumbnails = failedThumbnails;
  }

  async function loadRewindData() {
    if (!authVal?.token) {
      isLoading = false;
      return;
    }

    try {
      isLoading = true;
      error = null;
      const response = await api('/api/memes/rewind/review-stats', { token: authVal.token });
      rewindData = response;
      isLoading = false;
    } catch (err) {
      error = err.message;
      rewindData = { years: {}, global_stats: {} };
      isLoading = false;
    }
  }

  $effect(() => {
    if (authVal?.token) {
      loadRewindData();
    }
  });

  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const PLATFORM_EMOJI = {
    tiktok: '🎵',
    twitter: '𝕏',
    instagram: '📷',
    youtube: '▶️',
    otro: '🎬'
  };
  const PLATFORM_NAME = {
    tiktok: 'TikTok',
    twitter: 'Twitter/X',
    instagram: 'Instagram',
    youtube: 'YouTube',
    otro: 'Otros'
  };

  function buildCalendarGrid(year, memes) {
    if (!memes || memes.length === 0) return { weeks: [], monthLabels: [] };

    const dateMap = {};
    let maxCount = 0;

    memes.forEach(meme => {
      const date = new Date(meme.reviewed_at).toISOString().split('T')[0];
      dateMap[date] = (dateMap[date] || 0) + 1;
      maxCount = Math.max(maxCount, dateMap[date]);
    });

    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);

    const startDate = new Date(jan1);
    const dow = (jan1.getDay() + 6) % 7;
    startDate.setDate(startDate.getDate() - dow);

    const weeks = [];
    const cur = new Date(startDate);

    while (cur <= dec31) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = cur.toISOString().split('T')[0];
        const inYear = cur.getFullYear() === year;
        week.push({
          date: dateStr,
          count: dateMap[dateStr] || 0,
          inYear
        });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    const monthLabels = [];
    const seen = new Set();
    weeks.forEach((week, col) => {
      const firstInYear = week.find(d => d.inYear);
      if (!firstInYear) return;
      const m = new Date(firstInYear.date).getMonth();
      if (!seen.has(m) && new Date(firstInYear.date).getDate() <= 7) {
        seen.add(m);
        monthLabels.push({ label: MONTHS[m], col });
      }
    });

    return { weeks, monthLabels, maxCount };
  }

  function heatColor(count, maxCount, inYear) {
    if (!inYear) return 'transparent';
    if (count === 0) return 'rgba(255,255,255,0.05)';
    const intensity = count / maxCount;
    if (intensity < 0.25) return '#667eea30';
    if (intensity < 0.5) return '#667eea60';
    if (intensity < 0.75) return '#667eea90';
    return '#667eea';
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function getPlatformColor(url) {
    if (url.includes('tiktok')) return 'linear-gradient(135deg, #000 0%, #25f4ee 100%)';
    if (url.includes('twitter') || url.includes('x.com')) return 'linear-gradient(135deg, #1da1f2 0%, #1a91da 100%)';
    if (url.includes('instagram')) return 'linear-gradient(135deg, #feda75 0%, #fa7e1e 100%)';
    if (url.includes('youtube')) return 'linear-gradient(135deg, #ff0000 0%, #cc0000 100%)';
    return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  }

  function getPlatformEmoji(url) {
    if (url.includes('tiktok')) return '🎵';
    if (url.includes('twitter') || url.includes('x.com')) return '𝕏';
    if (url.includes('instagram')) return '📷';
    if (url.includes('youtube')) return '▶️';
    return '🎬';
  }
</script>

<svelte:head>
  <title>Rewind - The Review</title>
</svelte:head>

{#if !authVal?.token}
  <div class="container">
    <p class="text-center">Por favor inicia sesión para ver tu rewind.</p>
  </div>
{:else if isLoading}
  <div class="container">
    <p class="text-center">Calculando tu año…</p>
  </div>
{:else if error}
  <div class="container">
    <p class="text-center error">Error: {error}</p>
  </div>
{:else if !rewindData?.years || Object.keys(rewindData.years).length === 0}
  <div class="container">
    <p class="text-center">Sin memes revisados aún. ¡Empieza a revisar!</p>
  </div>
{:else}
  <div class="rewind-wrapper">
    <!-- Global Stats -->
    {#if rewindData.global_stats}
      <div class="global-hero">
        <div class="hero-kicker">TU HISTORIAL DE REVIEWS</div>
        <div class="hero-number">{rewindData.global_stats.total_memes}</div>
        <div class="hero-unit">memes revisados · {rewindData.global_stats.avg_score}⭐ promedio</div>

        {#if rewindData.global_stats.platform_breakdown}
          <div class="platform-grid">
            {#each Object.entries(rewindData.global_stats.platform_breakdown) as [platform, count]}
              <div class="platform-card">
                <span class="platform-emoji">{PLATFORM_EMOJI[platform] || '🎬'}</span>
                <span class="platform-count">{count}</span>
                <span class="platform-name">{PLATFORM_NAME[platform]}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Year breakdown -->
    {#each Object.entries(rewindData.years).sort((a, b) => parseInt(b[0]) - parseInt(a[0])) as [year, yearData]}
      {@const calData = buildCalendarGrid(parseInt(year), yearData.memes)}
      <div class="year-section">
        <div class="year-hero">
          <div class="year-label">Rewind {year}</div>
          <div class="year-number">{yearData.count}</div>
          <div class="year-unit">memes revisados</div>
        </div>

        {#if calData.weeks.length > 0}
          <div class="section">
            <h3 class="section-title">📅 Actividad Diaria</h3>
            <div class="heatmap-wrap">
              <div class="heatmap-months" style="grid-template-columns: 20px repeat({calData.weeks.length}, 10px);">
                <div></div>
                {#each calData.weeks as _, col}
                  {@const label = calData.monthLabels.find(m => m.col === col)}
                  <div class="month-label">{label ? label.label : ''}</div>
                {/each}
              </div>

              <div class="heatmap-body">
                <div class="day-labels">
                  {#each DAYS as d, i}
                    {#if i % 2 === 0}
                      <div class="day-label">{d}</div>
                    {:else}
                      <div class="day-label"></div>
                    {/if}
                  {/each}
                </div>

                <div class="calendar-grid">
                  {#each calData.weeks as week}
                    <div class="week-col">
                      {#each week as day}
                        <div
                          class="heat-cell"
                          style="background-color: {heatColor(day.count, calData.maxCount, day.inYear)}"
                          title={day.inYear && day.count > 0 ? `${day.date}: ${day.count} meme${day.count !== 1 ? 's' : ''}` : day.date}
                        />
                      {/each}
                    </div>
                  {/each}
                </div>
              </div>

              <div class="heat-legend">
                <span>Menos</span>
                <div class="heat-cell" style="background-color: rgba(255,255,255,0.05)"></div>
                <div class="heat-cell" style="background-color: #667eea30"></div>
                <div class="heat-cell" style="background-color: #667eea60"></div>
                <div class="heat-cell" style="background-color: #667eea90"></div>
                <div class="heat-cell" style="background-color: #667eea"></div>
                <span>Más</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Super Favorites -->
        {#if yearData.super_favorites && yearData.super_favorites.length > 0}
          <div class="section">
            <h3 class="section-title">⭐ Super Favoritos ({yearData.super_favorites.length})</h3>
            <div class="memes-list">
              {#each yearData.super_favorites.slice(0, 5) as meme}
                <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-item super">
                  <div class="thumbnail" style="background: {getPlatformColor(meme.url)};">
                    {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                      <img
                        src={meme.thumbnail_url}
                        alt="meme"
                        class="thumbnail-img"
                        onerror={() => handleImageError(meme.id)}
                      />
                    {:else}
                      <span class="platform-emoji">{getPlatformEmoji(meme.url)}</span>
                    {/if}
                  </div>
                  <div class="meme-content">
                    <div class="score-row">
                      <span class="score">{meme.avg_vote}⭐</span>
                      <span class="percentile">{Math.round(meme.percentile)}th %ile</span>
                    </div>
                    <div class="meta">{formatDate(meme.reviewed_at)}</div>
                  </div>
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Top 3 (only voted memes) -->
        {#if yearData.memes && yearData.memes.filter(m => m.vote_count > 0).length > 0}
          <div class="section">
            <h3 class="section-title">🏆 Top 3</h3>
            <div class="memes-list">
              {#each yearData.memes.filter(m => m.vote_count > 0).slice(0, 3) as meme, idx}
                <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-item top">
                  <div class="rank">#{idx + 1}</div>
                  <div class="thumbnail" style="background: {getPlatformColor(meme.url)};">
                    {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                      <img
                        src={meme.thumbnail_url}
                        alt="meme"
                        class="thumbnail-img"
                        onerror={() => handleImageError(meme.id)}
                      />
                    {:else}
                      <span class="platform-emoji">{getPlatformEmoji(meme.url)}</span>
                    {/if}
                  </div>
                  <div class="meme-content">
                    <div class="score-row">
                      <span class="score">{meme.avg_vote}⭐</span>
                      <span class="percentile">{Math.round(meme.percentile)}th %ile</span>
                    </div>
                    <div class="meta">{formatDate(meme.reviewed_at)}</div>
                  </div>
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Bottom 3 (only voted memes) -->
        {#if yearData.memes && yearData.memes.filter(m => m.vote_count > 0).length > 0}
          <div class="section">
            <h3 class="section-title">📉 Bottom 3</h3>
            <div class="memes-list">
              {#each [...yearData.memes].filter(m => m.vote_count > 0).reverse().slice(0, 3) as meme, idx}
                <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-item bottom">
                  <div class="rank">#{idx + 1}</div>
                  <div class="thumbnail" style="background: {getPlatformColor(meme.url)};">
                    {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                      <img
                        src={meme.thumbnail_url}
                        alt="meme"
                        class="thumbnail-img"
                        onerror={() => handleImageError(meme.id)}
                      />
                    {:else}
                      <span class="platform-emoji">{getPlatformEmoji(meme.url)}</span>
                    {/if}
                  </div>
                  <div class="meme-content">
                    <div class="score-row">
                      <span class="score">{meme.avg_vote}⭐</span>
                      <span class="percentile">{Math.round(meme.percentile)}th %ile</span>
                    </div>
                    <div class="meta">{formatDate(meme.reviewed_at)}</div>
                  </div>
                </a>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  :global(body) {
    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
  }

  .rewind-wrapper {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .global-hero {
    text-align: center;
    margin-bottom: 3rem;
    padding: 2rem;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
  }

  .hero-kicker {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 0.5rem;
  }

  .hero-number {
    font-size: 3rem;
    font-weight: 900;
    margin: 0.5rem 0;
  }

  .hero-unit {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.8);
  }

  .platform-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 1rem;
    margin-top: 2rem;
  }

  .platform-card {
    background: rgba(255, 255, 255, 0.1);
    padding: 1rem;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .platform-emoji {
    font-size: 1.5rem;
  }

  .platform-count {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .platform-name {
    font-size: 0.75rem;
    opacity: 0.8;
  }

  .year-section {
    margin-bottom: 3rem;
    padding: 2rem;
    background: var(--bg-card);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .year-hero {
    text-align: center;
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .year-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .year-number {
    font-size: 3rem;
    font-weight: 900;
    color: var(--accent);
    line-height: 1;
  }

  .year-unit {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
  }

  .section {
    margin-bottom: 2rem;
  }

  .section-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-bottom: 1rem;
    margin-top: 0;
  }

  .heatmap-wrap {
    overflow-x: auto;
    padding-bottom: 1rem;
  }

  .heatmap-months {
    display: grid;
    gap: 2px;
    margin-bottom: 2px;
    min-width: max-content;
  }

  .month-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    text-align: left;
    white-space: nowrap;
    line-height: 10px;
  }

  .heatmap-body {
    display: flex;
    gap: 4px;
    min-width: max-content;
  }

  .day-labels {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 20px;
  }

  .day-label {
    height: 10px;
    font-size: 0.55rem;
    color: var(--text-muted);
    line-height: 10px;
    text-align: center;
  }

  .calendar-grid {
    display: flex;
    gap: 2px;
  }

  .week-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .heat-cell {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .heat-legend {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 1rem;
    font-size: 0.65rem;
    color: var(--text-muted);
  }

  .heat-legend .heat-cell {
    border: none;
  }

  .memes-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .meme-item {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 1rem;
    border-radius: 8px;
    text-decoration: none;
    transition: all 0.2s ease;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .meme-item.super {
    background: rgba(255, 215, 0, 0.1);
    border-color: rgba(255, 215, 0, 0.3);
  }

  .meme-item.super:hover {
    background: rgba(255, 215, 0, 0.15);
    border-color: rgba(255, 215, 0, 0.5);
  }

  .meme-item.top {
    background: rgba(102, 126, 234, 0.1);
    border-color: rgba(102, 126, 234, 0.3);
  }

  .meme-item.top:hover {
    background: rgba(102, 126, 234, 0.15);
    border-color: rgba(102, 126, 234, 0.5);
  }

  .meme-item.bottom {
    background: rgba(255, 107, 107, 0.1);
    border-color: rgba(255, 107, 107, 0.3);
  }

  .meme-item.bottom:hover {
    background: rgba(255, 107, 107, 0.15);
    border-color: rgba(255, 107, 107, 0.5);
  }

  .rank {
    min-width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-weight: 700;
    font-size: 0.95rem;
    flex-shrink: 0;
  }

  .meme-item.top .rank {
    background: rgba(102, 126, 234, 0.2);
    color: #a8c5ff;
  }

  .meme-item.bottom .rank {
    background: rgba(255, 107, 107, 0.2);
    color: #ff9999;
  }

  .thumbnail {
    width: 60px;
    height: 60px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 1.8rem;
  }

  .platform-emoji {
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  }

  .thumbnail-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
  }

  .meme-content {
    flex: 1;
  }

  .score-row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }

  .score {
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--text);
  }

  .percentile {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.05);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }

  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }

  .container {
    text-align: center;
    padding: 2rem;
    color: var(--text);
  }

  .error {
    color: #ff6b6b;
  }

  @media (max-width: 640px) {
    .rewind-wrapper {
      padding: 1rem;
    }

    .year-section {
      padding: 1rem;
    }

    .year-number {
      font-size: 2rem;
    }

    .meme-item {
      flex-direction: column;
      text-align: center;
    }

    .rank {
      width: 100%;
      min-width: 100%;
    }

    .platform-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
