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
    if (!authVal?.token) { isLoading = false; return; }
    try {
      isLoading = true;
      error = null;
      rewindData = await api('/api/memes/rewind/review-stats', { token: authVal.token });
    } catch (err) {
      error = err.message;
      rewindData = { years: {}, global_stats: {} };
    } finally {
      isLoading = false;
    }
  }

  $effect(() => { if (authVal?.token) loadRewindData(); });

  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const DAYS   = ['L','M','X','J','V','S','D'];

  const PLATFORM_META = {
    tiktok:    { emoji: '🎵', name: 'TikTok',     color: 'linear-gradient(135deg,#000 0%,#25f4ee 100%)' },
    twitter:   { emoji: '𝕏',  name: 'Twitter / X', color: 'linear-gradient(135deg,#1da1f2 0%,#0d8de0 100%)' },
    instagram: { emoji: '📷', name: 'Instagram',   color: 'linear-gradient(135deg,#f09433 0%,#bc1888 100%)' },
    youtube:   { emoji: '▶️', name: 'YouTube',     color: 'linear-gradient(135deg,#ff0000 0%,#cc0000 100%)' },
    otro:      { emoji: '🎬', name: 'Otros',        color: 'linear-gradient(135deg,#444 0%,#666 100%)' },
  };

  function getPlatform(url) {
    if (url.includes('tiktok'))               return 'tiktok';
    if (url.includes('twitter') || url.includes('x.com')) return 'twitter';
    if (url.includes('instagram'))            return 'instagram';
    if (url.includes('youtube'))              return 'youtube';
    return 'otro';
  }

  function buildCalendarGrid(year, memes) {
    if (!memes?.length) return { weeks: [], monthLabels: [], maxCount: 0 };

    const dateMap = {};
    let maxCount = 0;
    for (const m of memes) {
      const d = new Date(m.reviewed_at).toISOString().split('T')[0];
      dateMap[d] = (dateMap[d] || 0) + 1;
      if (dateMap[d] > maxCount) maxCount = dateMap[d];
    }

    const jan1   = new Date(year, 0, 1);
    const dec31  = new Date(year, 11, 31);
    const start  = new Date(jan1);
    start.setDate(start.getDate() - ((jan1.getDay() + 6) % 7));

    const weeks = [];
    const cur   = new Date(start);
    while (cur <= dec31) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const ds = cur.toISOString().split('T')[0];
        week.push({ date: ds, count: dateMap[ds] || 0, inYear: cur.getFullYear() === year });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    const monthLabels = [];
    const seen = new Set();
    weeks.forEach((week, col) => {
      const first = week.find(d => d.inYear);
      if (!first) return;
      const m = new Date(first.date).getMonth();
      if (!seen.has(m) && new Date(first.date).getDate() <= 7) {
        seen.add(m);
        monthLabels.push({ label: MONTHS[m], col });
      }
    });

    return { weeks, monthLabels, maxCount };
  }

  function heatColor(count, maxCount, inYear) {
    if (!inYear)   return 'transparent';
    if (!count)    return 'rgba(233,69,96,0.07)';
    const t = count / maxCount;
    if (t < 0.25)  return 'rgba(233,69,96,0.25)';
    if (t < 0.5)   return 'rgba(233,69,96,0.5)';
    if (t < 0.75)  return 'rgba(233,69,96,0.75)';
    return '#e94560';
  }

  function formatDate(s) {
    return new Date(s).toLocaleDateString('es-ES', { year:'numeric', month:'long', day:'numeric' });
  }

  function medalFor(idx) { return ['🥇','🥈','🥉'][idx] ?? `#${idx+1}`; }
</script>

<svelte:head><title>Rewind – The Review</title></svelte:head>

{#if !authVal?.token}
  <div class="empty"><p>Inicia sesión para ver tu rewind.</p></div>
{:else if isLoading}
  <div class="empty"><p>Calculando tu año…</p></div>
{:else if error}
  <div class="empty error"><p>Error: {error}</p></div>
{:else if !rewindData?.years || !Object.keys(rewindData.years).length}
  <div class="empty"><p>Sin memes revisados aún. ¡Empieza a revisar!</p></div>
{:else}
  <div class="page">

    <!-- ── GLOBAL HERO ── -->
    {#if rewindData.global_stats}
      {@const gs = rewindData.global_stats}
      <section class="hero card">
        <div class="hero-stat">
          <span class="stat-num">{gs.total_memes}</span>
          <span class="stat-label">memes revisados</span>
        </div>
        <div class="hero-divider"></div>
        <div class="hero-stat">
          <span class="stat-num">{gs.avg_score}<span class="stat-unit">⭐</span></span>
          <span class="stat-label">puntuación media</span>
        </div>
        {#if gs.platform_breakdown}
          <div class="hero-divider"></div>
          <div class="platforms">
            {#each Object.entries(gs.platform_breakdown).sort((a,b)=>b[1]-a[1]) as [p, n]}
              <div class="plat-pill">
                <span>{PLATFORM_META[p]?.emoji ?? '🎬'}</span>
                <span class="plat-n">{n}</span>
                <span class="plat-name">{PLATFORM_META[p]?.name ?? p}</span>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <!-- ── PER YEAR ── -->
    {#each Object.entries(rewindData.years).sort((a,b)=>+b[0]-+a[0]) as [year, yd]}
      {@const calData  = buildCalendarGrid(+year, yd.memes)}
      {@const voted    = yd.memes.filter(m => m.vote_count > 0)}
      {@const top3     = voted.slice(0, 3)}
      {@const bottom3  = [...voted].reverse().slice(0, 3)}

      <section class="year-block card">
        <!-- year header -->
        <div class="year-header">
          <h2 class="year-title">{year}</h2>
          <div class="year-meta">
            <span class="chip">{yd.count} memes</span>
            {#if yd.super_favorites?.length}
              <span class="chip chip-gold">⭐ {yd.super_favorites.length} super fav</span>
            {/if}
          </div>
        </div>

        <!-- heatmap -->
        {#if calData.weeks.length}
          <div class="heatmap-section">
            <h3 class="section-label">Actividad diaria</h3>
            <div class="heatmap-scroll">
              <!-- month row -->
              <div class="cal-months" style="padding-left:24px; display:flex; gap:2px;">
                {#each calData.weeks as _, col}
                  {@const lbl = calData.monthLabels.find(m=>m.col===col)}
                  <div class="cal-month-lbl">{lbl?.label ?? ''}</div>
                {/each}
              </div>
              <!-- grid -->
              <div class="cal-body">
                <div class="cal-days">
                  {#each DAYS as d, i}
                    <div class="cal-day">{i%2===0 ? d : ''}</div>
                  {/each}
                </div>
                <div class="cal-grid">
                  {#each calData.weeks as week}
                    <div class="cal-col">
                      {#each week as day}
                        <div
                          class="cal-cell"
                          style="background:{heatColor(day.count,calData.maxCount,day.inYear)}"
                          title={day.inYear && day.count ? `${day.date}: ${day.count} meme${day.count!==1?'s':''}` : ''}
                        ></div>
                      {/each}
                    </div>
                  {/each}
                </div>
              </div>
              <div class="cal-legend">
                <span>Menos</span>
                {#each [0.07,0.25,0.5,0.75,1] as a}
                  <div class="cal-cell" style="background:rgba(233,69,96,{a})"></div>
                {/each}
                <span>Más</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- top + bottom side by side on desktop -->
        <div class="ranking-grid">
          <!-- top 3 -->
          {#if top3.length}
            <div class="ranking-col">
              <h3 class="section-label">🏆 Top 3</h3>
              <div class="meme-list">
                {#each top3 as meme, idx}
                  <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-row meme-top">
                    <span class="medal">{medalFor(idx)}</span>
                    <div class="thumb" style="background:{PLATFORM_META[getPlatform(meme.url)]?.color}">
                      {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                        <img src={meme.thumbnail_url} alt="" class="thumb-img" onerror={()=>handleImageError(meme.id)} />
                      {:else}
                        <span class="thumb-emoji">{PLATFORM_META[getPlatform(meme.url)]?.emoji}</span>
                      {/if}
                    </div>
                    <div class="meme-info">
                      <span class="meme-score">{meme.avg_vote}<span class="score-star">⭐</span></span>
                      <span class="meme-pct">{meme.percentile ?? 0}%ile</span>
                    </div>
                  </a>
                {/each}
              </div>
            </div>
          {/if}

          <!-- bottom 3 -->
          {#if bottom3.length}
            <div class="ranking-col">
              <h3 class="section-label">📉 Bottom 3</h3>
              <div class="meme-list">
                {#each bottom3 as meme, idx}
                  <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-row meme-bottom">
                    <span class="medal medal-bottom">#{idx+1}</span>
                    <div class="thumb" style="background:{PLATFORM_META[getPlatform(meme.url)]?.color}">
                      {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                        <img src={meme.thumbnail_url} alt="" class="thumb-img" onerror={()=>handleImageError(meme.id)} />
                      {:else}
                        <span class="thumb-emoji">{PLATFORM_META[getPlatform(meme.url)]?.emoji}</span>
                      {/if}
                    </div>
                    <div class="meme-info">
                      <span class="meme-score">{meme.avg_vote}<span class="score-star">⭐</span></span>
                      <span class="meme-pct">{meme.percentile ?? 0}%ile</span>
                    </div>
                  </a>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <!-- super favorites -->
        {#if yd.super_favorites?.length}
          <div class="super-section">
            <h3 class="section-label">⭐ Super Favoritos</h3>
            <div class="super-list">
              {#each yd.super_favorites.slice(0,6) as meme}
                <a href={meme.url} target="_blank" rel="noopener noreferrer" class="super-item" title={formatDate(meme.reviewed_at)}>
                  <div class="super-thumb" style="background:{PLATFORM_META[getPlatform(meme.url)]?.color}">
                    {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                      <img src={meme.thumbnail_url} alt="" class="thumb-img" onerror={()=>handleImageError(meme.id)} />
                    {:else}
                      <span class="thumb-emoji">{PLATFORM_META[getPlatform(meme.url)]?.emoji}</span>
                    {/if}
                    <span class="super-star">⭐</span>
                  </div>
                </a>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </div>
{/if}

<style>
  .page {
    max-width: 860px;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .card {
    background: var(--bg-card);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 1.5rem;
  }

  .empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-muted);
  }
  .empty.error { color: #ff6b6b; }

  /* ── HERO ── */
  .hero {
    display: flex;
    align-items: center;
    gap: 2rem;
    flex-wrap: wrap;
  }

  .hero-stat {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex-shrink: 0;
  }

  .stat-num {
    font-size: 2.4rem;
    font-weight: 900;
    color: var(--text);
    line-height: 1;
  }
  .stat-unit { font-size: 1.4rem; }

  .stat-label {
    font-size: 0.72rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .hero-divider {
    width: 1px;
    height: 48px;
    background: rgba(255,255,255,0.08);
    flex-shrink: 0;
  }

  .platforms {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    flex: 1;
  }

  .plat-pill {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--bg-input);
    border-radius: 99px;
    padding: 0.3rem 0.75rem;
    font-size: 0.82rem;
  }
  .plat-n    { font-weight: 700; color: var(--text); }
  .plat-name { color: var(--text-muted); font-size: 0.75rem; }

  /* ── YEAR BLOCK ── */
  .year-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .year-title {
    font-size: 2rem;
    font-weight: 900;
    color: var(--accent);
    margin: 0;
  }

  .year-meta { display: flex; gap: 0.5rem; flex-wrap: wrap; }

  .chip {
    font-size: 0.75rem;
    padding: 0.25rem 0.65rem;
    border-radius: 99px;
    background: var(--bg-input);
    color: var(--text-muted);
  }
  .chip-gold { background: rgba(255,215,0,0.12); color: #ffd700; }

  /* ── HEATMAP ── */
  .heatmap-section { margin-bottom: 1.5rem; }

  .heatmap-scroll {
    overflow-x: auto;
    padding-bottom: 0.5rem;
  }

  .cal-months {
    display: flex;
    gap: 2px;
    padding-left: 24px;
    margin-bottom: 3px;
    min-width: max-content;
  }

  .cal-month-lbl {
    width: 10px;
    font-size: 0.58rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: visible;
  }

  .cal-body {
    display: flex;
    gap: 4px;
    min-width: max-content;
  }

  .cal-days {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 20px;
    flex-shrink: 0;
  }

  .cal-day {
    height: 10px;
    font-size: 0.55rem;
    color: var(--text-muted);
    line-height: 10px;
  }

  .cal-grid {
    display: flex;
    gap: 2px;
  }

  .cal-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cal-cell {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  .cal-legend {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 0.6rem;
    font-size: 0.62rem;
    color: var(--text-muted);
  }

  /* ── RANKING GRID ── */
  .section-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 0 0 0.75rem;
  }

  .ranking-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }

  @media (max-width: 560px) {
    .ranking-grid { grid-template-columns: 1fr; }
    .hero { flex-direction: column; align-items: flex-start; gap: 1rem; }
    .hero-divider { width: 100%; height: 1px; }
  }

  .meme-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .meme-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    text-decoration: none;
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  .meme-top {
    background: rgba(102,126,234,0.06);
    border-color: rgba(102,126,234,0.15);
  }
  .meme-top:hover {
    background: rgba(102,126,234,0.12);
    border-color: rgba(102,126,234,0.3);
  }

  .meme-bottom {
    background: rgba(233,69,96,0.06);
    border-color: rgba(233,69,96,0.15);
  }
  .meme-bottom:hover {
    background: rgba(233,69,96,0.12);
    border-color: rgba(233,69,96,0.3);
  }

  .medal {
    font-size: 1.2rem;
    width: 28px;
    text-align: center;
    flex-shrink: 0;
  }
  .medal-bottom {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text-muted);
  }

  .thumb {
    width: 48px;
    height: 48px;
    border-radius: 6px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    overflow: hidden;
    position: relative;
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-emoji {
    filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5));
  }

  .meme-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .meme-score {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1;
  }
  .score-star { font-size: 0.85rem; }

  .meme-pct {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  /* ── SUPER FAVORITES ── */
  .super-section {
    padding-top: 1rem;
    border-top: 1px solid rgba(255,255,255,0.06);
  }

  .super-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .super-item {
    text-decoration: none;
  }

  .super-thumb {
    width: 56px;
    height: 56px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    overflow: hidden;
    position: relative;
    transition: transform 0.15s;
    border: 2px solid rgba(255,215,0,0.3);
  }

  .super-thumb:hover { transform: scale(1.08); }

  .super-star {
    position: absolute;
    bottom: 1px;
    right: 2px;
    font-size: 0.65rem;
  }
</style>
