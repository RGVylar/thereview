"""Resolve preview thumbnail URLs for meme links (server-side; avoids browser CORS on oEmbed)."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

_IMG_EXT = re.compile(r"\.(jpg|jpeg|png|gif|webp|avif)(\?|$)", re.I)


def _youtube_video_id(url: str) -> str | None:
    try:
        u = urllib.parse.urlparse(url)
        host = (u.hostname or "").replace("www.", "")
        if host == "youtu.be":
            vid = u.path.strip("/").split("/")[0]
            return vid if vid else None
        if "youtube.com" in host:
            q = urllib.parse.parse_qs(u.query)
            if "v" in q and q["v"]:
                return q["v"][0]
            m = re.match(r"/shorts/([^/?]+)", u.path)
            if m:
                return m.group(1)
            m = re.match(r"/embed/([^/?]+)", u.path)
            if m:
                return m.group(1)
    except Exception:
        pass
    return None


def _tiktok_thumbnail(url: str) -> str | None:
    try:
        oembed_url = "https://www.tiktok.com/oembed?url=" + urllib.parse.quote(
            url, safe=""
        )
        req = urllib.request.Request(
            oembed_url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TheReview/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        thumb = data.get("thumbnail_url")
        return str(thumb) if thumb else None
    except Exception:
        return None


def embed_thumbnail_url(url: str) -> str | None:
    """Return a thumbnail image URL when we can resolve one cheaply."""
    if not url:
        return None
    if _IMG_EXT.search(url):
        return url

    yt = _youtube_video_id(url)
    if yt:
        return f"https://img.youtube.com/vi/{yt}/hqdefault.jpg"

    try:
        u = urllib.parse.urlparse(url)
        host = (u.hostname or "").replace("www.", "")
    except Exception:
        return None

    if "tiktok.com" in host or host == "tiktokv.com":
        return _tiktok_thumbnail(url)

    return None


def batch_embed_thumbnails(urls: list[str]) -> dict[str, str | None]:
    """Resolve thumbnails for unique URLs; parallelizes TikTok oEmbed fetches."""
    unique = list(dict.fromkeys(urls))
    out: dict[str, str | None] = {}

    need_network: list[str] = []
    for u in unique:
        if not u:
            out[u] = None
            continue
        if _IMG_EXT.search(u):
            out[u] = u
            continue
        yt = _youtube_video_id(u)
        if yt:
            out[u] = f"https://img.youtube.com/vi/{yt}/hqdefault.jpg"
            continue
        try:
            host = urllib.parse.urlparse(u).hostname or ""
            host = host.replace("www.", "")
        except Exception:
            out[u] = None
            continue
        if "tiktok.com" in host or host == "tiktokv.com":
            need_network.append(u)
        else:
            out[u] = None

    if need_network:
        with ThreadPoolExecutor(max_workers=min(12, max(1, len(need_network)))) as ex:
            futures = {ex.submit(_tiktok_thumbnail, u): u for u in need_network}
            for fut in as_completed(futures):
                u = futures[fut]
                try:
                    out[u] = fut.result()
                except Exception:
                    out[u] = None

    return out
