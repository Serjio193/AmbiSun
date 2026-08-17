/**
 * AmbiSun Translation Proxy - Cloudflare Worker
 * 
 * Secure on-demand translation proxy for AmbiSun webOS application.
 * Integrates with Azure Translator API v3.0 while keeping credentials strictly secret.
 */

const DEFAULT_AZURE_ENDPOINT = "https://api.cognitive.microsofttranslator.com";
const AZURE_API_VERSION = "3.0";
const BUILTIN_LANGUAGES = new Set(['en', 'et', 'uk', 'ru']);
const MAX_BODY_BYTES = 262144; // 256 KB
const MAX_OBJECT_DEPTH = 10;
const MAX_STRING_COUNT = 1000;
const MAX_STRING_LENGTH = 5000;
const MAX_LANGUAGES_COUNT = 500;
const MAX_NAME_LENGTH = 100;
const AZURE_BATCH_SIZE = 50;
const LANG_CODE_REGEX = /^[a-z]{2,3}(-[a-z0-9]+)?$/i;
const DISALLOWED_PROPS = new Set(['__proto__', 'prototype', 'constructor']);

// Known RTL language codes
const RTL_LANGUAGES = new Set([
  'ar', 'arc', 'bcc', 'bqi', 'ckb', 'dv', 'fa', 'glk', 'he', 'iw',
  'ku', 'mzn', 'pnb', 'ps', 'sd', 'ug', 'ur', 'yi'
]);

// Rate limiter: 30 requests per minute per IP for translation endpoint
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 30;

function checkRateLimit(ip) {
  if (!ip) return true;
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitMap.set(ip, entry);
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}

// Periodic cleanup of rate limit map
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt + 60000) {
      rateLimitMap.delete(ip);
    }
  }
}, 300000);
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function jsonResponse(data, status = 200, headers = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(defaultHeaders, headers)
  });
}

function jsonError(errorCode, errorText, status = 400) {
  return jsonResponse({
    returnValue: false,
    errorCode,
    errorText
  }, status);
}

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function hasDisallowedKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (DISALLOWED_PROPS.has(key)) return true;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasDisallowedKeys(obj[key])) return true;
    }
  }
  return false;
}

function flattenLocale(obj, path = [], depth = 0, collector = []) {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new Error("MAX_DEPTH_EXCEEDED");
  }

  for (const key of Object.getOwnPropertyNames(obj)) {
    if (DISALLOWED_PROPS.has(key)) {
      throw new Error("DISALLOWED_PROPERTY_KEY: " + key);
    }

    const currentPath = path.concat(key);
    const value = obj[key];

    if (isPlainObject(value)) {
      flattenLocale(value, currentPath, depth + 1, collector);
    } else if (typeof value === 'string') {
      if (collector.length >= MAX_STRING_COUNT) {
        throw new Error("MAX_STRING_COUNT_EXCEEDED");
      }
      if (value.length > MAX_STRING_LENGTH) {
        throw new Error("MAX_STRING_LENGTH_EXCEEDED");
      }
      collector.push({
        path: currentPath,
        text: value
      });
    }
  }

  return collector;
}

function rebuildLocale(templateObj, flattenedWithTranslations) {
  const result = JSON.parse(JSON.stringify(templateObj));

  for (const item of flattenedWithTranslations) {
    let current = result;
    for (let i = 0; i < item.path.length - 1; i++) {
      const segment = item.path[i];
      if (!current[segment] || typeof current[segment] !== 'object') {
        current[segment] = {};
      }
      current = current[segment];
    }
    const leafKey = item.path[item.path.length - 1];
    current[leafKey] = item.translatedText !== undefined ? item.translatedText : item.text;
  }

  return result;
}

async function sha256(str) {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash('sha256').update(str, 'utf8').digest('hex');
  } catch (_) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Handle GET /languages
 */
async function handleLanguages(request, env, ctx) {
  if (request.method !== 'GET') {
    return jsonError("METHOD_NOT_ALLOWED", "Method not allowed for /languages", 405);
  }

  // Check Cloudflare Cache API if available
  const cacheKey = new Request("https://ambisun-proxy.internal/languages-v1", { method: 'GET' });
  let cache = null;
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      cache = caches.default;
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
  } catch (_) {}

  const baseEndpoint = (env.AZURE_TRANSLATOR_ENDPOINT || DEFAULT_AZURE_ENDPOINT).replace(/\/+$/, '');
  const targetUrl = `${baseEndpoint}/languages?api-version=${AZURE_API_VERSION}&scope=translation`;

  let azureResponse;
  try {
    azureResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AmbiSun-TranslationProxy/1.0'
      }
    });
  } catch (err) {
    return jsonError("TRANSLATION_PROVIDER_ERROR", "Failed to connect to translation backend", 502);
  }

  if (!azureResponse.ok) {
    return jsonError("TRANSLATION_PROVIDER_ERROR", `Translation backend returned HTTP ${azureResponse.status}`, 502);
  }

  let data;
  try {
    data = await azureResponse.json();
  } catch (_) {
    return jsonError("TRANSLATION_PROVIDER_ERROR", "Invalid JSON from translation backend", 502);
  }

  if (!data || !data.translation || typeof data.translation !== 'object') {
    return jsonError("TRANSLATION_PROVIDER_ERROR", "Unexpected structure from translation backend", 502);
  }

  const validLanguages = [];
  const entries = Object.entries(data.translation);

  for (const [code, info] of entries) {
    const cleanCode = code.trim().toLowerCase();
    if (!LANG_CODE_REGEX.test(cleanCode)) continue;
    if (BUILTIN_LANGUAGES.has(cleanCode)) continue; // Filter out built-in languages (en, et, uk, ru)

    const sanitizedName = sanitizeString(info.name) || cleanCode;
    const sanitizedNative = sanitizeString(info.nativeName) || sanitizedName;
    const isRtl = (info.dir === 'rtl') || RTL_LANGUAGES.has(cleanCode);

    validLanguages.push({
      code: cleanCode,
      name: sanitizedName,
      nativeName: sanitizedNative,
      dir: isRtl ? 'rtl' : 'ltr'
    });

    if (validLanguages.length >= MAX_LANGUAGES_COUNT) break;
  }

  validLanguages.sort((a, b) => a.name.localeCompare(b.name));

  const responseObj = {
    languages: validLanguages
  };

  const finalResponse = jsonResponse(responseObj, 200, {
    'Cache-Control': 'public, max-age=86400, s-maxage=86400'
  });

  if (cache && ctx && ctx.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  }

  return finalResponse;
}

/**
 * Handle POST /translate-locale
 */
async function handleTranslateLocale(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonError("METHOD_NOT_ALLOWED", "Method not allowed for /translate-locale", 405);
  }

  // 1. Rate Limiting Check
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return jsonError("RATE_LIMITED", "Too many translation requests. Please slow down.", 429);
  }

  // 2. Content-Type check
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonError("INVALID_REQUEST", "Content-Type must be application/json", 400);
  }

  // 3. Body Size Check
  const bodyBuffer = await request.arrayBuffer();
  if (bodyBuffer.byteLength > MAX_BODY_BYTES) {
    return jsonError("REQUEST_TOO_LARGE", `Request exceeds maximum size of ${MAX_BODY_BYTES} bytes`, 413);
  }

  const bodyText = new TextDecoder('utf-8').decode(bodyBuffer);
  let parsedBody;
  try {
    parsedBody = JSON.parse(bodyText, (key, value) => {
      if (DISALLOWED_PROPS.has(key)) {
        throw new Error("DISALLOWED_KEY");
      }
      return value;
    });
  } catch (_) {
    return jsonError("INVALID_REQUEST", "Malformed JSON body or disallowed property key", 400);
  }

  if (!isPlainObject(parsedBody)) {
    return jsonError("INVALID_REQUEST", "Request body must be a JSON object", 400);
  }

  // 4. Validate source, target, and locale
  const source = String(parsedBody.source || '').trim().toLowerCase();
  if (source !== 'en') {
    return jsonError("INVALID_REQUEST", "Only 'en' is supported as source language", 400);
  }

  const target = String(parsedBody.target || '').trim().toLowerCase();
  if (!target || !LANG_CODE_REGEX.test(target)) {
    return jsonError("INVALID_LANGUAGE", "Invalid target language code format", 400);
  }
  if (target === 'en') {
    return jsonError("INVALID_LANGUAGE", "Target language cannot be 'en'", 400);
  }

  const locale = parsedBody.locale;
  if (!isPlainObject(locale)) {
    return jsonError("INVALID_REQUEST", "Field 'locale' must be a plain JSON object", 400);
  }

  // Disallow prototype pollution keys
  if (hasDisallowedKeys(locale)) {
    return jsonError("INVALID_REQUEST", "Disallowed object property key detected", 400);
  }

  // 5. Flatten locale entries
  let flattened;
  try {
    flattened = flattenLocale(locale);
  } catch (err) {
    return jsonError("INVALID_REQUEST", err.message, 400);
  }

  if (flattened.length === 0) {
    const isRtl = RTL_LANGUAGES.has(target);
    return jsonResponse({
      language: target,
      dir: isRtl ? 'rtl' : 'ltr',
      locale: locale
    });
  }

  // 6. Cache Check for identical translation requests
  const canonicalString = `source=${source}&target=${target}&body=${JSON.stringify(flattened)}`;
  const hashKey = await sha256(canonicalString);
  const cacheKey = new Request(`https://ambisun-proxy.internal/translate-cache/${hashKey}`, { method: 'GET' });
  let cache = null;

  try {
    if (typeof caches !== 'undefined' && caches.default) {
      cache = caches.default;
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
  } catch (_) {}

  // 7. Check Azure Credentials
  const azureKey = env.AZURE_TRANSLATOR_KEY;
  if (!azureKey || typeof azureKey !== 'string' || !azureKey.trim()) {
    return jsonError("TRANSLATION_UNAVAILABLE", "Translation service credentials are not configured on proxy", 503);
  }

  const azureRegion = env.AZURE_TRANSLATOR_REGION;
  const baseEndpoint = (env.AZURE_TRANSLATOR_ENDPOINT || DEFAULT_AZURE_ENDPOINT).replace(/\/+$/, '');
  const translateUrl = `${baseEndpoint}/translate?api-version=${AZURE_API_VERSION}&from=en&to=${encodeURIComponent(target)}`;

  // 8. Batch Translation via Azure
  const itemsToTranslate = flattened.filter(item => item.text && item.text.trim().length > 0);
  const batches = [];
  for (let i = 0; i < itemsToTranslate.length; i += AZURE_BATCH_SIZE) {
    batches.push(itemsToTranslate.slice(i, i + AZURE_BATCH_SIZE));
  }

  for (const batch of batches) {
    const requestPayload = batch.map(item => ({ Text: item.text }));
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Ocp-Apim-Subscription-Key': azureKey.trim(),
      'User-Agent': 'AmbiSun-TranslationProxy/1.0',
      'Accept': 'application/json'
    };
    if (azureRegion && azureRegion.trim()) {
      headers['Ocp-Apim-Subscription-Region'] = azureRegion.trim();
    }

    let azureRes;
    try {
      azureRes = await fetch(translateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload)
      });
    } catch (err) {
      return jsonError("TRANSLATION_PROVIDER_ERROR", "Failed to connect to Azure Translator", 502);
    }

    if (!azureRes.ok) {
      return jsonError("TRANSLATION_PROVIDER_ERROR", `Azure Translator returned status ${azureRes.status}`, 502);
    }

    let azureData;
    try {
      azureData = await azureRes.json();
    } catch (_) {
      return jsonError("TRANSLATION_PROVIDER_ERROR", "Invalid JSON from Azure Translator", 502);
    }

    if (!Array.isArray(azureData) || azureData.length !== batch.length) {
      return jsonError("TRANSLATION_PROVIDER_ERROR", "Unexpected response array length from Azure Translator", 502);
    }

    for (let i = 0; i < batch.length; i++) {
      const transItem = azureData[i];
      if (transItem && Array.isArray(transItem.translations) && transItem.translations[0]) {
        batch[i].translatedText = transItem.translations[0].text;
      } else {
        batch[i].translatedText = batch[i].text; // Fallback
      }
    }
  }

  // 9. Rebuild Locale Structure
  const rebuilt = rebuildLocale(locale, flattened);
  const isRtl = RTL_LANGUAGES.has(target);

  const responseObj = {
    language: target,
    dir: isRtl ? 'rtl' : 'ltr',
    locale: rebuilt
  };

  const finalResponse = jsonResponse(responseObj, 200, {
    'Cache-Control': 'public, max-age=604800, s-maxage=604800' // Cache for 7 days
  });

  if (cache && ctx && ctx.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  }

  return finalResponse;
}

export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);
    const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/languages') {
      return handleLanguages(request, env, ctx);
    }

    if (pathname === '/translate-locale') {
      return handleTranslateLocale(request, env, ctx);
    }

    return jsonError("NOT_FOUND", `Endpoint '${pathname}' not found`, 404);
  },

  // Export internal helpers for unit testing
  _flattenLocale: flattenLocale,
  _rebuildLocale: rebuildLocale,
  _sanitizeString: sanitizeString,
  _checkRateLimit: checkRateLimit,
  _hasDisallowedKeys: hasDisallowedKeys,
  _handleLanguages: handleLanguages,
  _handleTranslateLocale: handleTranslateLocale
};
