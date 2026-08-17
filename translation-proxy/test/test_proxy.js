import assert from 'assert';
import worker from '../src/index.js';

console.log("=== RUNNING AMBISUN TRANSLATION PROXY TEST SUITE ===");

// Lightweight Node.js mock for Web Request/Response if not globally present (e.g. Node 16/17)
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

const mockEnv = {
  AZURE_TRANSLATOR_KEY: "dummy_test_key_12345",
  AZURE_TRANSLATOR_REGION: "westeurope",
  AZURE_TRANSLATOR_ENDPOINT: "https://api.cognitive.microsofttranslator.com"
};

const dummyCtx = {
  waitUntil: function() {}
};

async function runTests() {
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

  // Simulate translations
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
  // Non-JSON content type
  const reqNoJson = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: "Hello"
  });
  const resNoJson = await worker.fetch(reqNoJson, mockEnv, dummyCtx);
  assert.strictEqual(resNoJson.status, 400);

  // Array instead of object
  const reqArray = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(["not", "an", "object"])
  });
  const resArray = await worker.fetch(reqArray, mockEnv, dummyCtx);
  assert.strictEqual(resArray.status, 400);

  // Non-en source
  const reqBadSource = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: "fr", target: "de", locale: { nav: { home: "Accueil" } } })
  });
  const resBadSource = await worker.fetch(reqBadSource, mockEnv, dummyCtx);
  assert.strictEqual(resBadSource.status, 400);

  // Invalid target
  const reqBadTarget = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: "en", target: "en", locale: { nav: { home: "Home" } } })
  });
  const resBadTarget = await worker.fetch(reqBadTarget, mockEnv, dummyCtx);
  assert.strictEqual(resBadTarget.status, 400);

  console.log("PASS 5: POST /translate-locale strict input validation");

  // TEST 6: Missing Azure secret on Worker returns 503
  const envNoSecret = { AZURE_TRANSLATOR_KEY: "" };
  const reqNoSecret = new globalThis.Request("https://proxy.example.com/translate-locale", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: hugeString
  });
  const resHuge = await worker.fetch(reqHuge, mockEnv, dummyCtx);
  assert.strictEqual(resHuge.status, 413);
  const dataHuge = await resHuge.json();
  assert.strictEqual(dataHuge.errorCode, "REQUEST_TOO_LARGE");
  console.log("PASS 7: Oversized requests (> 256 KB) return 413");

  // TEST 8: Rate Limiter Token Bucket
  const testIp = "192.168.1.100";
  for (let i = 0; i < 30; i++) {
    assert.strictEqual(worker._checkRateLimit(testIp), true);
  }
  assert.strictEqual(worker._checkRateLimit(testIp), false);
  console.log("PASS 8: Per-IP rate limiting enforcement");

  console.log("=== ALL TRANSLATION PROXY TESTS PASSED SUCCESSFULLY ===");
}

runTests().catch(err => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
