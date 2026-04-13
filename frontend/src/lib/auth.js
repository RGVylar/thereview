import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createAuthStore() {
	const stored = browser ? localStorage.getItem('auth') : null;
	const initial = stored ? JSON.parse(stored) : { token: null, user: null };

	const { subscribe, set, update } = writable(initial);

	return {
		subscribe,
		login(token, user) {
			const val = { token, user };
			if (browser) localStorage.setItem('auth', JSON.stringify(val));
			set(val);
		},
		logout() {
			if (browser) localStorage.removeItem('auth');
			set({ token: null, user: null });
		}
	};
}

export const auth = createAuthStore();
