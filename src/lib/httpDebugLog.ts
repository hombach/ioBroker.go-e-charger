import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";

/** Characters of an error answer that are logged - enough for a go-e error text, not a full status */
export const HTTP_DEBUG_BODY_LIMIT = 300;

/**
 * Length of a response body for the debug log. Successful bodies are never logged themselves: they hold
 * RFID card names (`c0n` ... `c9n`) and, unfiltered, network and device details.
 *
 * @param data response body (a string, as the adapter reads every answer with `transformResponse: r => r`)
 * @returns the length in characters
 */
export function httpBodyLength(data: unknown): number {
	if (data === undefined || data === null) {
		return 0;
	}
	return typeof data === "string" ? data.length : JSON.stringify(data).length;
}

/**
 * Debug line before a request.
 *
 * @param method HTTP method
 * @param url full URL
 * @returns e.g. `HTTP GET http://192.168.0.10/status`
 */
export function httpRequestLine(method: string | undefined, url: string | undefined): string {
	return `HTTP ${(method ?? "get").toUpperCase()} ${url ?? "?"}`;
}

/**
 * Debug line after a successful request - status, duration and length, never the body.
 *
 * @param url full URL
 * @param status HTTP status
 * @param durationMs duration in ms (`NaN` when unknown)
 * @param data response body
 * @returns e.g. `HTTP 200 in 42 ms, 1834 chars: http://192.168.0.10/api/set?frc=2`
 */
export function httpResponseLine(url: string | undefined, status: number, durationMs: number, data: unknown): string {
	return `HTTP ${status} in ${formatDuration(durationMs)}, ${httpBodyLength(data)} chars: ${url ?? "?"}`;
}

/**
 * Debug line after a failed request - the HTTP status and the start of the answer, or the error without one.
 *
 * @param url full URL
 * @param error error axios threw
 * @param durationMs duration in ms (`NaN` when unknown)
 * @returns e.g. `HTTP 400 in 12 ms: http://.../status - answer (48 chars): "The WebSocket handshake Upgrade field is missing"`
 */
export function httpFailureLine(url: string | undefined, error: unknown, durationMs: number): string {
	const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
	if (response && typeof response.status === "number") {
		const data = response.data;
		const body = typeof data === "string" ? data : data === undefined || data === null ? "" : JSON.stringify(data);
		const shown = body.length > HTTP_DEBUG_BODY_LIMIT ? `${body.slice(0, HTTP_DEBUG_BODY_LIMIT)}...` : body;
		return `HTTP ${response.status} in ${formatDuration(durationMs)}: ${url ?? "?"} - answer (${body.length} chars): ${JSON.stringify(shown)}`;
	}
	const code = (error as { code?: unknown } | null)?.code;
	const message = error instanceof Error ? error.message : String(error);
	return `HTTP request failed after ${formatDuration(durationMs)}: ${url ?? "?"} - ${typeof code === "string" ? `${code}: ` : ""}${message}`;
}

function formatDuration(durationMs: number): string {
	return Number.isFinite(durationMs) ? `${Math.round(durationMs)} ms` : "? ms";
}

/**
 * Logs every request of an axios instance at debug level: the URL before it, and status, duration and
 * response length after it; for an error answer its status and up to {@link HTTP_DEBUG_BODY_LIMIT}
 * characters of it. The URLs to the chargers hold no tokens or passwords.
 *
 * @param instance axios instance the adapter talks to the chargers with
 * @param debug debug logger, e.g. `message => this.log.debug(message)`
 * @param now clock in ms (for tests)
 */
export function attachHttpDebugLog(instance: AxiosInstance, debug: (message: string) => void, now: () => number = Date.now): void {
	const started = new WeakMap<object, number>();
	const elapsed = (config: object | undefined): number => {
		const start = config ? started.get(config) : undefined;
		return start === undefined ? Number.NaN : now() - start;
	};
	instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
		started.set(config, now());
		debug(httpRequestLine(config.method, instance.getUri(config)));
		return config;
	});
	instance.interceptors.response.use(
		(response: AxiosResponse) => {
			debug(httpResponseLine(instance.getUri(response.config), response.status, elapsed(response.config), response.data));
			return response;
		},
		(error: AxiosError) => {
			debug(httpFailureLine(error.config ? instance.getUri(error.config) : undefined, error, elapsed(error.config)));
			return Promise.reject(error);
		},
	);
}
