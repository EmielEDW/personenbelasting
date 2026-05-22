# Setup voor Examen-pack Personenbelasting (€9,99)

De code is gedeployed maar werkt enkel met de juiste env vars. Volg deze stappen.

> Tip: alles loopt parallel met je vennootschapsrecht-setup. Je kunt **dezelfde Resend API key, dezelfde Upstash KV instance en dezelfde HMAC secret** hergebruiken. Je hebt enkel een **nieuwe Stripe Payment Link** en een **andere `PB_UNUSED_CODES_KEY`** nodig.

---

## 1. Stripe — nieuwe Payment Link voor €9,99

1. Stripe Dashboard → **Products** → **Add product**
   - Name: `Examen-pack Personenbelasting`
   - Price: `€9,99` éénmalig
2. **Payment links** → Create payment link → select dit product
3. Kopieer de payment link URL (vorm: `https://buy.stripe.com/XXXXX`)
4. Open `auth.js` en vervang:
   ```js
   const STRIPE_URL = (window.__PB_STRIPE_URL__) || 'https://buy.stripe.com/REPLACE_WITH_YOUR_PAYMENT_LINK';
   ```
   met je echte URL. Of beter: zet hem in `index.html` vóór de `<script src="auth.js">`:
   ```html
   <script>window.__PB_STRIPE_URL__ = 'https://buy.stripe.com/JOUW_LINK';</script>
   ```

5. **Webhook** in Stripe:
   - Endpoint URL: `https://personenbelasting.vercel.app/api/stripe-webhook` (of jouw Vercel-domain)
   - Listen to: **`checkout.session.completed`**
   - Kopieer de **Signing secret** (`whsec_...`)

---

## 2. Upstash Redis (KV) — pool voor codes

Je kunt **dezelfde Upstash KV** als voor vennootschapsrecht gebruiken — het script gebruikt namespace `pb-*` voor alle keys, dus er is geen conflict.

Indien nog niet gekoppeld:
1. Vercel project `personenbelasting` → **Storage** → **Add Database** → **Upstash KV**
2. Connect de bestaande database (of maak een nieuwe)
3. Vercel injecteert automatisch `KV_REST_API_URL` en `KV_REST_API_TOKEN` als env vars

---

## 3. Resend — voor e-mail

Hergebruik je bestaande `RESEND_API_KEY` van vennootschapsrecht. Optioneel andere `FROM_EMAIL`:
```
FROM_EMAIL=Examen-pack PB <onboarding@resend.dev>
```

---

## 4. Env vars op Vercel

Vercel project `personenbelasting` → **Settings** → **Environment Variables**:

| Variable | Waarde | Voorbeeld |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | Stripe signing secret | `whsec_abc...` |
| `RESEND_API_KEY` | Resend API key | `re_xyz...` |
| `FROM_EMAIL` | Afzender e-mail | `Examen-pack PB <onboarding@resend.dev>` |
| `REPLY_TO_EMAIL` | Reply-to (jouw mail) | `info@emieldewaele.com` |
| `SITE_URL` | Productie URL | `https://personenbelasting.vercel.app` |
| `HMAC_SECRET` | Random secret (32+ chars) | run `openssl rand -base64 32` |
| `MAX_DEVICES` | Max apparaten/code | `3` |
| `TOKEN_TTL_DAYS` | Token geldigheid | `365` |
| `PB_UNUSED_CODES_KEY` | KV list key | `pb-unused-codes` |
| `KV_REST_API_URL` | Auto via Upstash integration | |
| `KV_REST_API_TOKEN` | Auto via Upstash integration | |

Na env vars wijzigen → **Redeploy** triggeren.

---

## 5. Codes pool seeden

Op je laptop:
```bash
cd /pad/naar/clone
export KV_REST_API_URL='https://...upstash.io'
export KV_REST_API_TOKEN='AY...'
python3 seed-codes.py
```

Dit pusht alle 100 codes uit `codes-private.txt` naar de KV list `pb-unused-codes`.

> `codes-private.txt` staat in `.gitignore` — wordt **niet** naar GitHub gepusht. Bewaar hem offline ook (1Password, USB, ...).

---

## 6. Testen

1. Open de site. Hoofdstuk 6 t/m 15 zouden afgeschermd moeten zijn met een paywall card.
2. Klik "💎 Ontgrendel — €9,99" → unlock modal opent.
3. Test code: pak één code uit `codes-private.txt`, plak in het invulveld → moet ontgrendelen.
4. Test Stripe in **test mode** eerst (Stripe → Developers → Test mode). Maak een test payment link, doe een test betaling, check of:
   - Webhook in Stripe dashboard wordt aangeroepen
   - Vercel functions logs tonen "✓ Sent PB code XXX to ...@..."
   - Je krijgt een e-mail met code (check ook spam)

Klaar voor live als test werkt → flip Stripe naar **live mode**, update env vars met live `STRIPE_WEBHOOK_SECRET` en live payment link.

---

## Belangrijke checks

- ✅ `codes-private.txt` is gitignored — push hem NIET
- ✅ `valid-codes.json` is wel public (bevat alleen hashes, geen leesbare codes)
- ✅ Het book PDF `Praktisch_Personenbelasting_2025.pdf` is gitignored
- ✅ Test telkens met **devtools open** dat de free chapters zichtbaar zijn maar ch 6-15 enkel content tonen na unlock
