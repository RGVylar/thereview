/**
 * Detect embed type from URL.
 * @param {string} url
 * @returns {{ type: 'tiktok' | 'twitter' | 'instagram' | 'youtube' | 'image' | 'link', embedUrl?: string, oEmbedUrl?: string }}
 */
export function detectEmbed(url) {
	try {
		const u = new URL(url);
		const host = u.hostname.replace('www.', '');

		if (host.includes('tiktok.com') || host === 'tiktokv.com') {
			return {
				type: 'tiktok',
				// player/v1 is TikTok's official embed API (embed/v2 is legacy and ignores URL params).
				// autoplay=1 works when the parent page has sticky user activation (any prior click).
				// In this app the user always clicks "Ready" or "Start" before seeing memes, so
				// sticky activation is always present and Chrome allows unmuted autoplay via allow="autoplay".
				embedUrl: `https://www.tiktok.com/player/v1/${extractTikTokId(u)}?autoplay=1&loop=0`,
			};
		}
		if (host === 'twitter.com' || host === 'x.com') {
			return {
				type: 'twitter',
				oEmbedUrl: `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&theme=dark&dnt=true&omit_script=true`,
			};
		}
		if (host.includes('instagram.com')) {
			// Instagram embed: add /embed to the post URL
			const postUrl = url.split('?')[0].replace(/\/$/, '');
			return {
				type: 'instagram',
				embedUrl: `${postUrl}/embed`,
			};
		}
		if (host.includes('youtube.com') || host === 'youtu.be') {
			const videoId = host === 'youtu.be'
				? u.pathname.slice(1)
				: u.searchParams.get('v');
			if (videoId) {
				return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${videoId}` };
			}
		}
		if (/\.(jpg|jpeg|png|gif|webp|avif)$/i.test(u.pathname)) {
			return { type: 'image' };
		}
	} catch {
		// invalid URL
	}
	return { type: 'link' };
}

/** @param {URL} u */
function extractTikTokId(u) {
	// https://www.tiktok.com/@user/video/1234567890
	const match = u.pathname.match(/\/video\/(\d+)/);
	return match ? match[1] : '';
}
