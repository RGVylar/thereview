/**
 * Detect embed type from URL.
 * @param {string} url
 * @returns {{ type: 'tiktok' | 'twitter' | 'instagram' | 'youtube' | 'image' | 'link', embedUrl?: string }}
 */
export function detectEmbed(url) {
	try {
		const u = new URL(url);
		const host = u.hostname.replace('www.', '');

		if (host.includes('tiktok.com')) {
			return { type: 'tiktok' };
		}
		if (host === 'twitter.com' || host === 'x.com') {
			return { type: 'twitter' };
		}
		if (host.includes('instagram.com')) {
			return { type: 'instagram' };
		}
		if (host.includes('youtube.com') || host === 'youtu.be') {
			const videoId = host === 'youtu.be'
				? u.pathname.slice(1)
				: u.searchParams.get('v');
			if (videoId) {
				return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
			}
		}
		if (/\.(jpg|jpeg|png|gif|webp)$/i.test(u.pathname)) {
			return { type: 'image' };
		}
	} catch {
		// invalid URL
	}
	return { type: 'link' };
}
