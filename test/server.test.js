'use strict';
// Prueba rápida de la API: node test/server.test.js
process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/rc-');
process.env.ADMIN_PASSWORD = 'admin-test-1'; process.env.SOLICITANTE_PASSWORD = 'solic-test-1';
const assert = require('assert');
const app = require('../server');
const srv = app.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (path, o = {}, cookie) => {
    const r = await fetch(base + path, Object.assign({ headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}) }, o));
    const sc = r.headers.get('set-cookie'); let d = null; try { d = await r.json(); } catch (e) {}
    return { s: r.status, d, c: sc ? sc.split(';')[0] : null };
  };
  const login = (u, p) => call('/api/login', { method: 'POST', body: JSON.stringify({ user: u, pass: p }) });
  try {
    assert.strictEqual((await login('admin', 'mala')).s, 401);
    const a = await login('admin', 'admin-test-1'); assert.strictEqual(a.d.role, 'admin');
    const s = await login('solicitante', 'solic-test-1'); assert.strictEqual(s.d.role, 'solicitante');
    assert.strictEqual((await call('/api/admin/radios', {}, s.c)).s, 403);
    assert.strictEqual((await call('/api/admin/radios', {}, a.c)).s, 200);
    assert.strictEqual((await call('/api/data', {})).s, 401);
    assert.strictEqual((await call('/api/data', { method: 'PUT', body: JSON.stringify({ profile: '{"name":"X"}' }) }, s.c)).s, 200);
    assert.strictEqual((await call('/api/data', {}, s.c)).d.profile, '{"name":"X"}');
    assert.strictEqual((await call('/api/stations', { method: 'PUT', body: JSON.stringify({ stations: [{ name: 'Y', freq: '90.1' }] }) }, s.c)).s, 403);
    assert.strictEqual((await call('/api/stations', { method: 'PUT', body: JSON.stringify({ stations: [{ name: 'Y', freq: '90.1', lat: 7.07, lng: -73.17 }] }) }, a.c)).d.count, 1);
    const n = await call('/api/register', { method: 'POST', body: JSON.stringify({ user: 'nuevo1', pass: 'clave1234', name: 'N' }) });
    assert.strictEqual(n.d.role, 'solicitante');
    assert.strictEqual((await call('/api/register', { method: 'POST', body: JSON.stringify({ user: 'ab', pass: 'clave1234' }) })).s, 400);
    assert.strictEqual((await call('/api/me', {}, n.c)).d.user, 'nuevo1');
    console.log('API: todas las pruebas pasaron'); srv.close(); process.exit(0);
  } catch (e) { console.error('FALLÓ', e); srv.close(); process.exit(1); }
});
