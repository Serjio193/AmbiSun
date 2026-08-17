# AmbiSun Translation Proxy (Cloudflare Worker)

This directory contains the production-ready **Cloudflare Worker** translation proxy for the AmbiSun webOS application.

The proxy connects to the official **Azure Translator REST API (v3.0)**, handling language discovery and on-demand JSON locale translation while keeping API credentials strictly secret.

---

## 1. Security Architecture

- **No Secrets on Client Devices**: LG webOS TVs never hold Azure API keys or credentials.
- **Strict Endpoint Surface**: Only two endpoints are exposed: `GET /languages` and `POST /translate-locale`. All other paths/methods return `404` or `405`.
- **JSON Key Integrity**: JSON structure and property keys are flattened, text values are translated in batches, and the exact tree structure is rebuilt without translating object keys.
- **Prototype Pollution Protection**: Keys matching `__proto__`, `prototype`, and `constructor` are strictly blocked.
- **Cloudflare Rate Limiting Binding**: Distributed rate limiting enforced via official Cloudflare Workers Rate Limiting (`env.TRANSLATION_RATE_LIMITER`):
  - **Limit**: 30 translation requests per 60 seconds per IP (`CF-Connecting-IP`).
  - **Fail-Closed**: If the rate limiting binding is unconfigured, requests fail closed with `503 RATE_LIMIT_UNAVAILABLE` rather than allowing unthrottled upstream access.
  - **IP Spoofing Protection**: `x-real-ip` and client headers are never trusted; only Cloudflare's verified `CF-Connecting-IP` is used.
- **Edge Caching**:
  - `GET /languages`: Cached at Cloudflare edge for 24 hours (`s-maxage=86400`).
  - `POST /translate-locale`: Cached by SHA-256 hash of canonical request for 7 days (`s-maxage=604800`).

---

## 2. API Contract

### `GET /languages`
Returns translation-capable languages supported by Azure (excluding built-in `en`, `et`, `uk`, `ru`):

```json
{
  "languages": [
    {
      "code": "de",
      "name": "German",
      "nativeName": "Deutsch",
      "dir": "ltr"
    },
    {
      "code": "ar",
      "name": "Arabic",
      "nativeName": "العربية",
      "dir": "rtl"
    }
  ]
}
```

### `POST /translate-locale`
Translates an English JSON dictionary into the target language while preserving key names:

**Request:**
```json
{
  "source": "en",
  "target": "de",
  "locale": {
    "nav": {
      "home": "Home",
      "sources": "Sources & apps"
    }
  }
}
```

**Response:**
```json
{
  "language": "de",
  "dir": "ltr",
  "locale": {
    "nav": {
      "home": "Startseite",
      "sources": "Quellen & Apps"
    }
  }
}
```

---

## 3. Rate Limiting Configuration (`wrangler.jsonc`)

The worker uses Cloudflare Workers native rate limiting:

```jsonc
{
  "name": "ambisun-translation-proxy",
  "main": "src/index.js",
  "compatibility_date": "2024-04-01",
  "compatibility_flags": [
    "nodejs_compat"
  ],
  "ratelimits": [
    {
      "binding": "TRANSLATION_RATE_LIMITER",
      "namespace_id": "1001",
      "simple": {
        "limit": 30,
        "period": 60
      }
    }
  ]
}
```

---

## 4. Deployment Instructions

### Prerequisites
1. [Node.js](https://nodejs.org/) (v16+)
2. [Cloudflare Account](https://dash.cloudflare.com/)
3. [Azure Translator](https://portal.azure.com/) resource (Cognitive Services)

### Step 1: Install Dependencies
```bash
cd translation-proxy
npm install
```

### Step 2: Authenticate Wrangler with Cloudflare
```bash
npx wrangler login
```

### Step 3: Configure Cloudflare Worker Secrets
Store your Azure Translator subscription key and region securely in Cloudflare:

```bash
# Set Azure Translator API Key
npx wrangler secret put AZURE_TRANSLATOR_KEY

# Set Azure Translator Region (e.g. westeurope, eastus, or global)
npx wrangler secret put AZURE_TRANSLATOR_REGION
```

*(Optional: If using a custom endpoint instead of default `https://api.cognitive.microsofttranslator.com`)*:
```bash
npx wrangler secret put AZURE_TRANSLATOR_ENDPOINT
```

### Step 4: Deploy to Cloudflare
```bash
npx wrangler deploy
```

Once deployed, Wrangler will output your worker URL (e.g. `https://ambisun-translation-proxy.<your-subdomain>.workers.dev`).

---

## 5. Local Development & Testing

```bash
# 1. Create local development variables file
cp .dev.vars.example .dev.vars

# 2. Edit .dev.vars with your development key (never commit .dev.vars!)

# 3. Run test suite
npm test

# 4. Start local development worker
npm run dev
```
