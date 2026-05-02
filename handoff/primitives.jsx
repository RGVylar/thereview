/* Reusable primitives — Avatar, AvatarStack, Chip, IconButton, etc. */

function Avatar({ user, size = 'md', ring = false, style = {} }) {
  const cls = `avatar avatar-${size}`;
  const initials = (user.name || user.username || '?').slice(0, 2).toUpperCase();
  const bg = `linear-gradient(135deg, ${user.color}, ${shade(user.color, -20)})`;
  return (
    <span
      className={cls}
      style={{
        background: bg,
        boxShadow: ring ? `0 0 0 2px rgba(255,255,255,0.18), 0 0 0 4px ${user.color}55` : 'inset 0 1px 0 rgba(255,255,255,0.25)',
        ...style,
      }}
      title={user.name}
    >
      {initials}
    </span>
  );
}

function AvatarStack({ users, max = 4, size = 'md' }) {
  const overflow = users.length - max;
  const visible = users.slice(0, max);
  const sizePx = size === 'sm' ? 24 : size === 'lg' ? 44 : 32;
  return (
    <div style={{ display: 'inline-flex' }}>
      {visible.map((u, i) => (
        <span
          key={u.id}
          style={{
            marginLeft: i === 0 ? 0 : -10,
            zIndex: visible.length - i,
            display: 'inline-flex',
          }}
        >
          <Avatar user={u} size={size} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          className={`avatar avatar-${size}`}
          style={{
            marginLeft: -10,
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(10px)',
            color: 'var(--text-soft)',
            fontSize: size === 'sm' ? '0.6rem' : '0.7rem',
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function shade(hex, amt) {
  const c = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(c.slice(0,2),16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(c.slice(2,4),16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(c.slice(4,6),16) + amt));
  return `#${[r,g,b].map(x => x.toString(16).padStart(2,'0')).join('')}`;
}

function PlatformBadge({ platform, size = 'md' }) {
  const meta = window.PLATFORMS[platform] || window.PLATFORMS.otro;
  const px = size === 'sm' ? 22 : 28;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: px,
        height: px,
        borderRadius: '50%',
        background: `${meta.accent}22`,
        border: `1px solid ${meta.accent}55`,
        color: meta.accent,
        fontSize: size === 'sm' ? '0.7rem' : '0.85rem',
        fontWeight: 700,
        flexShrink: 0,
      }}
      title={meta.label}
    >
      {meta.glyph}
    </span>
  );
}

function Icon({ name, size = 18, stroke = 1.75 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  const paths = {
    plus:    <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    x:       <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    check:   <polyline points="20 6 9 17 4 12"/>,
    chevR:   <polyline points="9 18 15 12 9 6"/>,
    chevL:   <polyline points="15 18 9 12 15 6"/>,
    chevD:   <polyline points="6 9 12 15 18 9"/>,
    chevU:   <polyline points="18 15 12 9 6 15"/>,
    play:    <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>,
    pause:   <><rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" rx="1"/><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" rx="1"/></>,
    next:    <><polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/></>,
    prev:    <><polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"/><line x1="5" y1="5" x2="5" y2="19"/></>,
    mute:    <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></>,
    unmute:  <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></>,
    star:    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" stroke="none"/>,
    starO:   <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    fire:    <path d="M12 2c1 4 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4-1 2 0 4 2 4s3-2 0-9z" fill="currentColor" stroke="none"/>,
    notepad: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></>,
    users:   <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    user:    <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    clock:   <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    trash:   <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
    film:    <><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></>,
    rewind:  <><polygon points="11 19 2 12 11 5 11 19" fill="currentColor" stroke="none"/><polygon points="22 19 13 12 22 5 22 19" fill="currentColor" stroke="none"/></>,
    sparkle: <><path d="M12 3l1.5 5L19 9.5 13.5 11 12 16l-1.5-5L5 9.5 10.5 8z" fill="currentColor" stroke="none"/><path d="M19 17l.5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5z" fill="currentColor" stroke="none"/></>,
    upload:  <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
    link:    <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    search:  <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    logout:  <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    extension:<><path d="M14 7V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v3H7a2 2 0 0 0-2 2v3h3a2 2 0 0 1 2 2 2 2 0 0 1-2 2H5v3a2 2 0 0 0 2 2h3v-3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v3h3a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/></>,
    eye:     <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    heart:   <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" stroke="none"/>,
    pencil:  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>,
    bell:    <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    cup:     <><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></>,
  };
  return <svg {...props}>{paths[name] || null}</svg>;
}

function StatusDot({ status }) {
  const map = {
    pending:  { color: '#ffd166', label: 'Pendiente', pulse: true },
    active:   { color: '#5ee3d2', label: 'Activa',   pulse: true },
    finished: { color: '#9b6bff', label: 'Terminada', pulse: false },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', color: 'var(--text-soft)', fontWeight: 500 }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: s.color,
        boxShadow: s.pulse ? `0 0 12px ${s.color}` : 'none',
        animation: s.pulse ? 'statusPulse 2s ease-in-out infinite' : 'none',
      }}/>
      {s.label}
    </span>
  );
}

// Toast (minimal)
function Toast({ msg, onClose }) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 2400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="glass-strong fade-in" style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      padding: '0.75rem 1.25rem', zIndex: 1000, fontSize: '0.9rem', borderRadius: 999,
    }}>{msg}</div>
  );
}

Object.assign(window, { Avatar, AvatarStack, PlatformBadge, Icon, StatusDot, Toast, shade });
