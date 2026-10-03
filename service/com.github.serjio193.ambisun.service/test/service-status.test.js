const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../service.js'), 'utf8');
const statusHandler = source.match(/service\.register\("getSystemStatus"[\s\S]*?\n\}\);/);

assert(statusHandler, 'getSystemStatus handler must be registered');
assert(statusHandler[0].includes('elevationPending: false'),
    'status handler must return a defined elevationPending value');
assert(!statusHandler[0].includes('elevationInProgress'));
assert(!statusHandler[0].includes('elevationRestartScheduled'));
console.log('PASS: system status no longer references removed elevation state');
