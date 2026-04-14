# 🍿 The Review

**Meme review sessions with friends.** Acumula memes durante el mes, crea una sesión, revisa los memes juntos y votalos.

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
│   │   ├── main.py          # FastAPI app
│   │   ├── config.py        # Settings (env)
│   │   ├── database.py      # SQLAlchemy engine
│   │   ├── models.py        # User, Meme, Session, Vote...
│   │   ├── schemas.py       # Pydantic models
│   │   ├── auth.py          # JWT + bcrypt
│   │   └── routers/
│   │       ├── users.py     # Register, login, list users
│   │       ├── memes.py     # CRUD memes
│   │       ├── sessions.py  # Create, start, finish sessions
│   │       └── votes.py     # Votar + ranking
│   ├── alembic/             # Migrations
│   ├── alembic.ini
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

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Crear usuario |
| POST | `/api/auth/login` | Login → JWT token |
| GET | `/api/auth/me` | Usuario actual |
| GET | `/api/auth/users` | Listar usuarios |
| POST | `/api/memes` | Añadir meme (URL) |
| GET | `/api/memes` | Mis memes (pending=true/false) |
| DELETE | `/api/memes/:id` | Borrar meme no revisado |
| POST | `/api/sessions` | Crear sesión (mezcla memes) |
| GET | `/api/sessions` | Mis sesiones |
| GET | `/api/sessions/:id` | Detalle sesión |
| POST | `/api/sessions/:id/start` | Iniciar (marca reviewed_at) |
| POST | `/api/sessions/:id/finish` | Finalizar sesión |
| POST | `/api/sessions/:id/votes` | Votar meme |
| GET | `/api/sessions/:id/votes` | Listar votos |
| GET | `/api/sessions/:id/votes/ranking` | Ranking por suma de votos |

## Deploy (Debian 12)

```bash
sudo bash deploy/setup.sh
```

Luego configurar Cloudflare Tunnel apuntando al puerto de Caddy.

## Useful commands
```
pct exec 201 -- bash -lc '
  cd /opt/thereview &&
  sudo -u thereview git pull &&
  cd frontend && sudo -u thereview npm run build --silent &&
  systemctl restart thereview-api &&
  systemctl reload caddy
'
pct exec 201 -- bash -lc 'cd /opt/thereview && sudo -u thereview git pull && cd backend && sudo -u thereview .venv/bin/alembic upgrade head && cd ../frontend && sudo -u thereview npm run build --silent && systemctl restart thereview-api && systemctl reload caddy'
```

## Tareas pendientes

- **Extensión de navegador (cliente)**: herramienta para usuarios que permita, desde el cliente, las siguientes funciones de comportamiento esperado:
  - Extraer/exportar rápidamente todo el contenido guardado en TikTok (biblioteca/guardados) para importarlo en The Review.
  - Habilitar reproducción sincronizada entre participantes: cuando un usuario pulse “Play”, todos los participantes deberán reproducir el mismo contenido simultáneamente.
  - Detalle: no se especifica cómo debe implementarse; la implementación será abordada posteriormente por Claude.
