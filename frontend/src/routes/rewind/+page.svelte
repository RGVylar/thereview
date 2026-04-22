<script>
  import { auth } from '$lib/auth.js';
  import { api } from '$lib/api.js';

  let rewindData = $state(null);
  let error = $state(null);
  let authVal = $state(null);
  let isLoading = $state(true);

  auth.subscribe((v) => (authVal = v));

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
      rewindData = { years: {} };
      isLoading = false;
    }
  }

  $effect(() => {
    if (authVal?.token) {
      loadRewindData();
    }
  });

  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  function getHeatmapColor(count, maxCount) {
    if (count === 0) return '#eaeaea';
    const intensity = count / maxCount;
    if (intensity < 0.25) return '#c6e48b';
    if (intensity < 0.5) return '#7bc96f';
    if (intensity < 0.75) return '#239a3b';
    return '#0d3a1f';
  }

  function buildCalendarHeatmap(yearData) {
    if (!yearData?.memes) return { dateMap: {}, maxCount: 0 };

    const dateMap = {};
    let maxCount = 0;

    yearData.memes.forEach(meme => {
      const date = new Date(meme.reviewed_at).toISOString().split('T')[0];
      dateMap[date] = (dateMap[date] || 0) + 1;
      maxCount = Math.max(maxCount, dateMap[date]);
    });

    return { dateMap, maxCount };
  }

  function getAllDatesInYear(year) {
    const dates = [];
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }

  function getWeeksInYear(year) {
    const weeks = [];
    const allDates = getAllDatesInYear(year);

    for (let i = 0; i < allDates.length; i += 7) {
      weeks.push(allDates.slice(i, i + 7));
    }
    return weeks;
  }
</script>

<svelte:head>
  <title>Rewind - The Review</title>
</svelte:head>

{#if !authVal?.token}
  <div class="container">
    <p class="text-center">Please log in to view your rewind.</p>
  </div>
{:else if isLoading}
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

    {#each Object.entries(rewindData.years).sort((a, b) => parseInt(b[0]) - parseInt(a[0])) as [year, yearData] (year)}
      <div class="year-section">
        <div class="year-header">
          <h2>{year}</h2>
          <div class="year-stats">
            <span class="stat-badge">{yearData.count} memes reviewed</span>
          </div>
        </div>

        <!-- Calendar Heatmap -->
        <div class="calendar-container">
          <div class="calendar-title">Review Activity</div>
          <div class="heatmap-calendar">
            {#each getWeeksInYear(parseInt(year)) as week}
              <div class="week">
                {#each week as date}
                  {@const count = buildCalendarHeatmap(yearData).dateMap[date] || 0}
                  {@const maxCount = buildCalendarHeatmap(yearData).maxCount}
                  <div
                    class="day-cell"
                    style="background-color: {getHeatmapColor(count, maxCount)}"
                    title="{date}: {count} meme{count !== 1 ? 's' : ''}"
                  >
                    {#if count > 0}
                      <span class="count">{count}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        </div>

        <!-- Top 3 Memes -->
        {#if yearData.best_meme}
          <div class="highlights-section">
            <h3>🏆 Top 3 Memes</h3>
            <div class="highlights-grid">
              {#each yearData.memes.slice(0, 3) as meme, idx}
                <a href={meme.url} target="_blank" rel="noopener noreferrer" class="highlight-item top">
                  <div class="rank-badge">#{idx + 1}</div>
                  <div class="meme-info">
                    <div class="vote-score">{meme.avg_vote}⭐</div>
                    <div class="vote-details">{meme.vote_count} votes</div>
                    <div class="meme-date">{formatDate(meme.reviewed_at)}</div>
                  </div>
                </a>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Bottom 3 Memes -->
        {#if yearData.worst_meme}
          <div class="highlights-section">
            <h3>📉 Bottom 3 Memes</h3>
            <div class="highlights-grid">
              {#each [...yearData.memes].reverse().slice(0, 3) as meme, idx}
                <a href={meme.url} target="_blank" rel="noopener noreferrer" class="highlight-item bottom">
                  <div class="rank-badge">#{idx + 1}</div>
                  <div class="meme-info">
                    <div class="vote-score">{meme.avg_vote}⭐</div>
                    <div class="vote-details">{meme.vote_count} votes</div>
                    <div class="meme-date">{formatDate(meme.reviewed_at)}</div>
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

  .calendar-container {
    margin-bottom: 3rem;
    padding: 1.5rem;
    background: #f8f9fa;
    border-radius: 0.75rem;
  }

  .calendar-title {
    font-weight: 700;
    margin-bottom: 1rem;
    color: #333;
    font-size: 0.95rem;
  }

  .heatmap-calendar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
  }

  .week {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .day-cell {
    aspect-ratio: 1;
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 0.75rem;
    font-weight: 600;
    color: #333;
    border: 1px solid #ddd;
  }

  .day-cell:hover {
    transform: scale(1.1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .count {
    display: inline-block;
  }

  .highlights-section {
    margin-bottom: 2rem;
  }

  .highlights-section h3 {
    margin: 0 0 1rem 0;
    color: #333;
    font-size: 1.1rem;
  }

  .highlights-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .highlight-item {
    position: relative;
    padding: 1.5rem;
    border-radius: 0.75rem;
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 1rem;
    transition: all 0.2s ease;
    border: 2px solid;
  }

  .highlight-item.top {
    background: linear-gradient(135deg, #fff9e6 0%, #fffde7 100%);
    border-color: #ffd700;
  }

  .highlight-item.bottom {
    background: linear-gradient(135deg, #ffe0e0 0%, #ffcccc 100%);
    border-color: #ff6b6b;
  }

  .highlight-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
  }

  .rank-badge {
    min-width: 60px;
    height: 60px;
    border-radius: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1.3rem;
    flex-shrink: 0;
  }

  .highlight-item.top .rank-badge {
    background: #ffd700;
    color: #333;
  }

  .highlight-item.bottom .rank-badge {
    background: #ff6b6b;
    color: white;
  }

  .meme-info {
    flex: 1;
  }

  .vote-score {
    font-size: 1.3rem;
    font-weight: 700;
    color: #333;
  }

  .vote-details {
    font-size: 0.85rem;
    color: #666;
    margin-top: 0.25rem;
  }

  .meme-date {
    font-size: 0.8rem;
    color: #999;
    margin-top: 0.25rem;
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

    .heatmap-calendar {
      grid-template-columns: 1fr;
    }

    .highlights-grid {
      grid-template-columns: 1fr;
    }

    .highlight-item {
      flex-direction: column;
      text-align: center;
    }
  }
</style>
