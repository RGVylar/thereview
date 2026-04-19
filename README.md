# 🍿 The Review

**Meme review sessions with friends.** Acumula memes durante el mes, crea una sesión, revisa los memes juntos y votalos.

### Features

- **Video downloads**: TikTok y Twitter/X memes descargados con `yt-dlp` y servidos como `<video>` para evitar restricciones de autoplay
- **Metadata extracción**: Uploader, vistas, likes, comentarios, duración extraídos de yt-dlp y mostrados durante review
- **Tie-breaking playoffs**: Cuando hay empates en top/bottom, confrontación cabeza-a-cabeza votada por los participantes
- **Shared cursors**: Posiciones de ratón sincronizadas en tiempo real via WebSocket
- **Audio normalization**: DynamicsCompressor (Web Audio API) levela volumen en videos descargados
- **Superfavorites**: Memes votados al máximo por todos los participantes se guardan para gallery de carga
- **Shared notepad**: Notas sincronizadas durante sesión via WebSocket
- **Full-width voting**: Slider que ocupa todo el ancho, con ticks rojos para puntuaciones usadas
- **Duplicate badge**: Muestra `×2`, `×3` cuando múltiples usuarios añaden el mismo meme
- **Both-must-click-next**: Ambos participantes (o dueño del meme solo) deben votar para avanzar
- **F5 recovery**: localStorage preserva la posición actual, se restaura al refrescar

## Stack

- **Backend:** FastAPI + SQLAlchemy + Alembic + PostgreSQL
- **Frontend:** SvelteKit (PWA, adapter-static)
- **Mobile (futuro):** SvelteKit + Capacitor (share intent)
- **Auth:** JWT + bcrypt
- **Deploy:** Debian 12 + systemd + Caddy + Cloudflare Tunnel

## Estructura

```
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app + CORS
│   │   ├── config.py        # Settings (env)
│   │   ├── database.py      # SQLAlchemy engine
│   │   ├── models.py        # User, Meme, Session, Vote, MediaCache, SuperFavorite
│   │   ├── schemas.py       # Pydantic models
│   │   ├── auth.py          # JWT + bcrypt
│   │   ├── downloader.py    # yt-dlp integration + media streaming
│   │   └── routers/
│   │       ├── users.py     # Register, login, list users
│   │       ├── memes.py     # CRUD memes
│   │       ├── sessions.py  # Create, start, finish + media status/streaming
│   │       ├── votes.py     # Votar + ranking con playoff
│   │       └── ws.py        # WebSocket hub (rooms, broadcast)
│   ├── alembic/             # Migrations
│   ├── alembic.ini
│   ├── media/               # Downloaded videos (git-ignored)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.js       # Fetch wrapper
│   │   │   ├── auth.js      # Auth store
│   │   │   └── embed.js     # Embed detection
│   │   └── routes/
│   │       ├── +layout.svelte
│   │       ├── +page.svelte        # Redirect
│   │       ├── login/              # Login
│   │       ├── register/           # Register
│   │       ├── memes/              # Add/list memes
│   │       └── sessions/
│   │           ├── +page.svelte    # List/create sessions
│   │           └── [id]/+page.svelte  # Session view + voting
│   ├── static/manifest.json
│   ├── svelte.config.js
│   └── vite.config.js
└── deploy/
    ├── Caddyfile
    ├── thereview-api.service
    └── setup.sh
```

## Desarrollo local

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Editar .env con tu PostgreSQL local

# Crear migración inicial
alembic revision --autogenerate -m "initial"
alembic upgrade head

# Ejecutar
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

El frontend en dev hace proxy de `/api` al backend en `localhost:8000`.

### Extension (Chrome/Edge)

Una extensión de navegador (en `/extension/`) intercepta eventos de reproducción de video en TikTok/Twitter/YouTube y los sincroniza via postMessage hacia la sesión de review:

- Detecta autoplay y estado de reproducción (play/pause/seek)
- Sincroniza a todos los participantes via WebSocket
- Nota: requiere `host_permissions` para acceder a TikTok/Twitter

## API Endpoints

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Crear usuario |
| POST | `/api/auth/login` | Login → JWT token |
| GET | `/api/auth/me` | Usuario actual |
| GET | `/api/auth/users` | Listar usuarios |

### Memes
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/memes` | Añadir meme (URL) |
| GET | `/api/memes` | Mis memes (pending=true/false) |
| DELETE | `/api/memes/:id` | Borrar meme no revisado |

### Sessions
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/sessions` | Crear sesión (mezcla memes, descarga TikTok/Twitter) |
| GET | `/api/sessions` | Mis sesiones |
| GET | `/api/sessions/:id` | Detalle sesión |
| POST | `/api/sessions/:id/start` | Iniciar sesión |
| POST | `/api/sessions/:id/finish` | Finalizar (marca memes como reviewed) |
| DELETE | `/api/sessions/:id` | Borrar sesión (limpia media descargado) |
| WS | `/api/sessions/:id/ws?token=JWT` | WebSocket: navigate, vote, cursor, playback, superfav, note_update, etc. |

### Votes & Ranking
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/sessions/:id/votes` | Votar meme |
| GET | `/api/sessions/:id/votes` | Listar votos |
| GET | `/api/sessions/:id/votes/ranking?top=5&bottom=5` | Ranking (top N y bottom N) |

### Media
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/sessions/:id/media` | Estado de descargas (pending/ready/failed + metadata) |
| GET | `/api/sessions/:id/media/:meme_id?token=JWT` | Stream archivo mp4 descargado |
| GET | `/api/sessions/superfavorites` | Memes votados al máximo en sesiones pasadas |

## Deploy (Debian 12)

```bash
sudo bash deploy/setup.sh
```

Luego configurar Cloudflare Tunnel apuntando al puerto de Caddy.

## Useful commands
```
clear
pct exec 201 -- bash -lc '
  cd /opt/thereview &&
  sudo -u thereview git pull &&
  cd frontend && sudo -u thereview npm run build --silent &&
  systemctl restart thereview-api &&
  systemctl reload caddy
'
pct exec 201 -- bash -lc 'cd /opt/thereview && sudo -u thereview git pull && cd backend && sudo -u thereview .venv/bin/alembic upgrade head && cd ../frontend && sudo -u thereview npm run build --silent && systemctl restart thereview-api && systemctl reload caddy'
```

## Arquitectura destacada

### WebSocket hub (`routers/ws.py`)
- In-memory `_rooms` dict keyed by `session_id`
- Authenticated via JWT query param
- Broadcast messages: navigate, vote, playback, cursor, superfav, note_update, etc.
- No message persistence (sincronización en tiempo real)

### Video downloads (`downloader.py`)
- `yt-dlp` Python API con semáforo global (máx 6 descargas concurrentes)
- 480p max para mantener tamaño pequeño
- Metadata extraída: uploader, view_count, like_count, comment_count, duration
- Almacenado en `MediaCache` table con estado (pending/ready/failed)
- Eliminado cuando sesión termina

### Voting & Tie-breaking
- `Vote` table con unique constraint `(user_id, meme_id, session_id)` (upsert, no append)
- Playoff system detecta empates en top/bottom durante ranking
- Ranking endpoint soporta `?top=N&bottom=N` (defaults: 5/5)

## Tareas pendientes

- Bulk export de guardados de TikTok/X hacia The Review (actualmente URL-por-URL manual)
- Mobile app (SvelteKit + Capacitor) con share intent para capturar memes rápidamente
- Estadísticas por usuario (memes votados, participación, ranking personal)
- Integración con otros servicios (YouTube, Instagram, Twitch clips)
