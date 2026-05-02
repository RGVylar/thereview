/* Mock data — coherente con el modelo real de la app */

const USERS = [
  { id: 1, username: 'rgvylar',  name: 'RG',     color: '#ff5470' },
  { id: 2, username: 'leo',      name: 'Leo',    color: '#9b6bff' },
  { id: 3, username: 'noa',      name: 'Noa',    color: '#5ee3d2' },
  { id: 4, username: 'kique',    name: 'Kike',   color: '#ffd166' },
  { id: 5, username: 'mar',      name: 'Mar',    color: '#7ab8ff' },
];

const CURRENT_USER = USERS[0];

const PLATFORMS = {
  tiktok:    { label: 'TikTok',    accent: '#25f4ee', glyph: '♪' },
  twitter:   { label: 'X',         accent: '#1da1f2', glyph: '𝕏' },
  instagram: { label: 'Instagram', accent: '#e1306c', glyph: '◉' },
  youtube:   { label: 'YouTube',   accent: '#ff4444', glyph: '▶' },
  otro:      { label: 'Link',      accent: '#aaaaaa', glyph: '↗' },
};

const SESSIONS = [
  {
    id: 1,
    name: 'Review Abril',
    status: 'active',
    meme_count: 32,
    participants: [USERS[0], USERS[1], USERS[2]],
    created_by: 1,
    created_at: '2026-04-22T18:00:00',
    progress: 14,
  },
  {
    id: 2,
    name: 'Cumpleaños Leo Especial',
    status: 'pending',
    meme_count: 48,
    participants: [USERS[0], USERS[1], USERS[3], USERS[4]],
    created_by: 2,
    created_at: '2026-04-25T20:30:00',
    progress: 0,
    new_invite: true,
  },
  {
    id: 3,
    name: 'Review Marzo',
    status: 'finished',
    meme_count: 41,
    participants: [USERS[0], USERS[1], USERS[2], USERS[3]],
    created_by: 1,
    created_at: '2026-03-30T19:00:00',
    progress: 41,
    winner: { title: 'Gato confundido en escaleras mecánicas', score: 9.2 },
  },
  {
    id: 4,
    name: 'Review Febrero',
    status: 'finished',
    meme_count: 28,
    participants: [USERS[0], USERS[2], USERS[4]],
    created_by: 1,
    created_at: '2026-02-28T20:00:00',
    progress: 28,
    winner: { title: 'Niño pequeño grita "yo no fui"', score: 9.6 },
  },
  {
    id: 5,
    name: 'Review Enero',
    status: 'finished',
    meme_count: 35,
    participants: [USERS[0], USERS[1], USERS[2], USERS[3]],
    created_by: 3,
    created_at: '2026-01-31T19:30:00',
    progress: 35,
    winner: { title: 'Mr. Beast empieza a llorar de la nada', score: 8.8 },
  },
];

const MEMES = [
  { id: 1, url: 'https://tiktok.com/@user/video/1', platform: 'tiktok',    title: 'Gato detective interroga al perro', uploader: '@catlawenforcement', views: '2.4M', likes: '480K', duration: 23, reviewed: false, added: '2026-04-23' },
  { id: 2, url: 'https://x.com/user/status/2',     platform: 'twitter',    title: 'Tweet sobre cómo se siente programar a las 3am', uploader: '@devhumor', views: '180K', likes: '12K', duration: null, reviewed: false, added: '2026-04-22' },
  { id: 3, url: 'https://tiktok.com/@user/video/3', platform: 'tiktok',    title: 'Niño explica por qué la pizza con piña es válida', uploader: '@kidopinions', views: '5.1M', likes: '1.2M', duration: 47, reviewed: false, added: '2026-04-22', dup: 2 },
  { id: 4, url: 'https://instagram.com/p/4',       platform: 'instagram',  title: 'Reel: receta de pasta que sale mal a propósito', uploader: '@chaoschef', views: '890K', likes: '120K', duration: 31, reviewed: false, added: '2026-04-21' },
  { id: 5, url: 'https://youtube.com/watch?v=5',   platform: 'youtube',    title: 'Mr. Beast regala una isla por accidente', uploader: 'MrBeast', views: '12M', likes: '2.4M', duration: 720, reviewed: true, added: '2026-04-15' },
  { id: 6, url: 'https://tiktok.com/@user/video/6', platform: 'tiktok',    title: 'Bailecito que se vuelve guerra de almohadas', uploader: '@dancevibes', views: '3.2M', likes: '640K', duration: 18, reviewed: true, added: '2026-04-12' },
  { id: 7, url: 'https://x.com/user/status/7',     platform: 'twitter',    title: '"Mi jefe cuando le digo que ya está arreglado y no toco nada"', uploader: '@worktweets', views: '420K', likes: '52K', duration: null, reviewed: true, added: '2026-04-10' },
  { id: 8, url: 'https://tiktok.com/@user/video/8', platform: 'tiktok',    title: 'Receta de tortilla con piña genera divorcio', uploader: '@cookbeef', views: '1.8M', likes: '290K', duration: 44, reviewed: true, added: '2026-04-08' },
];

// Active session — full state for the big screen
const ACTIVE_SESSION = {
  id: 1,
  name: 'Review Abril',
  participants: [USERS[0], USERS[1], USERS[2]],
  current_index: 14,
  total: 32,
  current_meme: {
    id: 14,
    title: 'Cumpleañero recibe regalo y rompe a llorar de risa',
    platform: 'tiktok',
    uploader: '@birthdayfails',
    views: '3.8M',
    likes: '720K',
    comments: '14K',
    duration: 28,
    added_by: USERS[1],
    dup: 2,
  },
  votes_used: [3, 5, 7, 8, 9],          // ticks rojos en el slider
  my_vote: null,
  others_voted: [USERS[1].id],          // Leo ya votó
  cursors: [
    { user: USERS[1], x: 0.62, y: 0.45 },
    { user: USERS[2], x: 0.35, y: 0.72 },
  ],
  notepad: 'Brutal el momento del 0:14 jajaja\n— "yo no pedí esto" pero es mentira\n— Posible ganador del mes?',
  elapsed: '24:18',
};

// Rewind data
const REWIND = {
  year: 2025,
  total: 412,
  sessions: 12,
  top_platform: 'tiktok',
  best_meme: {
    title: 'Gato confundido en escaleras mecánicas',
    score: 9.6,
    platform: 'tiktok',
    session: 'Review Marzo',
  },
  by_platform: { tiktok: 248, twitter: 92, instagram: 48, youtube: 18, otro: 6 },
  by_month: [22, 28, 41, 32, 38, 29, 35, 42, 40, 33, 38, 34],
  monthsLabels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
  podium: [
    { rank: 1, title: 'Gato confundido en escaleras mecánicas', score: 9.6, session: 'Marzo' },
    { rank: 2, title: 'Niño pequeño grita "yo no fui"',         score: 9.4, session: 'Febrero' },
    { rank: 3, title: 'Mr. Beast empieza a llorar de la nada',  score: 9.2, session: 'Enero' },
  ],
};

// Finished session results — full ranking with top/bottom + per-user votes
const FINISHED_SESSION = {
  id: 3,
  name: 'Review Marzo',
  status: 'finished',
  finished_at: '2026-03-30T22:14:00',
  duration: '2h 14m',
  participants: [USERS[0], USERS[1], USERS[2], USERS[3]],
  total_memes: 41,
  avg_score: 6.3,
  top: [
    { rank: 1, title: 'Gato confundido en escaleras mecánicas', platform: 'tiktok', uploader: '@catvibes', avg: 9.6, added_by: USERS[1], votes: { 1: 10, 2: 9, 3: 10, 4: 9 }, playoff: false },
    { rank: 2, title: 'Niño grita "yo no fui" mirando a cámara', platform: 'tiktok', uploader: '@kidchaos', avg: 9.4, added_by: USERS[0], votes: { 1: 9, 2: 10, 3: 9, 4: 10 }, playoff: false },
    { rank: 3, title: 'Mr. Beast empieza a llorar de la nada', platform: 'youtube', uploader: 'MrBeast', avg: 9.0, added_by: USERS[2], votes: { 1: 9, 2: 9, 3: 9, 4: 9 }, playoff: true },
    { rank: 4, title: 'Tweet épico sobre el lunes a las 7am', platform: 'twitter', uploader: '@morningmood', avg: 8.8, added_by: USERS[1], votes: { 1: 8, 2: 9, 3: 9, 4: 9 } },
    { rank: 5, title: 'Receta caótica de pasta con piña', platform: 'instagram', uploader: '@chaoschef', avg: 8.5, added_by: USERS[3], votes: { 1: 8, 2: 9, 3: 8, 4: 9 } },
  ],
  bottom: [
    { rank: 41, title: 'Compilación de tropezones del 2014', platform: 'youtube', uploader: 'OldFails', avg: 1.8, added_by: USERS[3], votes: { 1: 2, 2: 1, 3: 2, 4: 2 } },
    { rank: 40, title: 'Pov: tú abriendo la nevera por décima vez', platform: 'tiktok', uploader: '@reltrend', avg: 2.4, added_by: USERS[2], votes: { 1: 3, 2: 2, 3: 2, 4: 2 } },
    { rank: 39, title: 'Hilo sobre por qué los lunes existen',     platform: 'twitter', uploader: '@philosotweet', avg: 2.8, added_by: USERS[0], votes: { 1: 3, 2: 3, 3: 2, 4: 3 } },
  ],
  // Heatmap data: full per-meme × per-user votes (sample of 18 memes)
  heatmap: [
    { rank: 1,  title: 'Gato confundido en escaleras mecánicas',  platform: 'tiktok',    votes: { 1: 10, 2: 9, 3: 10, 4: 9 } },
    { rank: 2,  title: 'Niño grita "yo no fui"',                  platform: 'tiktok',    votes: { 1: 9,  2: 10, 3: 9,  4: 10 } },
    { rank: 3,  title: 'Mr. Beast llora de la nada',              platform: 'youtube',   votes: { 1: 9,  2: 9,  3: 9,  4: 9 } },
    { rank: 4,  title: 'Tweet épico lunes 7am',                   platform: 'twitter',   votes: { 1: 8,  2: 9,  3: 9,  4: 9 } },
    { rank: 5,  title: 'Pasta con piña caótica',                  platform: 'instagram', votes: { 1: 8,  2: 9,  3: 8,  4: 9 } },
    { rank: 8,  title: 'Bailecito con almohadas',                 platform: 'tiktok',    votes: { 1: 7,  2: 8,  3: 8,  4: 7 } },
    { rank: 11, title: 'Receta tortilla con piña',                platform: 'tiktok',    votes: { 1: 8,  2: 6,  3: 7,  4: 7 } },
    { rank: 14, title: 'POV: programar a las 3am',                platform: 'twitter',   votes: { 1: 7,  2: 7,  3: 5,  4: 7 } },
    { rank: 17, title: 'Receta pasta caótica',                    platform: 'instagram', votes: { 1: 6,  2: 7,  3: 5,  4: 6 } },
    { rank: 20, title: 'Niño explica pizza piña',                 platform: 'tiktok',    votes: { 1: 6,  2: 6,  3: 5,  4: 6 } },
    { rank: 23, title: 'Mr. Beast regala isla',                   platform: 'youtube',   votes: { 1: 5,  2: 6,  3: 4,  4: 6 } },
    { rank: 26, title: 'Detective gato vs perro',                 platform: 'tiktok',    votes: { 1: 5,  2: 5,  3: 4,  4: 5 } },
    { rank: 29, title: 'Tweet jefe arreglar nada',                platform: 'twitter',   votes: { 1: 5,  2: 4,  3: 3,  4: 5 } },
    { rank: 32, title: 'Bailecito guerra almohadas',              platform: 'tiktok',    votes: { 1: 4,  2: 5,  3: 3,  4: 4 } },
    { rank: 35, title: 'Reel cocina mal hecho',                   platform: 'instagram', votes: { 1: 4,  2: 4,  3: 3,  4: 4 } },
    { rank: 39, title: 'Hilo lunes existir',                      platform: 'twitter',   votes: { 1: 3,  2: 3,  3: 2,  4: 3 } },
    { rank: 40, title: 'POV nevera décima vez',                   platform: 'tiktok',    votes: { 1: 3,  2: 2,  3: 2,  4: 2 } },
    { rank: 41, title: 'Tropezones 2014',                         platform: 'youtube',   votes: { 1: 2,  2: 1,  3: 2,  4: 2 } },
  ],
  by_user: [
    { user: USERS[0], submitted: 11, in_top5: 2, in_bottom3: 1, avg_given: 6.4, harshest: false, kindest: false },
    { user: USERS[1], submitted: 10, in_top5: 2, in_bottom3: 0, avg_given: 7.1, harshest: false, kindest: true },
    { user: USERS[2], submitted: 12, in_top5: 1, in_bottom3: 1, avg_given: 5.2, harshest: true,  kindest: false },
    { user: USERS[3], submitted: 8,  in_top5: 1, in_bottom3: 1, avg_given: 6.5, harshest: false, kindest: false },
  ],
  super_favs: 3,
  // Reaction emoji counts accumulated during session
  reactions: { '🔔': 18, '🎉': 42, '💩': 11, '👋': 6, '🍿': 87, '💀': 64, '🐒': 23 },
  // All votes flat — for density barcode (peor → mejor)
  all_votes: [1,1,2,2,2,2,3,3,3,3,3,3,3,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,10,10,10],
};

Object.assign(window, { USERS, CURRENT_USER, PLATFORMS, SESSIONS, MEMES, ACTIVE_SESSION, FINISHED_SESSION, REWIND });
