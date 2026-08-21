"use strict";

var fs = require("fs");
var path = require("path");

var MAX_ICON_BYTES = 512 * 1024;

function dataUri(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
        var stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ICON_BYTES) return null;
        var ext = path.extname(filePath).toLowerCase();
        var mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
            ext === ".webp" ? "image/webp" : "image/png";
        return "data:" + mime + ";base64," + fs.readFileSync(filePath).toString("base64");
    } catch (_) {
        return null;
    }
}

function addCandidate(list, value) {
    if (!value || typeof value !== "string") return;
    list.push(value);
}

function toDataUri(app) {
    if (!app) return null;
    var candidates = [];
    [app.extraLargeIcon, app.largeIcon, app.mediumLargeIcon, app.iconPath,
        app.icon, app.iconUri].forEach(function (value) { addCandidate(candidates, value); });
    var roots = [app.activeFolderPath, app.folderPath, app.path, app.basePath];
    if (app.id) {
        roots.push("/media/cryptofs/apps/usr/palm/applications/" + app.id);
        roots.push("/media/developer/apps/usr/palm/applications/" + app.id);
        roots.push("/usr/palm/applications/" + app.id);
    }
    var relative = candidates.slice();
    roots.forEach(function (root) {
        if (!root || typeof root !== "string") return;
        relative.forEach(function (value) {
            if (/^(data:|https?:\/\/|[A-Za-z]:[\\/]|\/)/i.test(value)) {
                candidates.push(value);
            } else {
                candidates.push(path.join(root, value));
            }
        });
    });

    var seen = {};
    for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (seen[candidate]) continue;
        seen[candidate] = true;
        if (/^(data:|https?:\/\/)/i.test(candidate)) return candidate;
        var uri = dataUri(candidate);
        if (uri) return uri;
    }
    return null;
}

module.exports = { toDataUri: toDataUri };
