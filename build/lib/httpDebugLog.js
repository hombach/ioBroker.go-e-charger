"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTTP_DEBUG_BODY_LIMIT = void 0;
exports.httpBodyLength = httpBodyLength;
exports.httpRequestLine = httpRequestLine;
exports.httpResponseLine = httpResponseLine;
exports.httpFailureLine = httpFailureLine;
exports.attachHttpDebugLog = attachHttpDebugLog;
exports.HTTP_DEBUG_BODY_LIMIT = 300;
function httpBodyLength(data) {
    if (data === undefined || data === null) {
        return 0;
    }
    return typeof data === "string" ? data.length : JSON.stringify(data).length;
}
function httpRequestLine(method, url) {
    return `HTTP ${(method ?? "get").toUpperCase()} ${url ?? "?"}`;
}
function httpResponseLine(url, status, durationMs, data) {
    return `HTTP ${status} in ${formatDuration(durationMs)}, ${httpBodyLength(data)} chars: ${url ?? "?"}`;
}
function httpFailureLine(url, error, durationMs) {
    const response = error?.response;
    if (response && typeof response.status === "number") {
        const data = response.data;
        const body = typeof data === "string" ? data : data === undefined || data === null ? "" : JSON.stringify(data);
        const shown = body.length > exports.HTTP_DEBUG_BODY_LIMIT ? `${body.slice(0, exports.HTTP_DEBUG_BODY_LIMIT)}...` : body;
        return `HTTP ${response.status} in ${formatDuration(durationMs)}: ${url ?? "?"} - answer (${body.length} chars): ${JSON.stringify(shown)}`;
    }
    const code = error?.code;
    const message = error instanceof Error ? error.message : String(error);
    return `HTTP request failed after ${formatDuration(durationMs)}: ${url ?? "?"} - ${typeof code === "string" ? `${code}: ` : ""}${message}`;
}
function formatDuration(durationMs) {
    return Number.isFinite(durationMs) ? `${Math.round(durationMs)} ms` : "? ms";
}
function attachHttpDebugLog(instance, debug, now = Date.now) {
    const started = new WeakMap();
    const elapsed = (config) => {
        const start = config ? started.get(config) : undefined;
        return start === undefined ? Number.NaN : now() - start;
    };
    instance.interceptors.request.use((config) => {
        started.set(config, now());
        debug(httpRequestLine(config.method, instance.getUri(config)));
        return config;
    });
    instance.interceptors.response.use((response) => {
        debug(httpResponseLine(instance.getUri(response.config), response.status, elapsed(response.config), response.data));
        return response;
    }, (error) => {
        debug(httpFailureLine(error.config ? instance.getUri(error.config) : undefined, error, elapsed(error.config)));
        return Promise.reject(error);
    });
}
//# sourceMappingURL=httpDebugLog.js.map