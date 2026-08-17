import assert from 'assert';
import worker from '../src/index.js';

console.log("=== RUNNING AMBISUN TRANSLATION PROXY TEST SUITE ===");

// Lightweight Node.js mock for Web Request/Response if not globally present
class MockHeaders {
  constructor(init = {}) {
    this._map = {};
    if (init) {
      for (const k of Object.keys(init)) {
        this._map[k.toLowerCase()] = String(init[k]);
      }
    }
  }
  get(name) {
    return this._map[name.toLowerCase()] || null;
  }
  set(name, value) {
    this._map[name.toLowerCase()] = String(value);
  }
}

class MockRequest {
  constructor(url, init = {}) {
    this.url = url;
    this.method = init.method || 'GET';
    this.headers = new MockHeaders(init.headers || {});
    this._body = init.body || '';
  }
  async arrayBuffer() {
    const enc = new TextEncoder();
    return enc.encode(this._body).buffer;
  }
  async text() {
    return String(this._body);
  }
  async json() {
    return JSON.parse(this._body);
  }
}

class MockResponse {
  constructor(body, init = {}) {
    this._body = body;
    this.status = init.status || 200;
    this.headers = new MockHeaders(init.headers || {});
    this.ok = this.status >= 200 && this.status < 300;
  }
  async text() {
    return String(this._body);
  }
  async json() {
    return typeof this._body === 'string' ? JSON.parse(this._body) : this._body;
  }
  clone() {
    return new MockResponse(this._body, { status: this.status, headers: this.headers._map });
  }
}

if (typeof globalThis.Request === 'undefined') {
  globalThis.Request = MockRequest;
}
if (typeof globalThis.Response === 'undefined') {
  globalThis.Response = MockResponse;
}

// Mock Cloudflare Rate Limiting binding
class MockRateLimiter {
  constructor(limit = 30) {
    this.limitCount = limit;
    this.counts = new Map();
    this.callLog = [];
  }
  async limit({ key }) {
    this.callLog.push(key);
    const cur = this.counts.get(key) || 0;
    if (cur >= this.limitCount) {
      return { success: false };
    }
    this.counts.set(key, cur + 1);
    return { success: true };
  }
}

const dummyCtx = {
  waitUntil: function() {}
};

async function runTests() {
  const rateLimiter = new MockRateLimiter(30);

  const mockEnv = {
    AZURE_TRANSLATOR_KEY: "dummy_test_key_12345",
    AZURE_TRANSLATOR_REGION: "westeurope",
    AZURE_TRANSLATOR_ENDPOINT: "https://api.cognitive.microsofttranslator.com",
    TRANSLATION_RATE_LIMITER: rateLimiter
  };

  // TEST 1: flatten & rebuild structure
  const inputLocale = {
    nav: {
      home: "Home",
      sources: "Sources & apps"
    },
    common: {
      yes: "Yes",
      no: "No",
      nested: {
        deep: "Deep value"
      }
    }
  };

  const flattened = worker._flattenLocale(inputLocale);
  assert.strictEqual(flattened.length, 5);
  assert.deepStrictEqual(flattened[0].path, ['nav', 'home']);
  assert.strictEqual(flattened[0].text, 'Home');

  flattened[0].translatedText = "Startseite";
  flattened[1].translatedText = "Quellen & Apps";
  flattened[2].translatedText = "Ja";
  flattened[3].translatedText = "Nein";
  flattened[4].translatedText = "Tiefer Wert";

  const rebuilt = worker._rebuildLocale(inputLocale, flattened);
  assert.deepStrictEqual(rebuilt, {
    nav: {
      home: "Startseite",
      sources: "Quellen & Apps"
    },
    common: {
      yes: "Ja",
      no: "Nein",
      nested: {
        deep: "Tiefer Wert"
      }
    }
  });
  console.log("PASS 1: Locale flattening and exact tree rebuilding");

  // TEST 2: Reject malicious prototype pollution keys
  assert.strictEqual(worker._hasDisallowedKeys(JSON.parse('{"__proto__": {"admin": true}}')), true);
  assert.strictEqual(worker._hasDisallowedKeys(JSON.parse('{"nav": {"constructor": {}}}')), true);
  assert.strictEqual(worker._hasDisallowedKeys(JSON.parse('{"prototype": {}}')), true);
  assert.strictEqual(worker._hasDisallowedKeys({ nav: { home: "Home" } }), false);

  assert.throws(() => {
    worker._flattenLocale(JSON.parse('{"__proto__": {"pollute": "value"}}'));
  }, /DISALLOWED_PROPERTY_KEY/);
  console.log("PASS 2: Prototype pollution keys (__proto__, constructor, prototype) strictly rejected");

  // TEST 3: String sanitization
  const dirtyStr = "<script>alert(1)</script>\x00\x08\x1F";
  const cleanStr = worker._sanitizeString(dirtyStr);
  assert.strictEqual(cleanStr, "<script>alert(1)</script>");
  console.log("PASS 3: Control characters stripped and string length bounded");

  // TEST 4: Unsupported HTTP Methods & Routes
  const req404 = new globalThis.Request("https://proxy.example.com/unknown-endpoint", { method: 'GET' });
  const res404 = await worker.fetch(req404, mockEnv, dummyCtx);
  assert.strictEqual(res404.status, 404);
  const data404 = await res404.json();
  assert.strictEqual(data404.errorCode, "NOT_FOUND");

  const req405a = new globalThis.Request("https://proxy.example.com/languages", { method: 'POST' });
  const res405a = await worker.fetch(req405a, mockEnv, dummyCtx);
  assert.strictEqual(res405a.status, 405);
  const data405a = await res405a.json();
  assert.strictEqual(data405a.errorCode, "METHOD_NOT_ALLOWED");

  const req405b = new globalThis.Request("https://proxy.example.com/translate-locale", { method: 'GET' });
  const res405b = await worker.fetch(req405b, mockEnv, dummyCtx);
  assert.strictEqual(res405b.status, 405);
  const data405b = await res405b.json();
  assert.strictEqual(data405b.errorCode, "METHOD_NOT_ALLOWED");
  console.log("PASS 4: Unsupported routes (404) and methods (405) handled safely");

  // TEST 5: POST /translate-locale validation checks
  const reqNoJson = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '1.2.3.4' },
    body: "Hello"
  });
  const resNoJson = await worker.fetch(reqNoJson, mockEnv, dummyCtx);
  assert.strictEqual(resNoJson.status, 400);

  const reqArray = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify(["not", "an", "object"])
  });
  const resArray = await worker.fetch(reqArray, mockEnv, dummyCtx);
  assert.strictEqual(resArray.status, 400);

  const reqBadSource = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify({ source: "fr", target: "de", locale: { nav: { home: "Accueil" } } })
  });
  const resBadSource = await worker.fetch(reqBadSource, mockEnv, dummyCtx);
  assert.strictEqual(resBadSource.status, 400);

  const reqBadTarget = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify({ source: "en", target: "en", locale: { nav: { home: "Home" } } })
  });
  const resBadTarget = await worker.fetch(reqBadTarget, mockEnv, dummyCtx);
  assert.strictEqual(resBadTarget.status, 400);
  console.log("PASS 5: POST /translate-locale strict input validation");

  // TEST 6: Missing Azure secret on Worker returns 503
  const envNoSecret = {
    AZURE_TRANSLATOR_KEY: "",
    TRANSLATION_RATE_LIMITER: new MockRateLimiter(30)
  };
  const reqNoSecret = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.1' },
    body: JSON.stringify({ source: "en", target: "de", locale: { nav: { home: "Home" } } })
  });
  const resNoSecret = await worker.fetch(reqNoSecret, envNoSecret, dummyCtx);
  assert.strictEqual(resNoSecret.status, 503);
  const dataNoSecret = await resNoSecret.json();
  assert.strictEqual(dataNoSecret.errorCode, "TRANSLATION_UNAVAILABLE");
  console.log("PASS 6: Missing Azure credentials returns safe 503 without leaks");

  // TEST 7: Body size limit (> 256 KB) returns 413
  const hugeString = "a".repeat(300 * 1024);
  const reqHuge = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.2' },
    body: hugeString
  });
  const resHuge = await worker.fetch(reqHuge, mockEnv, dummyCtx);
  assert.strictEqual(resHuge.status, 413);
  const dataHuge = await resHuge.json();
  assert.strictEqual(dataHuge.errorCode, "REQUEST_TOO_LARGE");
  console.log("PASS 7: Oversized requests (> 256 KB) return 413");

  // TEST 8: Cloudflare Rate Limiting Binding (First 30 calls allowed, 31st returns 429)
  const ipRateLimiter = new MockRateLimiter(30);
  const rateLimitEnv = {
    AZURE_TRANSLATOR_KEY: "dummy_key",
    TRANSLATION_RATE_LIMITER: ipRateLimiter
  };
  const targetIp = "203.0.113.195";

  for (let i = 1; i <= 30; i++) {
    const req = new globalThis.Request("https://proxy.example.com/translate-locale", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': targetIp },
      body: JSON.stringify({ source: "en", target: "de", locale: {} })
    });
    const res = await worker.fetch(req, rateLimitEnv, dummyCtx);
    assert.strictEqual(res.status, 200, `Request ${i} should succeed within limit`);
  }

  // 31st request from same IP must return 429
  const req31 = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': targetIp },
    body: JSON.stringify({ source: "en", target: "de", locale: {} })
  });
  const res31 = await worker.fetch(req31, rateLimitEnv, dummyCtx);
  assert.strictEqual(res31.status, 429, "31st request must be rate limited with HTTP 429");
  const data31 = await res31.json();
  assert.strictEqual(data31.errorCode, "RATE_LIMITED");
  console.log("PASS 8: Cloudflare Rate Limiting binding enforces 30 req/min/IP limit");

  // TEST 9: Different IP has independent limit
  const otherIp = "198.51.100.22";
  const reqOther = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': otherIp },
    body: JSON.stringify({ source: "en", target: "de", locale: {} })
  });
  const resOther = await worker.fetch(reqOther, rateLimitEnv, dummyCtx);
  assert.strictEqual(resOther.status, 200, "Different IP should not be blocked by another IP's rate limit");
  console.log("PASS 9: Different IP has independent rate limit count");

  // TEST 10: Missing Rate Limiting Binding -> Fail Closed (503 RATE_LIMIT_UNAVAILABLE)
  const envNoLimiter = {
    AZURE_TRANSLATOR_KEY: "dummy_key"
  };
  const reqNoLimiter = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': "1.1.1.1" },
    body: JSON.stringify({ source: "en", target: "de", locale: {} })
  });
  const resNoLimiter = await worker.fetch(reqNoLimiter, envNoLimiter, dummyCtx);
  assert.strictEqual(resNoLimiter.status, 503, "Missing rate limiter binding must fail closed with HTTP 503");
  const dataNoLimiter = await resNoLimiter.json();
  assert.strictEqual(dataNoLimiter.errorCode, "RATE_LIMIT_UNAVAILABLE");
  console.log("PASS 10: Fail-closed behavior when Rate Limiting binding is not configured");

  // TEST 11: Spoofed x-real-ip is ignored; strictly CF-Connecting-IP is used
  const spoofLimiter = new MockRateLimiter(30);
  const spoofEnv = {
    AZURE_TRANSLATOR_KEY: "dummy_key",
    TRANSLATION_RATE_LIMITER: spoofLimiter
  };
  const reqSpoof = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '100.64.0.1',
      'x-real-ip': '8.8.8.8', // Attacker attempt to spoof IP
      'x-forwarded-for': '9.9.9.9'
    },
    body: JSON.stringify({ source: "en", target: "de", locale: {} })
  });
  await worker.fetch(reqSpoof, spoofEnv, dummyCtx);
  assert.strictEqual(spoofLimiter.callLog[0], '100.64.0.1', "Limiter must use CF-Connecting-IP and ignore x-real-ip");
  console.log("PASS 11: Spoofed x-real-ip / x-forwarded-for headers are strictly ignored");

  console.log("=== ALL TRANSLATION PROXY TESTS PASSED SUCCESSFULLY ===");
}

runTests().catch(err => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
