const API_BASE = '';

/** @param {string} token */
function headers(token) {
	const h = { 'Content-Type': 'application/json' };
	if (token) h['Authorization'] = `Bearer ${token}`;
	return h;
}

/**
 * @param {string} path
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {any} [options.body]
 * @param {string} [options.token]
 */
export async function api(path, { method = 'GET', body, token } = {}) {
	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers: headers(token),
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ detail: res.statusText }));
		throw new Error(err.detail || 'API error');
	}
	if (res.status === 204) return null;
	return res.json();
}
