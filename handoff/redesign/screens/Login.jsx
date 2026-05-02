function LoginScreen({ onLogin }) {
  const [u, setU] = React.useState('rgvylar');
  const [p, setP] = React.useState('demo123');

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', position: 'relative',
    }}>
      {/* Floating brand badge */}
      <div style={{
        position: 'absolute', top: '8%', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: '0.6rem',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14,
          background: 'linear-gradient(135deg, #ff5470, #9b6bff)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.4rem',
          boxShadow: '0 12px 40px rgba(255,84,112,0.45), inset 0 1px 0 rgba(255,255,255,0.4)',
        }}>🍿</div>
        <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.01em' }}>The Review</span>
      </div>

      <div className="glass-strong fade-in" style={{
        width: '100%', maxWidth: 440, padding: '2.5rem 2.25rem',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div className="eyebrow" style={{ marginBottom: '0.5rem' }}>Welcome back</div>
          <h1 className="h1" style={{ marginBottom: '0.4rem' }}>Meme review<br/>con los panas</h1>
          <p className="muted" style={{ fontSize: '0.92rem' }}>
            Acumula memes durante el mes,<br/>revísalos juntos, votad sin piedad.
          </p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onLogin(); }} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span className="eyebrow" style={{ fontSize: '0.65rem' }}>Usuario</span>
            <input className="glass-input" value={u} onChange={(e) => setU(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span className="eyebrow" style={{ fontSize: '0.65rem' }}>Contraseña</span>
            <input className="glass-input" type="password" value={p} onChange={(e) => setP(e.target.value)} />
          </label>

          <button className="btn btn-primary" type="submit" style={{
            marginTop: '0.5rem', padding: '0.85rem',
            fontSize: '0.95rem',
          }}>
            Entrar
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.5rem 0 1rem' }}>
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }}/>
          <span className="eyebrow" style={{ fontSize: '0.62rem' }}>o</span>
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }}/>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-soft)' }}>
          ¿No tienes cuenta? <a href="#" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>Regístrate</a>
        </p>
      </div>

      {/* Bottom mini-features */}
      <div style={{
        position: 'absolute', bottom: '7%', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '0.5rem',
      }}>
        <span className="chip">🎬 Sync video</span>
        <span className="chip">🖱️ Cursores compartidos</span>
        <span className="chip">📝 Notepad live</span>
        <span className="chip">🏆 Rewind anual</span>
      </div>
    </div>
  );
}

window.LoginScreen = LoginScreen;
