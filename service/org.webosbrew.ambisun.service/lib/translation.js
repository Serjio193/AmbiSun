var https = require('https');
var url = require('url');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var TRANSLATION_PROXY_URL = ""; // Unconfigured by default. Must be configured with trusted HTTPS proxy endpoint.
var STORAGE_DIR_PRIMARY = "/media/internal/ambisun/translations";
var REQUEST_TIMEOUT_MS = 15000;
var MAX_RESPONSE_BYTES = 524288; // 512 KB
var MAX_LANGUAGES_COUNT = 500;
var MAX_NAME_LENGTH = 100;
var BUILTIN_LANGUAGES = ['en', 'et', 'uk', 'ru'];
var LANG_CODE_REGEX = /^[a-z]{2,3}(-[a-z0-9]+)?$/i;

var customStorageDir = null;
var customProxyUrl = null;

function getTrustedProxyUrl() {
    if (customProxyUrl !== null) return customProxyUrl;
    return TRANSLATION_PROXY_URL;
}

function _setTrustedProxyUrl(urlStr) {
    customProxyUrl = urlStr;
}

function _resetTrustedProxyUrl() {
    customProxyUrl = null;
}

function getStorageDir(callback) {
    if (customStorageDir) {
        return callback(null, customStorageDir);
    }
    fs.mkdir(STORAGE_DIR_PRIMARY, { recursive: true }, function(err) {
        if (err && err.code !== 'EEXIST') {
            return callback(new Error("STORAGE_UNAVAILABLE"));
        }
        callback(null, STORAGE_DIR_PRIMARY);
    });
}

function setCustomStorageDir(customPath) {
    customStorageDir = customPath;
    if (customPath) {
        try { fs.mkdirSync(customPath, { recursive: true }); } catch (_) {}
    }
}

function getSourceEnLocale() {
    var possiblePaths = [
        path.join(__dirname, "../data/en.json"),
        path.join(__dirname, "../../../i18n/en.json"),
        "/media/developer/apps/usr/palm/applications/org.webosbrew.ambisun/i18n/en.json"
    ];
    for (var i = 0; i < possiblePaths.length; i++) {
        try {
            if (fs.existsSync(possiblePaths[i])) {
                var content = fs.readFileSync(possiblePaths[i], 'utf8');
                return JSON.parse(content);
            }
        } catch (_) {}
    }
    return {
        nav: { home: "Home", sources: "Sources & apps", sun: "Sun & schedule", settings: "Settings", language: "Language", about: "About" },
        common: { yes: "Yes", no: "No", back: "Back", change: "Change", minimize: "Minimize" }
    };
}

function getSourceFingerprint(localeObj) {
    var canonical = JSON.stringify(localeObj || getSourceEnLocale());
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function isPlainObject(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function sanitizeString(val) {
    if (typeof val !== 'string') return '';
    // Strip control characters (C0 and C1 control blocks) and truncate
    return val.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

function extractMissingKeys(source, current) {
    var result = {};
    var hasMissing = false;

    for (var k in source) {
        if (!Object.prototype.hasOwnProperty.call(source, k)) continue;

        if (!current || !Object.prototype.hasOwnProperty.call(current, k)) {
            result[k] = source[k];
            hasMissing = true;
        } else if (isPlainObject(source[k])) {
            if (!isPlainObject(current[k])) {
                result[k] = source[k];
                hasMissing = true;
            } else {
                var subMissing = extractMissingKeys(source[k], current[k]);
                if (Object.keys(subMissing).length > 0) {
                    result[k] = subMissing;
                    hasMissing = true;
                }
            }
        }
    }

    return hasMissing ? result : {};
}

function deepMerge(target, source) {
    target = target || {};
    for (var k in source) {
        if (!Object.prototype.hasOwnProperty.call(source, k)) continue;
        if (isPlainObject(source[k])) {
            if (!isPlainObject(target[k])) target[k] = {};
            deepMerge(target[k], source[k]);
        } else {
            target[k] = source[k];
        }
    }
    return target;
}

function validateAndSanitizeLocale(template, incoming) {
    var result = {};
    for (var k in template) {
        if (!Object.prototype.hasOwnProperty.call(template, k)) continue;

        if (isPlainObject(template[k])) {
            var inSub = (incoming && isPlainObject(incoming[k])) ? incoming[k] : {};
            result[k] = validateAndSanitizeLocale(template[k], inSub);
        } else {
            if (incoming && typeof incoming[k] === 'string' && incoming[k].trim().length > 0) {
                result[k] = incoming[k];
            } else {
                result[k] = template[k]; // Fallback to source
            }
        }
    }
    return result;
}

function requestJson(targetUrl, method, postData, callback) {
    var settled = false;
    function finish(err, data) {
        if (settled) return;
        settled = true;
        callback(err, data);
    }

    var parsedUrl;
    try {
        parsedUrl = url.parse(targetUrl);
    } catch (e) {
        return finish(new Error("INVALID_URL: " + targetUrl));
    }

    if (parsedUrl.protocol !== 'https:') {
        return finish(new Error("HTTPS_REQUIRED: Protocol must be https:"));
    }

    var payloadStr = postData ? JSON.stringify(postData) : null;

    var headers = {
        'User-Agent': 'AmbiSun-Translator/1.0',
        'Accept': 'application/json'
    };
    if (payloadStr) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        headers['Content-Length'] = Buffer.byteLength(payloadStr, 'utf8');
    }

    var options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: method || 'GET',
        headers: headers,
        timeout: REQUEST_TIMEOUT_MS
    };

    var req = https.request(options, function(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return finish(new Error("HTTP_ERROR_" + res.statusCode));
        }

        var chunks = [];
        var totalBytes = 0;

        res.on('data', function(chunk) {
            totalBytes += chunk.length;
            if (totalBytes > MAX_RESPONSE_BYTES) {
                req.destroy();
                return finish(new Error("RESPONSE_TOO_LARGE: Exceeds " + MAX_RESPONSE_BYTES + " bytes"));
            }
            chunks.push(chunk);
        });

        res.on('end', function() {
            var body = Buffer.concat(chunks).toString('utf8');
            try {
                var json = JSON.parse(body);
                finish(null, json);
            } catch (e) {
                finish(new Error("INVALID_JSON_RESPONSE"));
            }
        });
    });

    req.on('timeout', function() {
        req.destroy();
        finish(new Error("REQUEST_TIMEOUT"));
    });

    req.on('error', function(err) {
        finish(err);
    });

    if (payloadStr) {
        req.write(payloadStr);
    }
    req.end();
}

function getTranslationLanguages(options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    options = options || {};

    var proxyUrl = getTrustedProxyUrl();
    if (!proxyUrl || typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
        return callback(null, {
            returnValue: false,
            errorCode: "TRANSLATION_PROXY_NOT_CONFIGURED",
            errorText: "Translation proxy endpoint is not configured"
        });
    }

    var baseProxy = proxyUrl.trim().replace(/\/+$/, '');
    var languagesEndpoint = baseProxy + "/languages";

    requestJson(languagesEndpoint, 'GET', null, function(err, data) {
        if (err) {
            return callback(null, {
                returnValue: false,
                errorCode: "LANGUAGES_FETCH_FAILED",
                errorText: err.message
            });
        }

        if (!data || !Array.isArray(data.languages)) {
            return callback(null, {
                returnValue: false,
                errorCode: "INVALID_LANGUAGES_RESPONSE",
                errorText: "Expected array of languages in response"
            });
        }

        var rawList = data.languages.slice(0, MAX_LANGUAGES_COUNT);
        var validLanguages = [];

        for (var i = 0; i < rawList.length; i++) {
            var item = rawList[i];
            if (!item || typeof item !== 'object') continue;
            var code = String(item.code || '').trim().toLowerCase();
            if (!code || !LANG_CODE_REGEX.test(code)) continue;
            if (BUILTIN_LANGUAGES.indexOf(code) !== -1) continue;

            var sanitizedName = sanitizeString(item.name) || code;
            var sanitizedNative = sanitizeString(item.nativeName) || sanitizedName;
            var dir = (String(item.dir || 'ltr').toLowerCase() === 'rtl') ? 'rtl' : 'ltr';

            validLanguages.push({
                code: code,
                name: sanitizedName,
                nativeName: sanitizedNative,
                dir: dir
            });
        }

        validLanguages.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        callback(null, {
            returnValue: true,
            languages: validLanguages
        });
    });
}

function getDownloadedLanguages(callback) {
    getStorageDir(function(err, dir) {
        if (err) {
            return callback(null, { returnValue: true, downloaded: [] });
        }

        fs.readdir(dir, function(readErr, files) {
            if (readErr) {
                return callback(null, { returnValue: true, downloaded: [] });
            }

            var list = [];
            files.forEach(function(f) {
                if (!f.endsWith('.json')) return;
                var langCode = f.slice(0, -5).toLowerCase();
                try {
                    var content = fs.readFileSync(path.join(dir, f), 'utf8');
                    var parsed = JSON.parse(content);
                    list.push({
                        code: langCode,
                        name: sanitizeString(parsed.name) || langCode,
                        nativeName: sanitizeString(parsed.nativeName) || langCode,
                        dir: parsed.dir === 'rtl' ? 'rtl' : 'ltr',
                        updatedAt: parsed.updatedAt || 0,
                        sourceFingerprint: parsed.sourceFingerprint || ''
                    });
                } catch (_) {}
            });

            list.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });

            callback(null, {
                returnValue: true,
                downloaded: list
            });
        });
    });
}

function getTranslationLocale(languageCode, callback) {
    if (!languageCode || typeof languageCode !== 'string' || !LANG_CODE_REGEX.test(languageCode.trim())) {
        return callback(null, { returnValue: false, errorCode: "INVALID_LANGUAGE_CODE" });
    }
    var code = languageCode.trim().toLowerCase();

    getStorageDir(function(err, dir) {
        if (err) {
            return callback(null, {
                returnValue: false,
                errorCode: "STORAGE_UNAVAILABLE",
                errorText: "Primary translation storage is unavailable"
            });
        }

        var filePath = path.join(dir, code + ".json");
        fs.readFile(filePath, 'utf8', function(fileErr, content) {
            if (fileErr) {
                return callback(null, {
                    returnValue: false,
                    errorCode: "LOCALE_NOT_FOUND",
                    errorText: "Translation for '" + code + "' is not downloaded"
                });
            }

            try {
                var parsed = JSON.parse(content);
                callback(null, {
                    returnValue: true,
                    language: code,
                    name: sanitizeString(parsed.name) || code,
                    nativeName: sanitizeString(parsed.nativeName) || code,
                    dir: parsed.dir === 'rtl' ? 'rtl' : 'ltr',
                    locale: parsed.locale || {}
                });
            } catch (e) {
                callback(null, {
                    returnValue: false,
                    errorCode: "INVALID_CACHED_LOCALE",
                    errorText: "Failed to parse cached translation file"
                });
            }
        });
    });
}

function downloadTranslation(params, callback) {
    params = params || {};
    var targetCode = String(params.language || '').trim().toLowerCase();
    if (!targetCode || !LANG_CODE_REGEX.test(targetCode)) {
        return callback(null, {
            returnValue: false,
            errorCode: "INVALID_LANGUAGE_CODE",
            errorText: "Invalid language code format: " + targetCode
        });
    }

    getStorageDir(function(err, dir) {
        if (err) {
            return callback(null, {
                returnValue: false,
                errorCode: "STORAGE_UNAVAILABLE",
                errorText: "Primary storage is unavailable for saving translation"
            });
        }

        var filePath = path.join(dir, targetCode + ".json");
        var sourceLocale = getSourceEnLocale();
        var sourceFingerprint = getSourceFingerprint(sourceLocale);

        // Check if cached version exists
        var cachedData = null;
        try {
            if (fs.existsSync(filePath)) {
                cachedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (_) {}

        if (cachedData && cachedData.locale) {
            var missingKeys = extractMissingKeys(sourceLocale, cachedData.locale);
            if (Object.keys(missingKeys).length === 0 && cachedData.sourceFingerprint === sourceFingerprint) {
                return callback(null, {
                    returnValue: true,
                    language: targetCode,
                    name: sanitizeString(cachedData.name) || targetCode,
                    nativeName: sanitizeString(cachedData.nativeName) || targetCode,
                    dir: cachedData.dir === 'rtl' ? 'rtl' : 'ltr',
                    locale: cachedData.locale,
                    cached: true
                });
            }

            if (Object.keys(missingKeys).length === 0) {
                cachedData.sourceFingerprint = sourceFingerprint;
                cachedData.updatedAt = Date.now();
                try { fs.writeFileSync(filePath, JSON.stringify(cachedData, null, 2), 'utf8'); } catch (_) {}
                return callback(null, {
                    returnValue: true,
                    language: targetCode,
                    name: sanitizeString(cachedData.name) || targetCode,
                    nativeName: sanitizeString(cachedData.nativeName) || targetCode,
                    dir: cachedData.dir === 'rtl' ? 'rtl' : 'ltr',
                    locale: cachedData.locale,
                    cached: true
                });
            }

            // Incremental update requires proxy
            var proxyUrl = getTrustedProxyUrl();
            if (!proxyUrl || typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
                // If proxy is not configured but we have cached version, fallback to existing cache with English fill
                var fallbackLocale = validateAndSanitizeLocale(sourceLocale, cachedData.locale);
                return callback(null, {
                    returnValue: true,
                    language: targetCode,
                    name: sanitizeString(cachedData.name) || targetCode,
                    nativeName: sanitizeString(cachedData.nativeName) || targetCode,
                    dir: cachedData.dir === 'rtl' ? 'rtl' : 'ltr',
                    locale: fallbackLocale,
                    warning: "PROXY_NOT_CONFIGURED_USING_CACHED",
                    cached: true
                });
            }

            var baseProxy = proxyUrl.trim().replace(/\/+$/, '');
            var translateEndpoint = baseProxy + "/translate-locale";
            var incrementalReq = {
                source: "en",
                target: targetCode,
                locale: missingKeys
            };

            requestJson(translateEndpoint, 'POST', incrementalReq, function(reqErr, resp) {
                if (reqErr) {
                    var fallbackLocale = validateAndSanitizeLocale(sourceLocale, cachedData.locale);
                    return callback(null, {
                        returnValue: true,
                        language: targetCode,
                        name: sanitizeString(cachedData.name) || targetCode,
                        nativeName: sanitizeString(cachedData.nativeName) || targetCode,
                        dir: cachedData.dir === 'rtl' ? 'rtl' : 'ltr',
                        locale: fallbackLocale,
                        warning: "INCREMENTAL_UPDATE_FAILED_USING_CACHED",
                        cached: true
                    });
                }

                var incomingMissing = (resp && isPlainObject(resp.locale)) ? resp.locale : {};
                deepMerge(cachedData.locale, incomingMissing);
                cachedData.locale = validateAndSanitizeLocale(sourceLocale, cachedData.locale);
                cachedData.sourceFingerprint = sourceFingerprint;
                cachedData.updatedAt = Date.now();
                if (resp.dir) cachedData.dir = (String(resp.dir).toLowerCase() === 'rtl') ? 'rtl' : 'ltr';

                try {
                    fs.writeFileSync(filePath, JSON.stringify(cachedData, null, 2), 'utf8');
                } catch (writeErr) {
                    return callback(null, {
                        returnValue: false,
                        errorCode: "CACHE_WRITE_FAILED",
                        errorText: writeErr.message
                    });
                }

                callback(null, {
                    returnValue: true,
                    language: targetCode,
                    name: sanitizeString(cachedData.name) || targetCode,
                    nativeName: sanitizeString(cachedData.nativeName) || targetCode,
                    dir: cachedData.dir,
                    locale: cachedData.locale,
                    updated: true
                });
            });
            return;
        }

        // Full download requires proxy
        var proxyUrl = getTrustedProxyUrl();
        if (!proxyUrl || typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
            return callback(null, {
                returnValue: false,
                errorCode: "TRANSLATION_PROXY_NOT_CONFIGURED",
                errorText: "Translation proxy endpoint is not configured"
            });
        }

        var baseProxy = proxyUrl.trim().replace(/\/+$/, '');
        var translateEndpoint = baseProxy + "/translate-locale";
        var fullReq = {
            source: "en",
            target: targetCode,
            locale: sourceLocale
        };

        requestJson(translateEndpoint, 'POST', fullReq, function(reqErr, resp) {
            if (reqErr) {
                return callback(null, {
                    returnValue: false,
                    errorCode: "TRANSLATION_DOWNLOAD_FAILED",
                    errorText: reqErr.message
                });
            }

            if (!resp || !isPlainObject(resp.locale)) {
                return callback(null, {
                    returnValue: false,
                    errorCode: "INVALID_TRANSLATION_RESPONSE",
                    errorText: "Expected locale object in response"
                });
            }

            var validated = validateAndSanitizeLocale(sourceLocale, resp.locale);
            var dirValue = (String(resp.dir || 'ltr').toLowerCase() === 'rtl') ? 'rtl' : 'ltr';
            var sanitizedName = sanitizeString(params.name) || targetCode;
            var sanitizedNative = sanitizeString(params.nativeName) || sanitizedName;

            var saveObj = {
                language: targetCode,
                name: sanitizedName,
                nativeName: sanitizedNative,
                dir: dirValue,
                sourceFingerprint: sourceFingerprint,
                updatedAt: Date.now(),
                locale: validated
            };

            try {
                fs.writeFileSync(filePath, JSON.stringify(saveObj, null, 2), 'utf8');
            } catch (writeErr) {
                return callback(null, {
                    returnValue: false,
                    errorCode: "CACHE_WRITE_FAILED",
                    errorText: writeErr.message
                });
            }

            callback(null, {
                returnValue: true,
                language: targetCode,
                name: saveObj.name,
                nativeName: saveObj.nativeName,
                dir: saveObj.dir,
                locale: validated,
                downloaded: true
            });
        });
    });
}

function deleteTranslation(languageCode, callback) {
    if (!languageCode || typeof languageCode !== 'string') {
        return callback(null, { returnValue: false, errorCode: "INVALID_LANGUAGE_CODE" });
    }
    var code = languageCode.trim().toLowerCase();

    getStorageDir(function(err, dir) {
        if (err) {
            return callback(null, { returnValue: false, errorCode: "STORAGE_UNAVAILABLE" });
        }
        var filePath = path.join(dir, code + ".json");
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            callback(null, { returnValue: true, language: code });
        } catch (e) {
            callback(null, { returnValue: false, errorCode: "DELETE_FAILED", errorText: e.message });
        }
    });
}

module.exports = {
    BUILTIN_LANGUAGES: BUILTIN_LANGUAGES,
    getTranslationLanguages: getTranslationLanguages,
    getDownloadedLanguages: getDownloadedLanguages,
    getTranslationLocale: getTranslationLocale,
    downloadTranslation: downloadTranslation,
    deleteTranslation: deleteTranslation,
    _getSourceEnLocale: getSourceEnLocale,
    _getSourceFingerprint: getSourceFingerprint,
    _extractMissingKeys: extractMissingKeys,
    _deepMerge: deepMerge,
    _validateAndSanitizeLocale: validateAndSanitizeLocale,
    _sanitizeString: sanitizeString,
    _setCustomStorageDir: setCustomStorageDir,
    _setTrustedProxyUrl: _setTrustedProxyUrl,
    _resetTrustedProxyUrl: _resetTrustedProxyUrl,
    _requestJson: requestJson
};
