var fs = require('fs');
var path = require('path');

var CONFIG_DIR = '/media/internal/ambisun';
var CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
var TEMP_FILE = path.join(CONFIG_DIR, 'config.json.tmp');

function ensureDir(dir, callback) {
    fs.mkdir(dir, { recursive: true }, function(err) {
        if (err && err.code !== 'EEXIST') {
            return callback(err);
        }
        callback(null);
    });
}

function load(callback) {
    fs.readFile(CONFIG_FILE, 'utf8', function(err, data) {
        if (err) {
            return callback(err); // Typically ENOENT
        }
        try {
            var parsed = JSON.parse(data);
            callback(null, parsed);
        } catch (e) {
            var parseErr = new Error("Malformed JSON");
            parseErr.code = "JSON_PARSE_ERROR";
            callback(parseErr);
        }
    });
}

function save(snapshot, callback) {
    ensureDir(CONFIG_DIR, function(err) {
        if (err) return callback(err);
        
        var json;
        try {
            // Serialize the exact immutable snapshot passed in
            json = JSON.stringify(snapshot, null, 2);
        } catch (e) {
            return callback(e);
        }
        
        fs.writeFile(TEMP_FILE, json, 'utf8', function(err) {
            if (err) return callback(err);
            
            // On webOS (Linux), rename is atomic and overwrites
            fs.rename(TEMP_FILE, CONFIG_FILE, function(err) {
                if (err) {
                    // Try to clean up temp file best-effort, ignore cleanup errors
                    fs.unlink(TEMP_FILE, function() {});
                    return callback(err);
                }
                callback(null);
            });
        });
    });
}

module.exports = {
    load: load,
    save: save,
    CONFIG_DIR: CONFIG_DIR,
    CONFIG_FILE: CONFIG_FILE
};
