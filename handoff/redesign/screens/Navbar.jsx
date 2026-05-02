function Navbar({ route, onNavigate, addUrl, setAddUrl, onAddMeme }) {
  const isActive = (r) => route === r || (r === 'sessions' && route === 'session');
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 50,
      padding: '14px 24px',
      display: 'flex', alignItems: 'center', gap: '1rem',
      background: 'rgba(16, 6, 32, 0.55)',
      backdropFilter: 'blur(28px) saturate(180%)',
      WebkitBackdropFilter: 'blur(28px) saturate(180%)',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }} onClick={() => onNavigate('sessions')}>
        <div style={{
          width: 36, height: 36, borderRadius: 11,
          background: 'linear-gradient(135deg, #ff5470, #9b6bff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.1rem',
          boxShadow: '0 6px 20px rgba(255,84,112,0.4), inset 0 1px 0 rgba(255,255,255,0.4)',
        }}>🍿</div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>The Review</span>
          <span className="eyebrow" style={{ fontSize: '0.6rem', letterSpacing: '0.18em' }}>v2.0</span>
        </div>
      </div>

      {/* Add meme — center */}
      <form onSubmit={(e) => { e.preventDefault(); onAddMeme(); }} style={{
        flex: 1, maxWidth: 540, margin: '0 1rem',
        display: 'flex', gap: '0.5rem',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 999,
        padding: '4px 4px 4px 16px',
        backdropFilter: 'blur(20px)',
      }}>
        <Icon name="link" size={16} style={{ color: 'var(--text-muted)' }} />
        <input
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          placeholder="Pega la URL del meme — TikTok, X, Instagram, YouTube…"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.9rem',
          }}
        />
        <button className="btn btn-primary" type="submit" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
          <Icon name="plus" size={14}/> Añadir
        </button>
      </form>

      {/* Right: nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        <NavLink active={isActive('sessions')} onClick={() => onNavigate('sessions')} icon="film" label="Sesiones" badge={1}/>
        <NavLink active={isActive('profile')}  onClick={() => onNavigate('profile')}  icon="user" label="Mis memes"/>
        <NavLink active={isActive('rewind')}   onClick={() => onNavigate('rewind')}   icon="rewind" label="Rewind"/>

        <span className="chip chip-teal" style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', boxShadow: '0 0 8px var(--teal)' }}/>
          Extensión activa
        </span>

        <button
          className="btn btn-ghost btn-icon"
          style={{ marginLeft: '0.25rem' }}
          onClick={() => onNavigate('login')}
          title="Salir"
        >
          <Icon name="logout" size={16}/>
        </button>

        <Avatar user={CURRENT_USER} size="md" ring style={{ marginLeft: '0.4rem' }} />
      </div>
    </nav>
  );
}

function NavLink({ active, onClick, icon, label, badge }) {
  return (
    <button onClick={onClick} className="btn btn-ghost" style={{
      position: 'relative',
      background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
      color: active ? 'var(--text)' : 'var(--text-soft)',
      fontWeight: active ? 600 : 500,
      borderRadius: 12,
      padding: '0.5rem 0.85rem',
      border: active ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
    }}>
      <Icon name={icon} size={16}/>
      <span style={{ fontSize: '0.85rem' }}>{label}</span>
      {badge && (
        <span style={{
          position: 'absolute', top: 4, right: 4,
          background: 'var(--coral)', color: 'white',
          fontSize: '0.6rem', fontWeight: 700,
          minWidth: 16, height: 16, borderRadius: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px',
          boxShadow: '0 0 0 2px rgba(16,6,32,0.6)',
        }}>{badge}</span>
      )}
    </button>
  );
}

window.Navbar = Navbar;
