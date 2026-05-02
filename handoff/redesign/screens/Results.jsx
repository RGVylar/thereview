function ResultsScreen({ onBack }) {
  const r = FINISHED_SESSION;
  const [tab, setTab] = React.useState('top');

  return (
    <div className="scroll-area">
      <div className="container-wide">
        {/* Hero */}
        <div className="glass-strong" style={{
          padding: '2rem 2.25rem',
          marginBottom: '1.25rem',
          background: 'linear-gradient(135deg, rgba(255,209,102,0.15), rgba(255,84,112,0.12), rgba(155,107,255,0.1))',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: -50, right: -30, fontSize: '11rem', opacity: 0.07, fontWeight: 800 }}>🏆</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
            <button className="btn btn-ghost btn-icon" onClick={onBack}><Icon name="chevL" size={16}/></button>
            <span className="eyebrow">Sesión terminada</span>
            <span className="chip chip-violet" style={{ fontSize: '0.7rem' }}>✓ FINISHED</span>
          </div>
          <h1 className="h1" style={{ fontSize: '2.5rem' }}>{r.name}</h1>
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            {new Date(r.finished_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })} · duró {r.duration}
          </p>

          <div style={{ display: 'flex', gap: '2.25rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <Stat value={r.total_memes} label="memes revisados"/>
            <Stat value={r.avg_score.toFixed(1)} label="nota media" mono accent/>
            <Stat value={r.super_favs} label="super favs ⭐"/>
            <Stat value={r.participants.length} label="participantes"/>
            <div>
              <div className="eyebrow" style={{ fontSize: '0.62rem', marginBottom: '0.4rem' }}>Crew</div>
              <AvatarStack users={r.participants} size="md"/>
            </div>
          </div>
        </div>

        {/* Winner spotlight */}
        <div className="glass-strong" style={{
          padding: '1.75rem',
          marginBottom: '1.25rem',
          background: 'linear-gradient(135deg, rgba(255,209,102,0.2), rgba(255,84,112,0.08))',
          border: '1px solid rgba(255,209,102,0.35)',
          display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: '1.5rem', alignItems: 'center',
        }}>
          <div style={{
            aspectRatio: '9/16', maxHeight: 200,
            borderRadius: 16,
            background: `linear-gradient(135deg, ${PLATFORMS.tiktok.accent}33, ${PLATFORMS.tiktok.accent}11), radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1), transparent 60%)`,
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', overflow: 'hidden',
          }}>
            <span style={{ fontSize: '3rem', opacity: 0.4, color: PLATFORMS.tiktok.accent }}>♪</span>
            <div style={{ position: 'absolute', top: 8, left: 8 }}><PlatformBadge platform="tiktok" size="sm"/></div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.4rem' }}>🥇</span>
              <span className="eyebrow" style={{ color: 'var(--gold)' }}>Ganador del mes</span>
            </div>
            <h2 className="h2" style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>{r.top[0].title}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '0.85rem', color: 'var(--text-soft)', flexWrap: 'wrap' }}>
              <span style={{ color: PLATFORMS.tiktok.accent, fontWeight: 600 }}>{r.top[0].uploader}</span>
              <span>·</span>
              <span>añadido por <Avatar user={r.top[0].added_by} size="sm" style={{ marginLeft: 4, marginRight: 4 }}/> <strong>{r.top[0].added_by.name}</strong></span>
              <span>·</span>
              <span className="chip chip-coral">unanimidad casi total</span>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="mono tabular" style={{
              fontSize: '4.5rem', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em',
              background: 'linear-gradient(135deg, var(--gold), var(--coral-bright))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>{r.top[0].avg.toFixed(1)}</div>
            <div className="eyebrow" style={{ fontSize: '0.65rem', marginTop: '0.3rem' }}>nota media · {r.participants.length} votos</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <ResultTab active={tab === 'top'}     onClick={() => setTab('top')}     icon="🏆" label={`Top 5`}/>
          <ResultTab active={tab === 'bottom'}  onClick={() => setTab('bottom')}  icon="👎" label={`Bottom 3`}/>
          <ResultTab active={tab === 'players'} onClick={() => setTab('players')} icon="👥" label="Por jugador"/>
        </div>

        {tab === 'top' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {r.top.map(item => <RankRow key={item.rank} item={item} participants={r.participants} flavor="top"/>)}
          </div>
        )}

        {tab === 'bottom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {r.bottom.map(item => <RankRow key={item.rank} item={item} participants={r.participants} flavor="bottom"/>)}
          </div>
        )}

        {tab === 'players' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            {r.by_user.map(u => <PlayerCard key={u.user.id} entry={u}/>)}
          </div>
        )}

        {/* Heatmap — siempre visible al final */}
        <Heatmap session={r}/>
      </div>
    </div>
  );
}

function Heatmap({ session }) {
  const votes = session.all_votes;
  const total = votes.length;
  const median = [...votes].sort((a,b) => a-b)[Math.floor(total/2)];

  // Each vote becomes a vertical tick. Position 0..1 across the bar.
  // 0 = peor (left), 10 = mejor (right). Slight horizontal jitter so duplicates don't perfectly stack.
  const ticks = votes.map((v, i) => {
    const seed = (i * 9301 + 49297) % 233280;
    const jitter = (seed / 233280 - 0.5) * 0.04;
    return Math.max(0, Math.min(1, v / 10 + jitter));
  });

  return (
    <div className="glass" style={{ padding: '1.2rem 1.4rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.85rem' }}>
        <span style={{ fontSize: '1rem' }}>🌡️</span>
        <h3 className="h3" style={{ fontSize: '1.05rem' }}>Resultados</h3>
        <span className="muted" style={{ fontSize: '0.78rem' }}>{total} votos · dónde cayeron</span>
      </div>

      {/* Density bar with end labels */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center', gap: '0.85rem',
      }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--coral-bright)' }}>💀 Peor</span>

        <div style={{
          position: 'relative',
          height: 64,
          borderRadius: 12,
          background: 'linear-gradient(90deg, rgba(255,84,112,0.18) 0%, rgba(255,209,102,0.10) 50%, rgba(94,227,210,0.18) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}>
          {/* Subtle vertical grid every 10% (each integer score) */}
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${i * 10}%`, width: 1,
              background: i === 5 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
            }}/>
          ))}

          {/* Vote ticks */}
          {ticks.map((p, i) => {
            const v = votes[i];
            const color =
              v <= 3 ? 'var(--coral-bright)' :
              v <= 6 ? '#7ab8ff' :
              v <= 8 ? '#9ab9ff' :
              '#5ee3d2';
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `${p * 100}%`,
                top: '15%', bottom: '15%',
                width: 2,
                background: color,
                opacity: 0.85,
                transform: 'translateX(-50%)',
                boxShadow: `0 0 4px ${color}`,
              }}/>
            );
          })}

          {/* Median marker */}
          <div style={{
            position: 'absolute',
            left: `${(median/10) * 100}%`,
            top: -4, bottom: -4, width: 3,
            background: 'var(--gold)',
            boxShadow: '0 0 8px rgba(255,209,102,0.8)',
            transform: 'translateX(-50%)',
            borderRadius: 2,
          }}/>
          <div style={{
            position: 'absolute', top: -18,
            left: `${(median/10) * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: '0.62rem', fontWeight: 700,
            color: 'var(--gold)',
            fontFamily: 'var(--font-mono)',
          }}>{median}</div>
        </div>

        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--teal)' }}>🏆 Mejor</span>
      </div>

      {/* Reactions summary */}
      {session.reactions && Object.keys(session.reactions).length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem',
          marginTop: '1rem', paddingTop: '0.85rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span className="eyebrow" style={{ fontSize: '0.62rem' }}>Reacciones</span>
          {Object.entries(session.reactions).sort((a, b) => b[1] - a[1]).map(([emoji, count]) => (
            <span key={emoji} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 9px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 999,
              fontSize: '0.85rem',
            }}>
              {emoji}
              <strong className="mono tabular" style={{ fontSize: '0.72rem', color: 'var(--coral-bright)' }}>{count}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, mono, accent }) {
  return (
    <div>
      <div className={mono ? 'mono tabular' : 'tabular'} style={{
        fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1,
        background: accent ? 'linear-gradient(135deg, var(--coral-bright), var(--gold))' : 'none',
        WebkitBackgroundClip: accent ? 'text' : 'border-box',
        WebkitTextFillColor: accent ? 'transparent' : 'inherit',
      }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{label}</div>
    </div>
  );
}

function ResultTab({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} style={{
      padding: '0.65rem 1.1rem',
      borderRadius: 999,
      background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
      border: `1px solid ${active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
      color: active ? 'var(--text)' : 'var(--text-soft)',
      fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
    }}>
      <span>{icon}</span> {label}
    </button>
  );
}

function RankRow({ item, participants, flavor }) {
  const meta = PLATFORMS[item.platform];
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const isPodium = item.rank <= 3 && flavor === 'top';
  return (
    <div className="glass" style={{
      padding: '0.85rem 1rem',
      display: 'grid',
      gridTemplateColumns: '60px 50px 1fr auto auto',
      gap: '1rem', alignItems: 'center',
      background: isPodium ? 'linear-gradient(90deg, rgba(255,209,102,0.08), transparent 50%)' : undefined,
      border: isPodium ? '1px solid rgba(255,209,102,0.25)' : undefined,
    }}>
      {/* Rank */}
      <div style={{ textAlign: 'center' }}>
        {medals[item.rank] ? (
          <span style={{ fontSize: '1.6rem' }}>{medals[item.rank]}</span>
        ) : (
          <span className="mono tabular" style={{ fontSize: '1.1rem', color: 'var(--text-muted)', fontWeight: 700 }}>#{item.rank}</span>
        )}
      </div>

      {/* Platform thumb */}
      <div style={{
        width: 50, height: 50, borderRadius: 10,
        background: `linear-gradient(135deg, ${meta.accent}33, ${meta.accent}11)`,
        border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: meta.accent, fontSize: '1.3rem',
      }}>{meta.glyph}</div>

      {/* Title */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 600, lineHeight: 1.3, marginBottom: '0.2rem',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span style={{ color: meta.accent }}>{item.uploader}</span>
          <span>·</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Avatar user={item.added_by} size="sm"/> {item.added_by.name}
          </span>
          {item.playoff && <span className="chip chip-coral" style={{ fontSize: '0.65rem' }}>⚔️ playoff</span>}
        </div>
      </div>

      {/* Per-user vote chips */}
      <div style={{ display: 'flex', gap: 4 }}>
        {participants.map(p => {
          const v = item.votes[p.id];
          const high = v >= 9, low = v <= 3;
          return (
            <div key={p.id} style={{
              width: 34, height: 34, borderRadius: 8,
              background: high ? 'rgba(94,227,210,0.15)' : low ? 'rgba(255,84,112,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${high ? 'rgba(94,227,210,0.35)' : low ? 'rgba(255,84,112,0.35)' : 'rgba(255,255,255,0.08)'}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', position: 'relative',
            }} title={`${p.name}: ${v}`}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: high ? 'var(--teal)' : low ? 'var(--coral-bright)' : 'var(--text)' }}>{v}</span>
              <span style={{ position: 'absolute', bottom: -3, right: -3, width: 10, height: 10, borderRadius: '50%', background: p.color, border: '2px solid #1a0a2a' }}/>
            </div>
          );
        })}
      </div>

      {/* Avg score */}
      <div style={{ textAlign: 'right', minWidth: 70 }}>
        <div className="mono tabular" style={{
          fontSize: '1.65rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
          color: flavor === 'top' ? 'var(--gold)' : 'var(--coral-bright)',
        }}>{item.avg.toFixed(1)}</div>
        <div className="eyebrow" style={{ fontSize: '0.58rem', marginTop: '0.2rem' }}>nota</div>
      </div>
    </div>
  );
}

function PlayerCard({ entry }) {
  const u = entry.user;
  return (
    <div className="glass" style={{ padding: '1.1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <Avatar user={u} size="lg" ring/>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{u.name}</div>
          <div className="muted" style={{ fontSize: '0.78rem' }}>@{u.username}</div>
        </div>
        {entry.harshest && <span className="chip chip-coral" style={{ fontSize: '0.68rem' }}>😈 más duro</span>}
        {entry.kindest && <span className="chip chip-teal" style={{ fontSize: '0.68rem' }}>😇 más blando</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
        <Mini label="Memes aportados" value={entry.submitted}/>
        <Mini label="Nota media dada" value={entry.avg_given.toFixed(1)} mono/>
        <Mini label="En top 5" value={entry.in_top5} accent="#ffd166"/>
        <Mini label="En bottom 3" value={entry.in_bottom3} accent="#ff5470"/>
      </div>
    </div>
  );
}

function Mini({ label, value, mono, accent }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.6rem 0.75rem' }}>
      <div className="eyebrow" style={{ fontSize: '0.58rem' }}>{label}</div>
      <div className={mono ? 'mono tabular' : 'tabular'} style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em', color: accent || 'var(--text)', marginTop: '0.15rem' }}>{value}</div>
    </div>
  );
}

window.ResultsScreen = ResultsScreen;
