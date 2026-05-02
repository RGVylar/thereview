function ProfileScreen() {
  const [filter, setFilter] = React.useState('all');
  const [showImport, setShowImport] = React.useState(false);

  const filtered = MEMES.filter(m =>
    filter === 'all' ? true :
    filter === 'pending' ? !m.reviewed :
    m.reviewed
  );

  const total = MEMES.length;
  const pending = MEMES.filter(m => !m.reviewed).length;
  const reviewed = total - pending;

  return (
    <div className="container-wide">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Avatar user={CURRENT_USER} size="xl" ring/>
          <div>
            <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>Tu colección</div>
            <h1 className="h1">{CURRENT_USER.name}</h1>
            <p className="muted" style={{ marginTop: '0.2rem' }}>@{CURRENT_USER.username}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-glass" onClick={() => setShowImport(!showImport)}>
            <Icon name="upload" size={14}/> Importar TikToks
          </button>
          <button className="btn btn-ghost" style={{ color: '#ff8aa3' }}>
            <Icon name="trash" size={14}/> Borrar todos
          </button>
        </div>
      </header>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <StatCard label="Total" value={total} accent="#ffffff"/>
        <StatCard label="Pendientes" value={pending} accent="#ffd166" sub={`${Math.round(pending/total*100)}% por revisar`}/>
        <StatCard label="Revisados" value={reviewed} accent="#5ee3d2" sub="✅ ya votados"/>
        <StatCard label="Este mes" value={12} accent="#ff5470" sub="+34% vs marzo"/>
      </div>

      {showImport && (
        <div className="glass-strong fade-in" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h3 className="h3">📥 Importar guardados de TikTok</h3>
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>Sube tu user_data.json o el .zip de exportación</p>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => setShowImport(false)}><Icon name="x" size={16}/></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <ol style={{ paddingLeft: '1.25rem', color: 'var(--text-soft)', fontSize: '0.88rem', lineHeight: 1.7 }}>
              <li>Abre <span className="mono" style={{ color: 'var(--coral-bright)' }}>tiktok.com/setting</span></li>
              <li>Ve a <strong>Privacidad → Descarga tus datos</strong></li>
              <li>Elige formato <strong>JSON</strong></li>
              <li>Sube aquí el ZIP que te manden</li>
            </ol>
            <div style={{
              border: '1.5px dashed rgba(255,255,255,0.2)',
              borderRadius: 14,
              padding: '1.5rem',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '0.5rem',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <Icon name="upload" size={28} stroke={1.5}/>
              <span style={{ fontSize: '0.88rem' }}>Arrastra el archivo aquí</span>
              <span className="muted" style={{ fontSize: '0.78rem' }}>.zip · .json · .txt</span>
              <button className="btn btn-primary" style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.82rem' }}>📂 Seleccionar archivo</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>Todos · {total}</FilterPill>
        <FilterPill active={filter === 'pending'} onClick={() => setFilter('pending')} accent="#ffd166">Pendientes · {pending}</FilterPill>
        <FilterPill active={filter === 'reviewed'} onClick={() => setFilter('reviewed')} accent="#5ee3d2">Revisados · {reviewed}</FilterPill>
        <div style={{ flex: 1 }}/>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.4rem 0.75rem 0.4rem 0.85rem',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--glass-border)',
          borderRadius: 999,
          width: 280,
        }}>
          <Icon name="search" size={14}/>
          <input placeholder="Buscar por título o autor…" style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.85rem',
          }}/>
        </div>
      </div>

      {/* Meme grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {filtered.map((m, i) => <MemeCard key={m.id} meme={m} idx={i}/>)}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div className="glass" style={{ padding: '1.1rem 1.25rem' }}>
      <div className="eyebrow" style={{ fontSize: '0.62rem' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.3rem' }}>
        <span className="mono tabular" style={{ fontSize: '1.85rem', fontWeight: 700, color: accent, letterSpacing: '-0.025em' }}>{value}</span>
      </div>
      {sub && <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.15rem' }}>{sub}</div>}
    </div>
  );
}

function FilterPill({ active, onClick, accent, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '0.5rem 1rem',
      borderRadius: 999,
      background: active ? (accent ? `${accent}22` : 'rgba(255,255,255,0.1)') : 'transparent',
      border: `1px solid ${active ? (accent ? `${accent}66` : 'rgba(255,255,255,0.18)') : 'rgba(255,255,255,0.08)'}`,
      color: active ? (accent || '#fff') : 'var(--text-soft)',
      fontFamily: 'inherit',
      fontSize: '0.85rem',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.15s',
    }}>{children}</button>
  );
}

function MemeCard({ meme, idx }) {
  const meta = PLATFORMS[meme.platform];
  return (
    <div className="glass fade-in" style={{
      padding: '0.85rem',
      animationDelay: `${idx * 0.04}s`,
      transition: 'transform 0.18s, box-shadow 0.18s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; }}
    >
      {/* Thumbnail (placeholder gradient) */}
      <div style={{
        aspectRatio: meme.platform === 'tiktok' || meme.platform === 'instagram' ? '4/5' : '16/9',
        borderRadius: 12,
        background: `linear-gradient(135deg, ${meta.accent}33, ${meta.accent}11), radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1), transparent 60%)`,
        border: '1px solid rgba(255,255,255,0.06)',
        marginBottom: '0.75rem',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: '3rem', opacity: 0.45, filter: 'saturate(0.7)' }}>{meta.glyph}</span>

        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6 }}>
          <PlatformBadge platform={meme.platform} size="sm"/>
          {meme.dup && (
            <span className="chip chip-coral" style={{ fontSize: '0.68rem', padding: '0.18rem 0.45rem' }}>×{meme.dup}</span>
          )}
        </div>

        {meme.duration && (
          <div className="mono" style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
            color: '#fff',
            fontSize: '0.68rem',
            padding: '0.18rem 0.45rem',
            borderRadius: 6,
          }}>{Math.floor(meme.duration/60)}:{String(meme.duration%60).padStart(2,'0')}</div>
        )}

        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <span className="chip" style={{
            fontSize: '0.65rem', padding: '0.18rem 0.5rem',
            background: meme.reviewed ? 'rgba(94,227,210,0.18)' : 'rgba(255,209,102,0.18)',
            borderColor: meme.reviewed ? 'rgba(94,227,210,0.35)' : 'rgba(255,209,102,0.35)',
            color: meme.reviewed ? 'var(--teal)' : 'var(--gold)',
          }}>{meme.reviewed ? '✓ revisado' : '○ pendiente'}</span>
        </div>
      </div>

      <div style={{ fontSize: '0.85rem', fontWeight: 600, lineHeight: 1.35, marginBottom: '0.4rem',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {meme.title}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meme.uploader}</span>
        <div style={{ display: 'flex', gap: '0.6rem', fontFamily: 'var(--font-mono)' }}>
          <span title="views">👁 {meme.views}</span>
          <span title="likes">♥ {meme.likes}</span>
        </div>
      </div>
    </div>
  );
}

window.ProfileScreen = ProfileScreen;
