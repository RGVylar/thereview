function SessionsScreen({ onOpen }) {
  const [showCreate, setShowCreate] = React.useState(false);
  const [name, setName] = React.useState('');
  const [selected, setSelected] = React.useState([CURRENT_USER.id]);
  const [mixMode, setMixMode] = React.useState('shuffle');
  const [memeLimit, setMemeLimit] = React.useState('');

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const active = SESSIONS.filter(s => s.status !== 'finished');
  const finished = SESSIONS.filter(s => s.status === 'finished');

  return (
    <div className="container-wide">
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: '0.4rem' }}>Sesiones</div>
          <h1 className="h1">Tus reviews</h1>
          <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.95rem' }}>
            {active.length} activas · {finished.length} en tu historial
          </p>
        </div>
        {!showCreate && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ padding: '0.8rem 1.4rem' }}>
            <Icon name="plus" size={16}/> Nueva sesión
          </button>
        )}
      </header>

      {showCreate && (
        <div className="glass-strong fade-in" style={{ padding: '1.75rem', marginBottom: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div>
              <h2 className="h2" style={{ fontSize: '1.3rem' }}>Crear nueva sesión</h2>
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>Mezcla los memes de los participantes y empieza la review</p>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => setShowCreate(false)}><Icon name="x" size={16}/></button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <Field label="Nombre">
              <input className="glass-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Review Mayo" />
            </Field>
            <Field label="Límite de memes">
              <input className="glass-input" type="number" value={memeLimit} onChange={(e) => setMemeLimit(e.target.value)} placeholder="∞ (todos)" />
            </Field>
            <Field label="Modo de mezcla">
              <div style={{ display: 'flex', gap: 6, padding: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 14, border: '1px solid var(--glass-border)' }}>
                <SegBtn active={mixMode === 'shuffle'} onClick={() => setMixMode('shuffle')}>🔀 Mezclar</SegBtn>
                <SegBtn active={mixMode === 'batched'} onClick={() => setMixMode('batched')}>📦 Por tandas</SegBtn>
              </div>
            </Field>
          </div>

          <Field label={`Participantes · ${selected.length} seleccionados`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {USERS.map(u => {
                const on = selected.includes(u.id);
                return (
                  <button key={u.id} onClick={() => toggle(u.id)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.4rem 0.85rem 0.4rem 0.4rem',
                    borderRadius: 999,
                    background: on ? `${u.color}22` : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${on ? u.color + '99' : 'rgba(255,255,255,0.1)'}`,
                    color: on ? '#fff' : 'var(--text-soft)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    fontFamily: 'inherit',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                  }}>
                    <Avatar user={u} size="sm" />
                    {u.name} {u.id === CURRENT_USER.id && <span className="muted" style={{ fontSize: '0.72rem' }}>(tú)</span>}
                  </button>
                );
              })}
            </div>
          </Field>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button className="btn btn-glass" onClick={() => setShowCreate(false)}>Cancelar</button>
            <button className="btn btn-primary">Crear sesión</button>
          </div>
        </div>
      )}

      {/* Active sessions */}
      {active.length > 0 && (
        <section style={{ marginBottom: '2.25rem' }}>
          <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>Activas · Pendientes</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '1rem' }}>
            {active.map(s => <SessionCard key={s.id} session={s} onOpen={onOpen} featured/>)}
          </div>
        </section>
      )}

      {/* Finished history */}
      <section>
        <div className="eyebrow" style={{ marginBottom: '0.85rem' }}>Historial</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {finished.map(s => <SessionCard key={s.id} session={s} onOpen={onOpen}/>)}
        </div>
      </section>
    </div>
  );
}

function SessionCard({ session, onOpen, featured }) {
  const isInvite = session.new_invite;
  return (
    <div
      onClick={() => onOpen(session.id)}
      className="glass"
      style={{
        padding: '1.25rem',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        transition: 'transform 0.18s, box-shadow 0.18s',
        border: isInvite ? '1px solid rgba(255,84,112,0.5)' : undefined,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; }}
    >
      {featured && session.status === 'active' && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(circle at 100% 0%, rgba(94,227,210,0.18), transparent 60%)',
        }}/>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', position: 'relative' }}>
        <div>
          {isInvite && <span className="chip chip-coral" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>🔔 Nueva invitación</span>}
          <h3 className="h3" style={{ fontSize: '1.05rem' }}>{session.name}</h3>
          <div style={{ marginTop: '0.4rem' }}><StatusDot status={session.status}/></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono tabular" style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>{session.meme_count}</div>
          <div className="eyebrow" style={{ fontSize: '0.62rem', marginTop: '0.2rem' }}>memes</div>
        </div>
      </div>

      {session.status === 'active' && (
        <div style={{ marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.4rem' }}>
            <span className="muted">Progreso</span>
            <span className="mono tabular soft">{session.progress}/{session.meme_count}</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${(session.progress/session.meme_count)*100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #5ee3d2, #9b6bff)',
              boxShadow: '0 0 12px rgba(94,227,210,0.5)',
              borderRadius: 999,
            }}/>
          </div>
        </div>
      )}

      {session.winner && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          padding: '0.6rem 0.75rem',
          background: 'rgba(255,209,102,0.1)',
          border: '1px solid rgba(255,209,102,0.25)',
          borderRadius: 12,
          marginBottom: '0.85rem',
        }}>
          <span style={{ fontSize: '1.1rem' }}>🏆</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 600 }}>Ganador · {session.winner.score.toFixed(1)}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.winner.title}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <AvatarStack users={session.participants} size="sm"/>
        <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
          {new Date(session.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <span className="eyebrow" style={{ fontSize: '0.62rem' }}>{label}</span>
      {children}
    </label>
  );
}

function SegBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
      border: 'none', color: active ? 'var(--text)' : 'var(--text-soft)',
      fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 500,
      padding: '0.5rem 0.75rem', borderRadius: 10, cursor: 'pointer',
      boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.15)' : 'none',
      transition: 'all 0.15s',
    }}>{children}</button>
  );
}

window.SessionsScreen = SessionsScreen;
