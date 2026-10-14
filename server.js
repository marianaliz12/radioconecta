'use strict';
// RadioConecta TIC · servidor (Express). Sirve la página, autentica (admin / solicitante),
// guarda los datos de cada usuario y hace de proxy seguro hacia la API de Anthropic.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SYSTEM_PROMPT } = require('./lib/prompt');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data-runtime'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- secretos y cuentas iniciales ----------
function rand(n) { return crypto.randomBytes(n).toString('base64url'); }
const SECRET = process.env.SESSION_SECRET || (PROD ? rand(32) : 'dev-secret-no-usar-en-produccion');
if (PROD && !process.env.SESSION_SECRET) console.warn('[aviso] Falta SESSION_SECRET: las sesiones se cerrarán en cada reinicio.');

function seedAccount(label, userEnv, passEnv, defUser, devPass) {
  const user = (process.env[userEnv] || defUser).toLowerCase();
  let pass = process.env[passEnv];
  let generated = false;
  if (!pass) { pass = PROD ? rand(9) : devPass; generated = PROD; }
  return { label, user, pass, generated };
}
const SEEDS = [
  { role: 'admin', name: 'Administrador', ...seedAccount('Administrador', 'ADMIN_USER', 'ADMIN_PASSWORD', 'admin', 'admin1234') },
  { role: 'solicitante', name: 'Solicitante de prueba', ...seedAccount('Solicitante', 'SOLICITANTE_USER', 'SOLICITANTE_PASSWORD', 'solicitante', 'solicitante1234') }
];

// ---------- almacenamiento en archivos JSON ----------
function file(name) { return path.join(DATA_DIR, name); }
function readJson(name, def) { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) { return def; } }
function writeJson(name, obj) {
  const tmp = file(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file(name));
}
let users = readJson('users.json', {});     // { usuario: {name, role, salt, hash} }
let store = readJson('store.json', {});     // { usuario: {tasks, field, profile, docs, inc, acts} }
let stations = readJson('stations.json', null); // emisoras compartidas (las administra el admin)

function hashPass(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }
function setUser(user, name, role, pass) {
  const salt = rand(12);
  users[user] = { name, role, salt, hash: hashPass(pass, salt) };
}
function checkPass(u, pass) {
  const a = Buffer.from(hashPass(String(pass), u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Las cuentas iniciales se vuelven a crear en cada arranque con las claves de las variables de entorno.
SEEDS.forEach(s => { setUser(s.user, s.name, s.role, s.pass); });
writeJson('users.json', users);
if (!stations) { stations = require('./lib/stations-seed'); writeJson('stations.json', stations); }

// ---------- sesiones: cookie firmada (sin estado en el servidor) ----------
const COOKIE = 'rc_session';
const TTL_MS = 12 * 3600 * 1000;
function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url'); }
function makeToken(user, role) {
  const p = Buffer.from(JSON.stringify({ u: user, r: role, e: Date.now() + TTL_MS })).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [p, s] = tok.split('.');
  const good = sign(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (d.e < Date.now() || !users[d.u]) return null;
    return { user: d.u, role: users[d.u].role, name: users[d.u].name };
  } catch (e) { return null; }
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '300kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use((req, res, next) => { req.session = readToken(cookies(req)[COOKIE]); next(); });

function needAuth(req, res, next) { if (!req.session) return res.status(401).json({ error: 'Inicia sesión.' }); next(); }
function needAdmin(req, res, next) { if (!req.session || req.session.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador.' }); next(); }
function setSessionCookie(req, res, user, role) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(makeToken(user, role)) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (TTL_MS / 1000) + (secure ? '; Secure' : ''));
}

// freno simple a intentos de acceso por IP
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(), a = (attempts.get(ip) || []).filter(t => now - t < 600000);
  attempts.set(ip, a);
  return a.length >= 10;
}
function failed(ip) { const a = attempts.get(ip) || []; a.push(Date.now()); attempts.set(ip, a); }

// ---------- autenticación ----------
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  const user = String((req.body || {}).user || '').trim().toLowerCase();
  const pass = String((req.body || {}).pass || '');
  const u = users[user];
  if (!u || !checkPass(u, pass)) { failed(ip); return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' }); }
  setSessionCookie(req, res, user, u.role);
  res.json({ user, name: u.name, role: u.role });
});
app.post('/api/register', (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  const user = String((req.body || {}).user || '').trim().toLowerCase();
  const pass = String((req.body || {}).pass || '');
  const name = String((req.body || {}).name || user).trim().slice(0, 60);
  if (!/^[a-z0-9_.-]{3,30}$/.test(user)) return res.status(400).json({ error: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.' });
  if (pass.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (users[user]) { failed(ip); return res.status(409).json({ error: 'Ese usuario ya existe.' }); }
  setUser(user, name || user, 'solicitante', pass);
  writeJson('users.json', users);
  failed(ip); // también limita el registro masivo
  setSessionCookie(req, res, user, 'solicitante');
  res.json({ user, name: name || user, role: 'solicitante' });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  if (!req.session) return res.json({ user: null });
  res.json({ user: req.session.user, name: req.session.name, role: req.session.role });
});

// ---------- datos del usuario ----------
const KEYS = ['tasks', 'field', 'profile', 'docs', 'inc', 'acts'];
app.get('/api/data', needAuth, (req, res) => res.json(store[req.session.user] || {}));
app.put('/api/data', needAuth, (req, res) => {
  const body = req.body || {};
  const cur = store[req.session.user] || {};
  for (const k of KEYS) {
    if (body[k] === undefined) continue;
    if (body[k] === null) { delete cur[k]; continue; }
    const s = typeof body[k] === 'string' ? body[k] : JSON.stringify(body[k]);
    if (s.length > 120000) return res.status(413).json({ error: 'Datos demasiado grandes: ' + k });
    cur[k] = s;
  }
  store[req.session.user] = cur;
  writeJson('store.json', store);
  res.json({ ok: true });
});

// ---------- emisoras compartidas del mapa ----------
function cleanStation(s, i) {
  const num = (v, a, b, d) => { v = Number(v); return isFinite(v) && v >= a && v <= b ? v : d; };
  const str = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n);
  const cat = ['comunitaria', 'comercial', 'interes'].includes(s.category) ? s.category : 'comunitaria';
  return {
    id: str(s.id || ('st-' + Date.now().toString(36) + i), 40).replace(/[^\w.-]/g, '_'),
    name: str(s.name, 80), category: cat, freq: str(s.freq, 20),
    lat: s.lat === null || s.lat === undefined ? null : num(s.lat, -90, 90, null),
    lng: s.lng === null || s.lng === undefined ? null : num(s.lng, -180, 180, null),
    power: num(s.power, 0, 200000, cat === 'comunitaria' ? 250 : 1000),
    height: num(s.height, 0, 500, 30),
    verified: !!s.verified, source: str(s.source, 120), note: str(s.note, 300)
  };
}
app.get('/api/stations', needAuth, (req, res) => res.json(stations));
app.put('/api/stations', needAdmin, (req, res) => {
  const list = (req.body || {}).stations;
  if (!Array.isArray(list) || list.length > 500) return res.status(400).json({ error: 'Lista de emisoras no válida.' });
  stations = list.map(cleanStation).filter(s => s.name);
  writeJson('stations.json', stations);
  res.json({ ok: true, count: stations.length });
});

// ---------- vista del administrador ----------
app.get('/api/admin/radios', needAdmin, (req, res) => {
  const out = Object.keys(users).filter(u => users[u].role === 'solicitante').map(u => ({ user: u, name: users[u].name, data: store[u] || {} }));
  res.json(out);
});
app.delete('/api/admin/users/:u', needAdmin, (req, res) => {
  const u = String(req.params.u).toLowerCase();
  if (!users[u] || users[u].role !== 'solicitante') return res.status(404).json({ error: 'No existe ese solicitante.' });
  if (SEEDS.some(s => s.user === u)) return res.status(400).json({ error: 'La cuenta de prueba se recrea en cada arranque; cambia su clave en las variables de entorno.' });
  delete users[u]; delete store[u];
  writeJson('users.json', users); writeJson('store.json', store);
  res.json({ ok: true });
});


 // ---------- asistente educativo con Google Gemini ----------
const chatHits = new Map();

app.post('/api/chat', needAuth, async (req, res) => {
  try {
    const messages = (req.body || {}).messages;

    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({
        error: 'Falta el historial de mensajes.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'Falta configurar GEMINI_API_KEY en Render.'
      });
    }

    const now = Date.now();
    const hits = (chatHits.get(req.session.user) || [])
      .filter(t => now - t < 3600000);

    if (hits.length >= 60) {
      return res.status(429).json({
        error: 'Límite de 60 mensajes por hora alcanzado.'
      });
    }

    hits.push(now);
    chatHits.set(req.session.user, hits);

    const trimmed = messages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{
        text: String(m.content || '').slice(0, 4000)
      }]
    }));

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: trimmed,
          generationConfig: {
            maxOutputTokens: 1500,
            temperature: 0.4
          }
        })
      }
    );

    if (!response.ok) {
      console.error('Gemini:', response.status, await response.text());

      return res.status(502).json({
        error: 'No se pudo obtener respuesta de Gemini. Revisa los registros del servidor.'
      });
    }

    const data = await response.json();

    const reply = (data.candidates || [])
      .flatMap(c => (c.content && c.content.parts) || [])
      .map(p => p.text || '')
      .join('\n')
      .trim();

    res.json({
      reply: reply || 'No obtuve una respuesta. Intenta reformular tu pregunta.'
    });

  } catch (error) {
    console.error('Error en Gemini:', error);

    res.status(500).json({
      error: 'Error interno del asistente.'
    });
  }
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: PROD ? '1h' : 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('RadioConecta TIC escuchando en el puerto ' + PORT + ' · datos en ' + DATA_DIR);
    SEEDS.forEach(s => console.log('Cuenta ' + s.label + ': usuario "' + s.user + '"' + (s.generated ? ' · contraseña GENERADA (cambia en cada reinicio si no la defines): ' + s.pass : (process.env[s.label === 'Administrador' ? 'ADMIN_PASSWORD' : 'SOLICITANTE_PASSWORD'] ? ' · contraseña definida en variables de entorno' : ' · contraseña de desarrollo: ' + s.pass))));
  });
}
module.exports = app;
