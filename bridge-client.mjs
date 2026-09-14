export class BridgeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BridgeError';
    Object.assign(this, details);
  }
}

export class BridgeClient {
  constructor(baseUrl = 'http://127.0.0.1:49620', { timeoutMs = 35_000, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    if (typeof this.fetchImpl !== 'function') throw new BridgeError('Node fetch is unavailable; use Node 20 or newer.');
  }

  async request(path, { method = 'GET', body, timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
      if (!response.ok) {
        throw new BridgeError(`Bridge ${method} ${path} failed (${response.status}): ${payload.error || text}`, {
          status: response.status, payload,
        });
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new BridgeError(`Bridge ${method} ${path} timed out after ${timeoutMs}ms`);
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(`Bridge ${method} ${path} failed: ${error.message || error}`);
    } finally {
      clearTimeout(timer);
    }
  }

  health() { return this.request('/health'); }
  windows() { return this.request('/eda-windows'); }

  /** Execute against an explicit window; never fall back to bridge active state. */
  async execute(code, windowId, { timeoutMs = this.timeoutMs } = {}) {
    if (!windowId) throw new BridgeError('An explicit EasyEDA windowId is required for fail-closed capture.');
    const result = await this.request('/execute', { method: 'POST', body: { code, windowId }, timeoutMs });
    if (result?.success === false) throw new BridgeError(result.error || 'EasyEDA execution failed.', { payload: result });
    return result?.result;
  }
}
