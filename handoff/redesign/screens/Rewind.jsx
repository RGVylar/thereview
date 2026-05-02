function RewindScreen() {
  const r = REWIND;
  const max = Math.max(...r.by_month);

  return (
    <div className="container-wide">
      {/* Hero */}
      <div className="glass-strong" style={{
        padding: '2.25rem',
        marginBottom: '1.5rem',
        background: 'linear-gradient(135deg, rgba(255,84,112,0.18), rgba(155,107,255,0.18), rgba(94,227,210,0.1))',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -60, right: -60, fontSize: '14rem', opacity: 0.08, fontWeight: 800, letterSpacing: '-0.08em' }}>
          {r.year}
        </div>
        <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>The Review · Rewind</div>
        <h1 style={{ fontSize: '3.25rem', fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1, marginBottom: '0.5rem' }}>
          Tu año en memes
        </h1>
        <p className="soft" style={{ fontSize: '1.05rem', maxWidth: 540 }}>
          {r.total} memes revisados en {r.sessions} sesiones. <strong>TikTok</strong> manda — pero hubo joyitas en cada plataforma.
        </p>

        <div style={{ display: 'flex', gap: '2rem', marginTop: '1.5rem' }}>
          <BigStat value={r.total}    label="memes revisados"/>
          <BigStat value={r.sessions} label="sesiones"/>
          <BigStat value="9.6"        label="mejor nota" accent/>
          <BigStat value="34h"        label="reviewing time" mono/>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
        {/* Monthly chart */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.25rem' }}>
            <div>
              <div className="eyebrow">Distribución mensual</div>
              <h3 className="h3" style={{ marginTop: '0.3rem' }}>Cuándo más reviewseaste</h3>
            </div>
            <span className="chip">📈 Pico en agosto</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', height: 180 }}>
            {r.by_month.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{
                    width: '100%',
                    height: `${(v/max)*100}%`,
                    background: `linear-gradient(180deg, rgba(255,84,112,${0.35 + (v/max)*0.55}), rgba(155,107,255,${0.2 + (v/max)*0.4}))`,
                    borderRadius: '8px 8px 4px 4px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2), 0 0 12px rgba(255,84,112,${(v/max)*0.3})`,
                    position: 'relative',
                    transition: 'all 0.2s',
                  }} title={`${r.monthsLabels[i]}: ${v}`}>
                    <span className="mono tabular" style={{
                      position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)',
                      fontSize: '0.65rem', color: 'var(--text-soft)', fontWeight: 600,
                    }}>{v}</span>
                  </div>
                </div>
                <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.monthsLabels[i]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Platform breakdown */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <div className="eyebrow">Por plataforma</div>
          <h3 className="h3" style={{ marginTop: '0.3rem', marginBottom: '1rem' }}>De dónde sacaste más</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {Object.entries(r.by_platform).map(([k, v]) => {
              const meta = PLATFORMS[k];
              const pct = Math.round((v / r.total) * 100);
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                  <PlatformBadge platform={k} size="sm"/>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{meta.label}</span>
                      <span className="mono tabular muted">{v} · {pct}%</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${meta.accent}, ${meta.accent}aa)`,
                        boxShadow: `0 0 8px ${meta.accent}80`,
                        borderRadius: 999,
                      }}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Podium */}
      <div className="glass" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <div className="eyebrow">Podio del año</div>
            <h3 className="h3" style={{ marginTop: '0.3rem' }}>Los mejores 3 memes de {r.year}</h3>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          {r.podium.map((p, i) => (
            <PodiumCard key={p.rank} podium={p} idx={i}/>
          ))}
        </div>
      </div>

      {/* Heatmap stripe */}
      <div className="glass" style={{ padding: '1.5rem' }}>
        <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Calendario de actividad</div>
        <h3 className="h3" style={{ marginBottom: '1rem' }}>Tu racha de memes en {r.year}</h3>
        <Heatmap/>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>Menos</span>
          {[0.07, 0.25, 0.5, 0.75, 1].map((o, i) => (
            <span key={i} style={{
              width: 14, height: 14, borderRadius: 4,
              background: `rgba(255,84,112,${o})`,
              border: '1px solid rgba(255,255,255,0.05)',
            }}/>
          ))}
          <span>Más</span>
        </div>
      </div>
    </div>
  );
}

function BigStat({ value, label, accent, mono }) {
  return (
    <div>
      <div className={mono ? 'mono tabular' : 'tabular'} style={{
        fontSize: '2.4rem', fontWeight: 800,
        letterSpacing: '-0.03em', lineHeight: 1,
        background: accent ? 'linear-gradient(135deg, var(--coral-bright), var(--gold))' : 'none',
        WebkitBackgroundClip: accent ? 'text' : 'border-box',
        WebkitTextFillColor: accent ? 'transparent' : 'inherit',
      }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>{label}</div>
    </div>
  );
}

function PodiumCard({ podium, idx }) {
  const medals = ['🥇', '🥈', '🥉'];
  const colors = ['#ffd166', '#cfd2d6', '#cd7f32'];
  return (
    <div style={{
      padding: '1.1rem',
      background: idx === 0
        ? 'linear-gradient(135deg, rgba(255,209,102,0.18), rgba(255,84,112,0.1))'
        : 'rgba(255,255,255,0.03)',
      border: `1px solid ${idx === 0 ? 'rgba(255,209,102,0.3)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 16,
      transform: idx === 0 ? 'translateY(-4px)' : 'none',
      transition: 'transform 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
        <span style={{ fontSize: '2.25rem' }}>{medals[idx]}</span>
        <span className="mono tabular" style={{
          fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em',
          color: colors[idx],
        }}>{podium.score}</span>
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 600, lineHeight: 1.35, marginBottom: '0.5rem' }}>
        {podium.title}
      </div>
      <div className="muted" style={{ fontSize: '0.75rem' }}>
        Review {podium.session}
      </div>
    </div>
  );
}

function Heatmap() {
  // Generate fake activity for 53 weeks × 7 days
  const cells = [];
  for (let w = 0; w < 53; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      // Cluster activity around Sundays evenings (review nights)
      const baseProb = d === 6 ? 0.6 : d === 5 ? 0.3 : 0.12;
      const r = Math.random();
      let level = 0;
      if (r < baseProb) {
        const v = Math.random();
        level = v > 0.85 ? 4 : v > 0.6 ? 3 : v > 0.3 ? 2 : 1;
      }
      week.push(level);
    }
    cells.push(week);
  }
  const opacity = [0.07, 0.25, 0.5, 0.75, 1];
  return (
    <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 4 }}>
      {cells.map((week, w) => (
        <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {week.map((level, d) => (
            <div key={d} style={{
              width: 12, height: 12, borderRadius: 3,
              background: `rgba(255,84,112,${opacity[level]})`,
              border: '1px solid rgba(255,255,255,0.04)',
              transition: 'transform 0.15s',
            }}/>
          ))}
        </div>
      ))}
    </div>
  );
}

window.RewindScreen = RewindScreen;
