var https = require('https');
var url = require('url');
var fs = require('fs');
var crypto = require('crypto');

module.exports = function createTransfer(options) {
    options = options || {};
    var isAllowedHost = options.isAllowedHost;
    var httpTimeoutMs = options.httpTimeoutMs || 8000;

    function fetchWithRedirects(targetUrl, maxBytes, redirectCount, callback) {
        var settled = false;
        function finish(err, result) {
            if (settled) return;
            settled = true;
            callback(err, result);
        }
        if (redirectCount > 5) return finish(new Error("Too many redirects"));
        var parsedUrl;
        try { parsedUrl = url.parse(targetUrl); } catch (_) { return finish(new Error("Invalid URL: " + targetUrl)); }
        if (parsedUrl.protocol !== 'https:') {
            return finish(new Error(redirectCount > 0 ? "INSECURE_REDIRECT: Downgrade to http is not allowed" : "HTTPS_REQUIRED: Protocol must be https:"));
        }
        if (!isAllowedHost(parsedUrl.hostname)) {
            return finish(new Error("UNTRUSTED_REDIRECT_HOST: Target or redirect host '" + parsedUrl.hostname + "' is not in allowed GitHub domains"));
        }
        var req = https.get({
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.path,
            headers: { 'User-Agent': 'AmbiSun-Updater/1.0' },
            timeout: httpTimeoutMs
        }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                var nextUrl = url.resolve(targetUrl, res.headers.location);
                res.resume();
                return fetchWithRedirects(nextUrl, maxBytes, redirectCount + 1, finish);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return finish(new Error("HTTP error " + res.statusCode));
            }
            var chunks = [];
            var totalBytes = 0;
            res.on('data', function (chunk) {
                totalBytes += chunk.length;
                if (totalBytes > maxBytes) {
                    req.destroy();
                    return finish(new Error("Response exceeds size limit of " + maxBytes + " bytes"));
                }
                chunks.push(chunk);
            });
            res.on('end', function () {
                finish(null, Buffer.concat(chunks).toString('utf8'));
            });
        });
        req.on('timeout', function () {
            req.destroy();
            finish(new Error("Request timeout"));
        });
        req.on('error', function (err) { finish(err); });
    }

    function downloadFileWithHash(targetUrl, destPath, expectedSize, maxBytes, redirectCount, callback) {
        var settled = false;
        function finish(err, result) {
            if (settled) return;
            settled = true;
            callback(err, result);
        }
        if (redirectCount > 5) return finish(new Error("Too many redirects"));
        var parsedUrl;
        try { parsedUrl = url.parse(targetUrl); } catch (_) { return finish(new Error("Invalid URL: " + targetUrl)); }
        if (parsedUrl.protocol !== 'https:') {
            return finish(new Error(redirectCount > 0 ? "INSECURE_REDIRECT: Downgrade to http is not allowed" : "HTTPS_REQUIRED: Protocol must be https:"));
        }
        if (!isAllowedHost(parsedUrl.hostname)) {
            return finish(new Error("UNTRUSTED_REDIRECT_HOST: Target or redirect host '" + parsedUrl.hostname + "' is not in allowed GitHub domains"));
        }
        var req = https.get({
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.path,
            headers: { 'User-Agent': 'AmbiSun-Updater/1.0' },
            timeout: httpTimeoutMs * 2
        }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                var nextUrl = url.resolve(targetUrl, res.headers.location);
                res.resume();
                return downloadFileWithHash(nextUrl, destPath, expectedSize, maxBytes, redirectCount + 1, finish);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return finish(new Error("HTTP error " + res.statusCode));
            }
            var hash = crypto.createHash('sha256');
            var outStream = fs.createWriteStream(destPath);
            var totalBytes = 0;
            function cleanup(err, result) {
                if (err) {
                    try { fs.unlinkSync(destPath); } catch (_) {}
                    return finish(err);
                }
                finish(null, result);
            }
            res.on('data', function (chunk) {
                totalBytes += chunk.length;
                if (totalBytes > maxBytes) {
                    req.destroy();
                    outStream.destroy();
                    return cleanup(new Error("Download exceeds maximum allowed size of " + maxBytes + " bytes"));
                }
                hash.update(chunk);
                outStream.write(chunk);
            });
            res.on('end', function () {
                outStream.end(function () {
                    if (typeof expectedSize === 'number' && expectedSize > 0 && totalBytes !== expectedSize) {
                        return cleanup(new Error("UPDATE_SIZE_MISMATCH: Downloaded " + totalBytes + " bytes, expected " + expectedSize));
                    }
                    cleanup(null, { hash: hash.digest('hex').toLowerCase(), size: totalBytes });
                });
            });
            outStream.on('error', function (err) {
                req.destroy();
                cleanup(err);
            });
        });
        req.on('timeout', function () {
            req.destroy();
            finish(new Error("Download timeout"));
        });
        req.on('error', function (err) { finish(err); });
    }

    return {
        fetchWithRedirects: fetchWithRedirects,
        downloadFileWithHash: downloadFileWithHash
    };
};
