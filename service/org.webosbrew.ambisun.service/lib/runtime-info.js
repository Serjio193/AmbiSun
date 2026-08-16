var pkg = require('../package.json');

var SERVICE_API_VERSION = 1;

function getPingResponse() {
    return {
        returnValue: true,
        service: pkg.name,
        apiVersion: SERVICE_API_VERSION,
        version: pkg.version
    };
}

function getRuntimeInfo() {
    return {
        returnValue: true,
        service: pkg.name,
        apiVersion: SERVICE_API_VERSION,
        runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch
        }
    };
}

function getCapabilities() {
    return {
        returnValue: true,
        apiVersion: SERVICE_API_VERSION,
        capabilities: {
            automation: true,
            persistentConfig: true,
            activityScheduler: true,
            hyperhdrServiceTransport: true,
            sourceDetection: true
        }
    };
}

module.exports = {
    getPingResponse: getPingResponse,
    getRuntimeInfo: getRuntimeInfo,
    getCapabilities: getCapabilities,
    SERVICE_API_VERSION: SERVICE_API_VERSION
};
