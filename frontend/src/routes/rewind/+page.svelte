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
    tiktok:    { emoji: '🎵', name: 'TikTok',     color: 'linear-gradient(135deg,#000 0%,#25f4ee 100%)', accent: '#25f4ee' },
    twitter:   { emoji: '𝕏',  name: 'Twitter / X', color: 'linear-gradient(135deg,#1da1f2 0%,#0d8de0 100%)', accent: '#1da1f2' },
    instagram: { emoji: '📷', name: 'Instagram',   color: 'linear-gradient(135deg,#f09433 0%,#bc1888 100%)', accent: '#f09433' },
    youtube:   { emoji: '▶️', name: 'YouTube',     color: 'linear-gradient(135deg,#ff0000 0%,#cc0000 100%)', accent: '#ff4444' },
    otro:      { emoji: '🎬', name: 'Otros',        color: 'linear-gradient(135deg,#444 0%,#666 100%)', accent: '#888' },
  };

  function getPlatform(url) {
    if (url.includes('tiktok'))                          return 'tiktok';
    if (url.includes('twitter') || url.includes('x.com')) return 'twitter';
    if (url.includes('instagram'))                       return 'instagram';
    if (url.includes('youtube'))                         return 'youtube';
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
    const jan1  = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    const start = new Date(jan1);
    start.setDate(start.getDate() - ((jan1.getDay() + 6) % 7));
    const weeks = [];
    const cur = new Date(start);
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

  function buildMonthlyChart(memes) {
    const counts = new Array(12).fill(0);
    for (const m of memes) {
      const month = new Date(m.reviewed_at).getMonth();
      counts[month]++;
    }
    return counts;
  }

  function buildPlatformBreakdown(memes) {
    const map = {};
    for (const m of memes) {
      const p = getPlatform(m.url);
      map[p] = (map[p] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }

  function heatColor(count, maxCount, inYear) {
    if (!inYear)  return 'transparent';
    if (!count)   return 'rgba(255,84,112,0.07)';
    const t = count / maxCount;
    if (t < 0.25) return 'rgba(255,84,112,0.25)';
    if (t < 0.5)  return 'rgba(255,84,112,0.5)';
    if (t < 0.75) return 'rgba(255,84,112,0.75)';
    return '#ff5470';
  }

  function formatDate(s) {
    return new Date(s).toLocaleDateString('es-ES', { year:'numeric', month:'long', day:'numeric' });
  }

  function medalFor(idx) { return ['🥇','🥈','🥉'][idx] ?? `#${idx+1}`; }

  function peakMonth(byMonth) {
    const max = Math.max(...byMonth);
    if (!max) return '';
    const idx = byMonth.indexOf(max);
    return MONTHS[idx];
  }
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

    {#each Object.entries(rewindData.years).sort((a,b)=>+b[0]-+a[0]) as [year, yd]}
      {@const calData      = buildCalendarGrid(+year, yd.memes)}
      {@const byMonth      = buildMonthlyChart(yd.memes)}
      {@const maxMonth     = Math.max(...byMonth, 1)}
      {@const byPlatform   = buildPlatformBreakdown(yd.memes)}
      {@const voted        = yd.memes.filter(m => m.vote_count > 0)}
      {@const top3         = voted.slice(0, 3)}
      {@const bottom3      = [...voted].reverse().slice(0, 3)}
      {@const bestScore    = voted.length ? Math.max(...voted.map(m => m.avg_vote)).toFixed(1) : '—'}
      {@const topPlatform  = byPlatform[0]}

      <!-- ── YEAR HERO ── -->
      <div class="glass-strong year-hero">
        <!-- Year watermark -->
        <div class="year-watermark">{year}</div>

        <div class="eyebrow" style="margin-bottom:0.5rem">The Review · Rewind</div>
        <h1 class="hero-title">Tu año en memes</h1>
        <p class="hero-sub">
          <strong>{yd.count}</strong> memes revisados en {year}.
          {#if topPlatform}
            <strong>{PLATFORM_META[topPlatform[0]]?.name ?? topPlatform[0]}</strong> domina con {topPlatform[1]} memes.
          {/if}
        </p>

        <div class="hero-stats">
          <div class="big-stat">
            <div class="big-num">{yd.count}</div>
            <div class="big-label">memes revisados</div>
          </div>
          {#if yd.super_favorites?.length}
            <div class="big-stat">
              <div class="big-num big-num-gold">{yd.super_favorites.length}</div>
              <div class="big-label">super favs ⭐</div>
            </div>
          {/if}
          <div class="big-stat">
            <div class="big-num big-num-accent">{bestScore}</div>
            <div class="big-label">mejor nota</div>
          </div>
          <div class="big-stat">
            <div class="big-num big-num-mono">{byPlatform.length}</div>
            <div class="big-label">plataformas</div>
          </div>
        </div>
      </div>

      <!-- ── CHARTS ROW ── -->
      <div class="charts-row">

        <!-- Monthly bar chart -->
        <div class="glass chart-card">
          <div class="chart-header">
            <div>
              <div class="eyebrow">Distribución mensual</div>
              <h3 class="chart-title">Cuándo más reviewseaste</h3>
            </div>
            {#if peakMonth(byMonth)}
              <span class="chip">📈 Pico en {peakMonth(byMonth)}</span>
            {/if}
          </div>
          <div class="bar-chart">
            {#each byMonth as v, i}
              <div class="bar-col">
                <div class="bar-slot">
                  {#if v > 0}
                    <span class="bar-val">{v}</span>
                  {/if}
                  <div
                    class="bar-fill"
                    style="height:{Math.max(4, Math.round((v/maxMonth)*100))}%;opacity:{v > 0 ? 1 : 0}"
                    title="{MONTHS[i]}: {v} memes"
                  ></div>
                </div>
                <span class="bar-label">{MONTHS[i]}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Platform breakdown -->
        <div class="glass chart-card">
          <div class="eyebrow">Por plataforma</div>
          <h3 class="chart-title">De dónde sacaste más</h3>
          <div class="platform-list">
            {#each byPlatform as [platform, count]}
              {@const meta = PLATFORM_META[platform]}
              {@const pct  = Math.round((count / yd.count) * 100)}
              <div class="platform-row">
                <span class="plat-icon">{meta?.emoji ?? '🎬'}</span>
                <div class="plat-info">
                  <div class="plat-meta">
                    <span class="plat-name">{meta?.name ?? platform}</span>
                    <span class="plat-count">{count} · {pct}%</span>
                  </div>
                  <div class="plat-track">
                    <div
                      class="plat-fill"
                      style="width:{pct}%;background:linear-gradient(90deg,{meta?.accent ?? '#888'},{meta?.accent ?? '#888'}aa);box-shadow:0 0 8px {meta?.accent ?? '#888'}80"
                    ></div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- ── TOP & BOTTOM ── -->
      {#if top3.length || bottom3.length}
        <div class="glass chart-card">
          <div class="ranking-grid">
            {#if top3.length}
              <div class="ranking-col">
                <div class="eyebrow col-label">🏆 Top 3 del año</div>
                <div class="meme-list">
                  {#each top3 as meme, idx}
                    <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-row meme-top">
                      <span class="medal">{medalFor(idx)}</span>
                      <div class="thumb" style="background:{PLATFORM_META[getPlatform(meme.url)]?.color}">
                        {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                          <img src={meme.thumbnail_url} alt="" class="thumb-img" onerror={() => handleImageError(meme.id)} />
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

            {#if bottom3.length}
              <div class="ranking-col">
                <div class="eyebrow col-label">📉 Bottom 3</div>
                <div class="meme-list">
                  {#each bottom3 as meme, idx}
                    <a href={meme.url} target="_blank" rel="noopener noreferrer" class="meme-row meme-bottom">
                      <span class="medal medal-bottom">#{idx+1}</span>
                      <div class="thumb" style="background:{PLATFORM_META[getPlatform(meme.url)]?.color}">
                        {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                          <img src={meme.thumbnail_url} alt="" class="thumb-img" onerror={() => handleImageError(meme.id)} />
                        {:else}
                          <span class="thumb-emoji">{PLATFORM_META[getPlatform(meme.url)]?.emoji}</span>
                        {/if}
                      </div>
                      <div class="meme-info">
                        <span class="meme-score meme-score-low">{meme.avg_vote}<span class="score-star">⭐</span></span>
                        <span class="meme-pct">{meme.percentile ?? 0}%ile</span>
                      </div>
                    </a>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- ── ACTIVITY HEATMAP ── -->
      {#if calData.weeks.length}
        <div class="glass chart-card">
          <div class="eyebrow" style="margin-bottom:0.4rem">Calendario de actividad</div>
          <h3 class="chart-title" style="margin-bottom:1rem">Tu racha de memes en {year}</h3>
          <div class="heatmap-scroll">
            <div class="cal-months" style="padding-left:24px">
              {#each calData.weeks as _, col}
                {@const lbl = calData.monthLabels.find(m => m.col === col)}
                <div class="cal-month-lbl">{lbl?.label ?? ''}</div>
              {/each}
            </div>
            <div class="cal-body">
              <div class="cal-days">
                {#each DAYS as d, i}
                  <div class="cal-day">{i % 2 === 0 ? d : ''}</div>
                {/each}
              </div>
              <div class="cal-grid">
                {#each calData.weeks as week}
                  <div class="cal-col">
                    {#each week as day}
                      <div
                        class="cal-cell"
                        style="background:{heatColor(day.count, calData.maxCount, day.inYear)}"
                        title={day.inYear && day.count ? `${day.date}: ${day.count} meme${day.count !== 1 ? 's' : ''}` : ''}
                      ></div>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
            <div class="cal-legend">
              <span>Menos</span>
              {#each [0.07, 0.25, 0.5, 0.75, 1] as a}
                <div class="cal-cell" style="background:rgba(255,84,112,{a})"></div>
              {/each}
              <span>Más</span>
            </div>
          </div>
        </div>
      {/if}

      <!-- ── SUPER FAVORITES ── -->
      {#if yd.super_favorites?.length}
        <div class="glass chart-card">
          <div class="eyebrow col-label">⭐ Super Favoritos — todos votaron al máximo</div>
          <div class="super-list">
            {#each yd.super_favorites.slice(0, 8) as meme}
              <a href={meme.url} target="_blank" rel="noopener noreferrer" class="super-item" title={formatDate(meme.reviewed_at)}>
                <div class="super-thumb" style="background:{PLATFORM_META[getPlatform(meme.url)]?.color}">
                  {#if meme.thumbnail_url && !failedThumbnails.has(meme.id)}
                    <img src={meme.thumbnail_url} alt="" class="thumb-img" onerror={() => handleImageError(meme.id)} />
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

    {/each}
  </div>
{/if}

<style>
  .page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--text-muted);
  }
  .empty.error { color: #ff6b6b; }

  /* ── YEAR HERO ── */
  .year-hero {
    position: relative;
    overflow: hidden;
    padding: 2.25rem;
    background: linear-gradient(135deg,
      rgba(255,84,112,0.18),
      rgba(155,107,255,0.18),
      rgba(94,227,210,0.1)
    ) !important;
  }

  .year-watermark {
    position: absolute;
    top: -60px;
    right: -60px;
    font-size: 14rem;
    font-weight: 800;
    letter-spacing: -0.08em;
    opacity: 0.07;
    line-height: 1;
    pointer-events: none;
    color: var(--text);
    user-select: none;
  }

  .hero-title {
    font-size: clamp(2rem, 5vw, 3.25rem);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1;
    margin-bottom: 0.5rem;
  }
  .hero-sub {
    font-size: 1.05rem;
    color: var(--text-soft);
    max-width: 540px;
    margin-bottom: 1.5rem;
    line-height: 1.5;
  }
  .hero-stats {
    display: flex;
    gap: 2.5rem;
    flex-wrap: wrap;
  }
  .big-stat { display: flex; flex-direction: column; gap: 0.2rem; }
  .big-num {
    font-size: 2.4rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
    font-family: var(--font-mono);
  }
  .big-num-accent {
    background: linear-gradient(135deg, var(--coral-bright), var(--gold));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .big-num-gold { color: var(--gold); }
  .big-num-mono { color: var(--teal); }
  .big-label {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin-top: 0.1rem;
  }

  /* ── CHARTS ROW ── */
  .charts-row {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 1.25rem;
  }
  @media (max-width: 700px) {
    .charts-row { grid-template-columns: 1fr; }
    .hero-stats { gap: 1.5rem; }
    .year-watermark { font-size: 8rem; }
  }

  .chart-card { padding: 1.5rem; }

  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 1.25rem;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .chart-title {
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin-top: 0.3rem;
  }

  /* ── BAR CHART ── */
  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    height: 180px;
    padding-top: 1.5rem; /* space for bar-val labels */
  }
  .bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    height: 100%;
  }
  .bar-slot {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    position: relative;
  }
  .bar-val {
    position: absolute;
    top: -16px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.6rem;
    font-weight: 600;
    color: var(--text-soft);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .bar-fill {
    width: 100%;
    min-height: 4px;
    background: linear-gradient(180deg,
      rgba(255,84,112,0.85),
      rgba(155,107,255,0.6)
    );
    border-radius: 6px 6px 3px 3px;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
    transition: height 0.3s ease;
  }
  .bar-label {
    font-size: 0.62rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  /* ── PLATFORM BREAKDOWN ── */
  .platform-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.85rem;
  }
  .platform-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .plat-icon { font-size: 1.25rem; flex-shrink: 0; width: 28px; text-align: center; }
  .plat-info { flex: 1; }
  .plat-meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    margin-bottom: 4px;
  }
  .plat-name { font-weight: 600; color: var(--text); }
  .plat-count { color: var(--text-muted); font-family: var(--font-mono); }
  .plat-track {
    height: 6px;
    background: rgba(255,255,255,0.06);
    border-radius: 999px;
    overflow: hidden;
  }
  .plat-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.6s ease;
  }

  /* ── RANKING ── */
  .ranking-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 560px) { .ranking-grid { grid-template-columns: 1fr; } }

  .col-label {
    font-size: 0.68rem;
    margin-bottom: 0.75rem;
    display: block;
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
    border-radius: 10px;
    text-decoration: none;
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }
  .meme-top    { background: rgba(255,209,102,0.06); border-color: rgba(255,209,102,0.18); }
  .meme-top:hover { background: rgba(255,209,102,0.12); border-color: rgba(255,209,102,0.32); }
  .meme-bottom { background: rgba(255,84,112,0.06); border-color: rgba(255,84,112,0.15); }
  .meme-bottom:hover { background: rgba(255,84,112,0.12); border-color: rgba(255,84,112,0.3); }

  .medal { font-size: 1.2rem; width: 28px; text-align: center; flex-shrink: 0; }
  .medal-bottom { font-size: 0.8rem; font-weight: 700; color: var(--text-muted); }

  .thumb {
    width: 48px; height: 48px;
    border-radius: 8px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.4rem;
    overflow: hidden;
  }
  .thumb-img { width: 100%; height: 100%; object-fit: cover; }
  .thumb-emoji { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)); }

  .meme-info { display: flex; flex-direction: column; gap: 0.1rem; }
  .meme-score { font-size: 1.1rem; font-weight: 700; color: var(--text); line-height: 1; }
  .meme-score-low { color: var(--coral-bright); }
  .score-star { font-size: 0.85rem; }
  .meme-pct { font-size: 0.7rem; color: var(--text-muted); }

  /* ── HEATMAP ── */
  .heatmap-scroll { overflow-x: auto; padding-bottom: 0.5rem; }

  .cal-months {
    display: flex;
    gap: 2px;
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
  .cal-body { display: flex; gap: 4px; min-width: max-content; }
  .cal-days {
    display: flex; flex-direction: column;
    gap: 2px; width: 20px; flex-shrink: 0;
  }
  .cal-day { height: 10px; font-size: 0.55rem; color: var(--text-muted); line-height: 10px; }
  .cal-grid { display: flex; gap: 2px; }
  .cal-col { display: flex; flex-direction: column; gap: 2px; }
  .cal-cell { width: 10px; height: 10px; border-radius: 2px; }
  .cal-legend {
    display: flex; align-items: center; gap: 3px;
    margin-top: 0.6rem; font-size: 0.62rem; color: var(--text-muted);
  }

  /* ── SUPER FAVORITES ── */
  .super-list { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.75rem; }
  .super-item { text-decoration: none; }
  .super-thumb {
    width: 56px; height: 56px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.4rem; overflow: hidden;
    position: relative;
    transition: transform 0.15s;
    border: 2px solid rgba(255,215,0,0.3);
  }
  .super-thumb:hover { transform: scale(1.08); }
  .super-star { position: absolute; bottom: 1px; right: 2px; font-size: 0.65rem; }

  /* ── CHIPS ── */
  .chip {
    font-size: 0.75rem;
    padding: 0.25rem 0.65rem;
    border-radius: 99px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    color: var(--text-muted);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: inline-flex;
    align-items: center;
  }
</style>
