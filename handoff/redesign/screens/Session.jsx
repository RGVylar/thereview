function SessionScreen({ onBack }) {
  const s = ACTIVE_SESSION;
  const [vote, setVote] = React.useState(null);
  const [playing, setPlaying] = React.useState(true);
  const [muted, setMuted] = React.useState(false);
  const [showNotepad, setShowNotepad] = React.useState(true);
  const [notepad, setNotepad] = React.useState(s.notepad);
  const [progress, setProgress] = React.useState(0.34);
  const [reactions, setReactions] = React.useState({});
  const [floaters, setFloaters] = React.useState([]);
  const REACTION_EMOJIS = ['🔔','🎉','💩','👋','🍿','💀','🐒'];

  function fireReaction(emoji) {
    setReactions(r => ({ ...r, [emoji]: (r[emoji] || 0) + 1 }));
    const id = Date.now() + Math.random();
    const x = 10 + Math.random() * 80;
    setFloaters(f => [...f, { id, emoji, x }]);
    setTimeout(() => setFloaters(f => f.filter(e => e.id !== id)), 1800);
  }

  // Animated playback progress
  React.useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setProgress(p => (p + 0.005) % 1), 100);
    return () => clearInterval(i);
  }, [playing]);

  const meme = s.current_meme;
  const platMeta = PLATFORMS[meme.platform];

  return (
    <div style={{
      flex: 1, display: 'grid',
      gridTemplateColumns: showNotepad ? '1fr 380px' : '1fr',
      gap: '1.25rem',
      padding: '1.25rem 1.5rem',
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* ── Main video area ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
        {/* Top header bar */}
        <div className="glass" style={{
          padding: '0.85rem 1.1rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
        }}>
          <button className="btn btn-ghost btn-icon" onClick={onBack}><Icon name="chevL" size={18}/></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{s.name}</h2>
              <span className="chip chip-teal">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', boxShadow: '0 0 8px var(--teal)' }}/>
                LIVE
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '0.2rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <span><Icon name="clock" size={11}/> {s.elapsed}</span>
              <span>·</span>
              <span className="mono tabular">{s.current_index} / {s.total}</span>
              <span>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AvatarStack users={s.participants} size="sm"/>
                {s.participants.length} viendo
              </span>
            </div>
          </div>

          {/* Session progress bar */}
          <div style={{ width: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: 4 }}>
              <span className="muted">Sesión</span>
              <span className="mono tabular soft">{Math.round(s.current_index/s.total*100)}%</span>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                width: `${(s.current_index/s.total)*100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #5ee3d2, #9b6bff)',
                borderRadius: 999,
              }}/>
            </div>
          </div>

          <button className="btn btn-glass" onClick={() => setShowNotepad(!showNotepad)}>
            <Icon name="notepad" size={14}/> Notepad
          </button>
        </div>

        {/* Video stage */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, position: 'relative' }}>
          <VideoStage meme={meme} platMeta={platMeta} progress={progress} cursors={s.cursors} muted={muted}/>
        </div>

        {/* Bottom HUD: meta · vote · controls */}
        <div className="glass-strong" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Row 1: title + meta */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
            <PlatformBadge platform={meme.platform}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{meme.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <span style={{ color: platMeta.accent, fontWeight: 600 }}>{meme.uploader}</span>
                <span className="mono tabular">👁 {meme.views}</span>
                <span className="mono tabular">♥ {meme.likes}</span>
                <span className="mono tabular">💬 {meme.comments}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="chip" style={{ background: 'rgba(255,255,255,0.05)' }}>
                añadido por <Avatar user={meme.added_by} size="sm" style={{ marginLeft: 4, marginRight: 2 }}/> {meme.added_by.name}
              </span>
              {meme.dup && <span className="chip chip-coral">×{meme.dup} duplicados</span>}
            </div>
          </div>

          {/* Row 2: vote slider */}
          <VoteSlider vote={vote} setVote={setVote} usedTicks={s.votes_used} otherVoted={s.others_voted} participants={s.participants}/>

          {/* Row 3: transport */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="btn btn-glass"><Icon name="prev" size={16}/> Anterior</button>
            <button className="btn btn-icon btn-glass" onClick={() => setPlaying(!playing)} style={{ width: 44, height: 44 }}>
              <Icon name={playing ? 'pause' : 'play'} size={18}/>
            </button>
            <button className="btn btn-icon btn-glass" onClick={() => setMuted(!muted)} style={{ width: 44, height: 44 }}>
              <Icon name={muted ? 'mute' : 'unmute'} size={16}/>
            </button>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0 0.5rem' }}>
              <span className="mono tabular" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {Math.floor(progress * meme.duration)}s
              </span>
              <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 999, position: 'relative', cursor: 'pointer' }}>
                <div style={{
                  width: `${progress * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--coral), var(--coral-bright))',
                  borderRadius: 999,
                  boxShadow: '0 0 10px rgba(255,84,112,0.6)',
                }}/>
                <div style={{
                  position: 'absolute', left: `${progress * 100}%`, top: '50%',
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#fff', transform: 'translate(-50%,-50%)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                }}/>
              </div>
              <span className="mono tabular" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{meme.duration}s</span>
            </div>

            <button className="btn btn-primary" disabled={vote === null}>
              Siguiente <Icon name="next" size={14}/>
            </button>
          </div>
        </div>
      </div>

      {/* ── Sidebar: participants + notepad + super-fav ── */}
      {showNotepad && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
          <ParticipantsCard participants={s.participants} otherVoted={s.others_voted}/>
          <ReactionsCard emojis={REACTION_EMOJIS} counts={reactions} onTap={fireReaction}/>
          <NotepadCard value={notepad} onChange={setNotepad}/>
          <SuperFavCard meme={meme}/>
        </div>
      )}

      {/* Floating emoji overlay */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 50 }}>
        {floaters.map(fe => (
          <div key={fe.id} style={{
            position: 'absolute', bottom: '12%', left: `${fe.x}%`,
            fontSize: '2.5rem',
            animation: 'floatUp 1.8s ease-out forwards',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))',
          }}>{fe.emoji}</div>
        ))}
      </div>
    </div>
  );
}

function ReactionsCard({ emojis, counts, onTap }) {
  return (
    <div className="glass" style={{ padding: '0.85rem 1rem' }}>
      <div className="eyebrow" style={{ fontSize: '0.6rem', marginBottom: '0.55rem' }}>Reacciones en directo</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {emojis.map(e => {
          const count = counts[e] || 0;
          return (
            <button key={e} onClick={() => onTap(e)} style={{
              position: 'relative',
              minWidth: 42, height: 42,
              padding: '0 10px',
              borderRadius: 12,
              background: count > 0 ? 'rgba(255,84,112,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${count > 0 ? 'rgba(255,84,112,0.3)' : 'rgba(255,255,255,0.08)'}`,
              color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
              fontSize: '1.2rem',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              transition: 'transform 0.1s, background 0.15s',
            }}
            onMouseDown={ev => ev.currentTarget.style.transform = 'scale(0.92)'}
            onMouseUp={ev => ev.currentTarget.style.transform = ''}
            onMouseLeave={ev => ev.currentTarget.style.transform = ''}
            >
              <span>{e}</span>
              {count > 0 && (
                <span className="mono tabular" style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--coral-bright)' }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VideoStage({ meme, platMeta, progress, cursors, muted }) {
  const aspect = (meme.platform === 'tiktok' || meme.platform === 'instagram') ? '9/16' : '16/9';
  return (
    <div style={{
      position: 'relative',
      aspectRatio: aspect,
      maxHeight: '100%',
      maxWidth: '100%',
      height: aspect === '9/16' ? '100%' : 'auto',
      width: aspect === '9/16' ? 'auto' : '100%',
      borderRadius: 24,
      overflow: 'hidden',
      background: `linear-gradient(135deg, ${platMeta.accent}22, ${platMeta.accent}08), radial-gradient(circle at 30% 30%, rgba(255,255,255,0.08), transparent 60%), #0a0612`,
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
    }}>
      {/* "Video" placeholder */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '1rem',
      }}>
        <div style={{
          fontSize: '6rem', opacity: 0.25, filter: 'saturate(0.6)',
          color: platMeta.accent,
        }}>{platMeta.glyph}</div>
        <div className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          [video preview placeholder]
        </div>
      </div>

      {/* Live badge */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0.4rem 0.75rem',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 999,
        fontSize: '0.75rem', fontWeight: 600,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff3b3b', boxShadow: '0 0 10px #ff3b3b', animation: 'statusPulse 1.4s infinite' }}/>
        SYNCED
      </div>

      {muted && (
        <div style={{
          position: 'absolute', top: 16, right: 16,
          padding: '0.4rem 0.7rem',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(20px)',
          borderRadius: 999,
          fontSize: '0.72rem',
          display: 'flex', alignItems: 'center', gap: 5,
        }}><Icon name="mute" size={12}/> Muted</div>
      )}

      {/* Shared cursors */}
      {cursors.map((c, i) => (
        <SharedCursor key={i} cursor={c}/>
      ))}
    </div>
  );
}

function SharedCursor({ cursor }) {
  return (
    <div style={{
      position: 'absolute',
      left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`,
      transform: 'translate(-2px, -2px)',
      pointerEvents: 'none',
      transition: 'left 0.4s ease, top 0.4s ease',
      zIndex: 10,
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill={cursor.user.color} style={{ filter: `drop-shadow(0 0 6px ${cursor.user.color}aa)` }}>
        <path d="M3 2 L3 17 L8 13 L11 19 L14 18 L11 12 L17 12 Z" stroke="white" strokeWidth="1"/>
      </svg>
      <div style={{
        marginTop: 2,
        background: cursor.user.color,
        color: '#fff',
        fontSize: '0.7rem',
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 6,
        boxShadow: `0 4px 12px ${cursor.user.color}55`,
        whiteSpace: 'nowrap',
      }}>{cursor.user.name}</div>
    </div>
  );
}

function VoteSlider({ vote, setVote, usedTicks, otherVoted, participants }) {
  const [hovering, setHovering] = React.useState(null);
  const display = hovering ?? vote;

  return (
    <div style={{
      background: 'rgba(0,0,0,0.25)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 16,
      padding: '0.85rem 1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span className="eyebrow">Tu voto</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="mono tabular" style={{
            fontSize: '2.5rem', fontWeight: 800,
            background: display !== null ? 'linear-gradient(180deg, var(--coral-bright), var(--coral-deep))' : 'rgba(255,255,255,0.15)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.04em', lineHeight: 1,
            transition: 'all 0.2s',
          }}>
            {display ?? '—'}
          </span>
          <span className="muted mono" style={{ fontSize: '0.85rem' }}>/10</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="eyebrow" style={{ fontSize: '0.62rem' }}>Quién ha votado</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {participants.map(p => {
              const voted = otherVoted.includes(p.id) || (p.id === CURRENT_USER.id && vote !== null);
              return (
                <span key={p.id} style={{
                  position: 'relative',
                  filter: voted ? 'none' : 'grayscale(0.7) opacity(0.4)',
                  transition: 'filter 0.2s',
                }}>
                  <Avatar user={p} size="sm"/>
                  {voted && <span style={{
                    position: 'absolute', bottom: -2, right: -2,
                    width: 12, height: 12, borderRadius: '50%',
                    background: 'var(--teal)', border: '2px solid #1a0a2a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="check" size={8} stroke={3}/>
                  </span>}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', height: 36 }} onMouseLeave={() => setHovering(null)}>
        {/* Track */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: 8, transform: 'translateY(-50%)',
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 999, overflow: 'hidden',
        }}>
          {vote !== null && <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: `${(vote/10)*100}%`,
            background: 'linear-gradient(90deg, #ff5470, #ff8aa3, #ffd166)',
            borderRadius: 999,
            boxShadow: '0 0 12px rgba(255,84,112,0.6)',
            transition: 'width 0.2s',
          }}/>}
        </div>

        {/* Tick marks 0-10 */}
        {Array.from({ length: 11 }).map((_, i) => {
          const used = usedTicks.includes(i);
          const isVote = vote === i;
          return (
            <button
              key={i}
              onClick={() => setVote(i)}
              onMouseEnter={() => setHovering(i)}
              style={{
                position: 'absolute',
                left: `${(i/10)*100}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: isVote ? 24 : 12,
                height: isVote ? 24 : 12,
                borderRadius: '50%',
                background: isVote
                  ? 'radial-gradient(circle, #fff 30%, var(--coral-bright) 70%)'
                  : used ? 'var(--coral)' : 'rgba(255,255,255,0.25)',
                border: isVote ? '2px solid var(--coral-bright)' : 'none',
                cursor: 'pointer',
                padding: 0,
                boxShadow: isVote
                  ? '0 0 0 4px rgba(255,84,112,0.25), 0 4px 12px rgba(255,84,112,0.5)'
                  : used ? '0 0 8px rgba(255,84,112,0.5)' : 'none',
                transition: 'all 0.15s',
                zIndex: isVote ? 2 : 1,
              }}
              title={`${i}${used ? ' (ya usado)' : ''}`}
            />
          );
        })}

        {/* Number labels */}
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          display: 'flex', justifyContent: 'space-between',
          fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
          pointerEvents: 'none',
        }}>
          {Array.from({ length: 11 }).map((_, i) => <span key={i}>{i}</span>)}
        </div>
      </div>
    </div>
  );
}

function ParticipantsCard({ participants, otherVoted }) {
  return (
    <div className="glass" style={{ padding: '1rem 1.1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.7rem' }}>
        <span className="eyebrow">En la sala</span>
        <span className="chip chip-teal" style={{ fontSize: '0.7rem' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--teal)', boxShadow: '0 0 6px var(--teal)' }}/>
          {participants.length} online
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {participants.map(p => {
          const voted = otherVoted.includes(p.id);
          const isMe = p.id === CURRENT_USER.id;
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Avatar user={p} size="md" ring={voted}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  {p.name} {isMe && <span className="muted" style={{ fontWeight: 400, fontSize: '0.78rem' }}>(tú)</span>}
                </div>
                <div style={{ fontSize: '0.72rem', color: voted ? 'var(--teal)' : 'var(--text-dim)' }}>
                  {voted ? '✓ ha votado' : 'votando…'}
                </div>
              </div>
              {voted && <Icon name="check" size={16} stroke={2.5} style={{ color: 'var(--teal)' }}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NotepadCard({ value, onChange }) {
  return (
    <div className="glass" style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
        <span className="eyebrow">Notepad compartido</span>
        <span className="chip" style={{ fontSize: '0.68rem' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--teal)' }}/>
          sync live
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Apunta los momentazos, frases míticas, ideas…"
        style={{
          flex: 1,
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid var(--glass-border)',
          borderRadius: 12,
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          lineHeight: 1.6,
          padding: '0.75rem 0.85rem',
          resize: 'none',
          outline: 'none',
          minHeight: 140,
        }}
      />
    </div>
  );
}

function SuperFavCard({ meme }) {
  const [supered, setSupered] = React.useState(false);
  return (
    <button onClick={() => setSupered(!supered)} className="glass" style={{
      padding: '1rem 1.1rem',
      display: 'flex', alignItems: 'center', gap: '0.85rem',
      background: supered ? 'linear-gradient(135deg, rgba(255,209,102,0.18), rgba(255,84,112,0.12))' : undefined,
      border: supered ? '1px solid rgba(255,209,102,0.4)' : undefined,
      cursor: 'pointer',
      textAlign: 'left',
      width: '100%',
      transition: 'all 0.2s',
      fontFamily: 'inherit',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: supered ? 'linear-gradient(135deg, #ffd166, #ff5470)' : 'rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.3rem',
      }}>{supered ? '⭐' : '☆'}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
          {supered ? '¡Marcado como Super Fav!' : 'Marcar como Super Fav'}
        </div>
        <div className="muted" style={{ fontSize: '0.72rem', marginTop: 2 }}>
          Aparecerá en la galería de carga.
        </div>
      </div>
    </button>
  );
}

window.SessionScreen = SessionScreen;
