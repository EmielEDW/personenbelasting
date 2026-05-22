// Client-side access control for the PB Examen-pack.
// Calls /api/unlock to validate code + track device count (max 3 per code).
//
// Public API exposed on window.PBAuth:
//   PBAuth.isUnlocked()        → bool
//   PBAuth.unlock(code)        → Promise<{ok, ...}>
//   PBAuth.lock()              → void
//   PBAuth.onChange(cb)        → unsubscribe()
//   PBAuth.openUnlockModal()   → opens the modal
//   PBAuth.closeUnlockModal()  → closes it
//   PBAuth.getSavedCode()      → last used code or ''

(function() {
  const STORAGE_KEY     = 'pb-pack-unlocked-v1';
  const STORAGE_CODE    = 'pb-pack-code-v1';
  const STORAGE_TOKEN   = 'pb-pack-token-v1';
  const STORAGE_DEVICE  = 'pb-pack-device-v1';

  // === Crypto helpers ===
  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Stable device fingerprint based on browser characteristics.
  async function computeDeviceId() {
    const cached = sessionStorage.getItem('pb-deviceid');
    if (cached) return cached;
    const parts = [
      navigator.userAgent || '',
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      navigator.language || '',
      String(navigator.hardwareConcurrency || 0),
      navigator.platform || '',
    ];
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 220; canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#6B2737';
      ctx.fillRect(0, 0, 220, 50);
      ctx.fillStyle = '#A87A1F';
      ctx.fillText('Examen-pack PB · 2026', 2, 2);
      ctx.fillStyle = 'rgba(93, 122, 90, 0.7)';
      ctx.fillText('Emiel ★', 4, 30);
      parts.push(canvas.toDataURL());
    } catch (e) {}
    const full = await sha256Hex(parts.join('|'));
    const id = full.slice(0, 16);
    sessionStorage.setItem('pb-deviceid', id);
    return id;
  }

  function normalize(code) {
    return (code || '').toUpperCase().replace(/[\s-]/g, '');
  }

  // === State ===
  function isUnlocked() { return localStorage.getItem(STORAGE_KEY) === '1'; }
  function getSavedCode() { return localStorage.getItem(STORAGE_CODE) || ''; }

  function setUnlocked(code, token, deviceId) {
    localStorage.setItem(STORAGE_KEY, '1');
    localStorage.setItem(STORAGE_CODE, normalize(code));
    if (token) localStorage.setItem(STORAGE_TOKEN, token);
    if (deviceId) localStorage.setItem(STORAGE_DEVICE, deviceId);
    _emit('unlock');
  }

  function lock() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_CODE);
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_DEVICE);
    _emit('lock');
  }

  // === API call ===
  async function unlock(code) {
    const norm = normalize(code);
    if (norm.length < 6) return { ok: false, reason: 'invalid', message: 'Code te kort.' };

    let deviceId;
    try { deviceId = await computeDeviceId(); }
    catch (e) { deviceId = 'unknown-' + Math.random().toString(36).slice(2, 10); }

    try {
      const r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: norm, deviceId }),
      });

      if (r.status === 403) {
        const data = await r.json().catch(() => ({}));
        if (data.error === 'device_limit') {
          return {
            ok: false, reason: 'device_limit',
            message: data.message || 'Deze code is al actief op het maximum aantal apparaten.',
            current: data.current, maxDevices: data.maxDevices,
          };
        }
        return { ok: false, reason: 'forbidden', message: data.message || data.error || 'Forbidden' };
      }
      if (r.status === 404) {
        return { ok: false, reason: 'invalid', message: 'Deze code is niet geldig. Check de spelling of mail mij.' };
      }
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return { ok: false, reason: 'error', message: data.error || `Server fout (${r.status})` };
      }
      const data = await r.json();
      setUnlocked(norm, data.token, deviceId);
      return {
        ok: true, devices: data.devices, maxDevices: data.maxDevices,
        isNewDevice: data.isNewDevice, degraded: data.degraded,
      };
    } catch (e) {
      return { ok: false, reason: 'network', message: 'Geen verbinding met de server. Probeer opnieuw of mail mij.' };
    }
  }

  // === Event bus ===
  const _listeners = new Set();
  function onChange(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
  function _emit(ev) { _listeners.forEach(cb => { try { cb(ev); } catch (e) {} }); }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) _emit(e.newValue === '1' ? 'unlock' : 'lock');
  });

  // === Unlock modal ===
  const STRIPE_URL = (window.__PB_STRIPE_URL__) || 'https://buy.stripe.com/cNidR874R6pM9I8aR0d3i01';
  const PRICE_TAG = '€9,99';

  function buildModal() {
    if (document.getElementById('pbUnlockModal')) return;
    const html = `
<div class="pb-unlock-modal" id="pbUnlockModal" hidden role="dialog" aria-labelledby="pbUnlockTitle">
  <div class="pb-unlock-backdrop" data-unlock-close></div>
  <div class="pb-unlock-content">
    <button class="pb-unlock-close" data-unlock-close aria-label="Sluiten">✕</button>
    <div class="pb-unlock-badge">💎 EXAMEN-PACK</div>
    <h2 id="pbUnlockTitle">Ontgrendel de volledige samenvatting</h2>
    <p class="pb-unlock-lead">Hoofdstukken 1 t/m 5 zijn gratis. Wil je ook hoofdstuk 6 t/m 15 (beroepskosten, OI, zelfstandigen, woningfiscaliteit, …) <strong>én</strong> alle bijhorende cursusdocumenten? Dat zit allemaal in het Examen-pack.</p>
    <ul class="pb-unlock-features">
      <li><strong>Alle 15 hoofdstukken</strong> — gratis: ch 1-5 · pack: alles</li>
      <li><strong>Alle cursusdocumenten</strong> — gratis: docs van ch 1-3 · pack: alle slides, oplossingen & oefeningen</li>
      <li><strong>Alle flashcards</strong> — gratis: ch 1-5 · pack: alle hoofdstukken</li>
      <li>Eenmalige betaling · toegang voor altijd</li>
    </ul>
    <div class="pb-unlock-actions">
      <a class="pb-unlock-buy" id="pbUnlockBuyBtn" href="${STRIPE_URL}" target="_blank" rel="noopener">
        <span class="pb-price">${PRICE_TAG}</span>
        <span class="pb-buy-label">Koop nu via Stripe →</span>
      </a>
      <div class="pb-unlock-divider"><span>of</span></div>
      <form class="pb-unlock-form" id="pbUnlockForm">
        <label for="pbUnlockInput">Heb je al een toegangscode?</label>
        <div class="pb-unlock-input-row">
          <input type="text" id="pbUnlockInput" placeholder="bv. AB12-CD34" autocomplete="off" maxlength="20">
          <button type="submit">Ontgrendel</button>
        </div>
        <div class="pb-unlock-feedback" id="pbUnlockFeedback"></div>
      </form>
    </div>
    <p class="pb-unlock-footer">
      Na betaling krijg je <strong>automatisch je code per mail</strong> (check ook je <strong>spam-folder</strong>!).<br>
      Code werkt op max 3 apparaten · Limit bereikt? Mail <a href="mailto:info@emieldewaele.com">info@emieldewaele.com</a>.
    </p>
  </div>
</div>`;
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);

    const modal = document.getElementById('pbUnlockModal');
    modal.addEventListener('click', (e) => {
      if (e.target.matches('[data-unlock-close]')) closeModal();
    });
    document.getElementById('pbUnlockForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('pbUnlockInput');
      const fb = document.getElementById('pbUnlockFeedback');
      const code = input.value.trim();
      if (!code) return;
      fb.textContent = 'Bezig met activeren…';
      fb.className = 'pb-unlock-feedback';

      const result = await unlock(code);

      if (result.ok) {
        const devInfo = result.maxDevices
          ? ` (${result.devices}/${result.maxDevices} apparaten)`
          : '';
        fb.innerHTML = `✓ Code geactiveerd${devInfo}. Pagina herlaadt…`;
        fb.className = 'pb-unlock-feedback ok';
        setTimeout(() => { closeModal(); window.location.reload(); }, 1100);
      } else if (result.reason === 'device_limit') {
        fb.innerHTML = `⚠ ${result.message}`;
        fb.className = 'pb-unlock-feedback err';
      } else if (result.reason === 'network') {
        fb.innerHTML = `✗ ${result.message}`;
        fb.className = 'pb-unlock-feedback err';
      } else {
        fb.textContent = '✗ ' + (result.message || 'Code niet geldig.');
        fb.className = 'pb-unlock-feedback err';
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  function openModal() {
    buildModal();
    document.getElementById('pbUnlockModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const i = document.getElementById('pbUnlockInput');
      if (i) i.focus();
    }, 50);
  }
  function closeModal() {
    const m = document.getElementById('pbUnlockModal');
    if (m) m.hidden = true;
    document.body.style.overflow = '';
  }

  // Open modal on any [data-open-unlock] click
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-unlock]');
    if (t) { e.preventDefault(); openModal(); }
  });

  window.PBAuth = {
    isUnlocked, unlock, lock, onChange,
    openUnlockModal: openModal, closeUnlockModal: closeModal,
    getSavedCode, computeDeviceId,
  };

  // Auto-unlock via ?code=XYZ URL param
  document.addEventListener('DOMContentLoaded', () => {
    const url = new URL(window.location.href);
    const codeParam = url.searchParams.get('code');
    if (codeParam && !isUnlocked()) {
      openModal();
      setTimeout(() => {
        const input = document.getElementById('pbUnlockInput');
        if (input) input.value = codeParam;
        url.searchParams.delete('code');
        history.replaceState({}, '', url.toString());
        const form = document.getElementById('pbUnlockForm');
        if (form) form.dispatchEvent(new Event('submit'));
      }, 200);
    }
  });
})();
