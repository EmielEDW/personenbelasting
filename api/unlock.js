// Serverless function: validate access code + track device count via Upstash KV.
// Returns a signed HMAC token on success.
//
// Endpoint: POST /api/unlock
// Body: { code: "XXXXXXXX", deviceId: "16-char-hex" }
// Returns:
//   200 { ok: true, token, devices: N, maxDevices: 3 }
//   400 { error }
//   403 { error: "device_limit", message, current, maxDevices }
//   404 { error: "Code niet geldig" }
//   500 { error: "server error" }

const { createHash, createHmac } = require('crypto');
const path = require('path');
const fs = require('fs');

const VALID_CODES_PATH = path.join(__dirname, '..', 'valid-codes.json');
let validCodesData = { salt: '', hashes: [] };
try {
  validCodesData = JSON.parse(fs.readFileSync(VALID_CODES_PATH, 'utf-8'));
} catch (e) {
  console.error('Failed to load valid-codes.json:', e);
}

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const HMAC_SECRET = process.env.HMAC_SECRET || 'fallback-please-change-this';
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES || '3', 10);
const TOKEN_TTL_DAYS = parseInt(process.env.TOKEN_TTL_DAYS || '365', 10);

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }
function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signToken(payload) {
  const json = JSON.stringify(payload);
  const body = base64url(json);
  const sig = base64url(createHmac('sha256', HMAC_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data.result) return null;
    if (typeof data.result === 'string') {
      try { return JSON.parse(data.result); } catch (e) { return data.result; }
    }
    return data.result;
  } catch (e) { console.error('KV get error:', e); return null; }
}

async function kvSet(key, val) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(val),
    });
    return r.ok;
  } catch (e) { console.error('KV set error:', e); return false; }
}

function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const code = normalizeCode(body.code);
  const deviceId = String(body.deviceId || '').slice(0, 64);

  if (!code || !deviceId) return res.status(400).json({ error: 'Geef een code én device-ID mee.' });
  if (code.length < 6) return res.status(400).json({ error: 'Code is te kort.' });

  const codeHash = sha256(validCodesData.salt + code);
  if (!validCodesData.hashes.includes(codeHash)) {
    return res.status(404).json({ error: 'Deze code is niet geldig.' });
  }

  // Degraded mode (no KV)
  if (!KV_URL || !KV_TOKEN) {
    console.warn('KV not configured; running in degraded mode (no device limit).');
    const exp = Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
    const token = signToken({ ch: codeHash, did: deviceId, exp });
    return res.status(200).json({ ok: true, token, devices: 1, maxDevices: MAX_DEVICES, degraded: true });
  }

  const key = `pb:code:${codeHash}`;
  let devices = (await kvGet(key)) || [];
  if (!Array.isArray(devices)) devices = [];

  const existing = devices.find(d => d && d.id === deviceId);
  let isNewDevice = false;
  if (!existing) {
    if (devices.length >= MAX_DEVICES) {
      return res.status(403).json({
        error: 'device_limit',
        message: `Deze code is al actief op ${devices.length} apparaten (max ${MAX_DEVICES}). Mail info@emieldewaele.com om een reset te vragen.`,
        current: devices.length, maxDevices: MAX_DEVICES,
      });
    }
    devices.push({ id: deviceId, ts: Date.now() });
    isNewDevice = true;
    await kvSet(key, devices);
  } else {
    existing.lastSeen = Date.now();
    await kvSet(key, devices);
  }

  const exp = Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const token = signToken({ ch: codeHash, did: deviceId, exp });
  return res.status(200).json({ ok: true, token, devices: devices.length, maxDevices: MAX_DEVICES, isNewDevice });
};
