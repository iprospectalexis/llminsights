"""SERP "AI Overview Preview" — page HTML Google + sources (AIO + organique).

Pour un mot-clé / pays / appareil, on appelle DataForSEO en parallèle :
  • /v3/serp/google/organic/live/html     → la page HTML (pour l'iframe),
    avec load_async_ai_overview + expand_ai_overview.
  • /v3/serp/google/organic/live/advanced → données structurées (références de
    l'AI Overview + résultats organiques) pour la colonne « Sources ».

On n'expose les sources de l'AI Overview QUE si l'AIO est réellement présent
dans le HTML servi à l'iframe (les deux endpoints sont des requêtes Google
distinctes et non déterministes ; cf. `_aio_rendered_in_html`).

Réutilise la config et la carte pays de `dataforseo_client`. Indépendant du
pipeline d'audit (temps réel, pas de persistance).
"""

import asyncio
import base64
import logging
import re
from html import unescape
from urllib.parse import urlparse

import httpx

from app.config import get_settings
from app.services.dataforseo_client import COUNTRY_LOCATION_LANG, DEFAULT_LOCATION_LANG

logger = logging.getLogger(__name__)
settings = get_settings()

HTML_PATH = "/v3/serp/google/organic/live/html"
ADVANCED_PATH = "/v3/serp/google/organic/live/advanced"

# Pays manquants dans dataforseo_client.COUNTRY_LOCATION_LANG.
_EXTRA_LOCATION_LANG = {"JP": (2392, "ja")}

MAX_KEYWORDS = 5

_BASE_TAGS = '<base href="https://www.google.com/"><base target="_blank">'
_HEAD_RE = re.compile(r"(<head\b[^>]*>)", re.IGNORECASE)
_HTML_RE = re.compile(r"(<html\b[^>]*>)", re.IGNORECASE)
_NOSCRIPT_RE = re.compile(r"<noscript\b[^>]*>.*?</noscript>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_NONWORD_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+")


def _auth_headers() -> dict:
    token = base64.b64encode(
        f"{settings.dataforseo_login}:{settings.dataforseo_password}".encode()
    ).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


def _resolve(country: str):
    key = (country or "").strip().upper()
    return _EXTRA_LOCATION_LANG.get(key) or COUNTRY_LOCATION_LANG.get(key, DEFAULT_LOCATION_LANG)


def host_of(url: str) -> str:
    if not url:
        return ""
    try:
        h = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def prepare_for_iframe(html: str) -> str:
    """Injecte <base href>/<base target> et retire les <noscript> (bandeaux
    « cliquez ici si vous n'avez pas été redirigé »)."""
    if not html:
        return html
    html = _NOSCRIPT_RE.sub("", html)
    new_html, n = _HEAD_RE.subn(lambda m: m.group(1) + _BASE_TAGS, html, count=1)
    if n:
        return new_html
    new_html, n = _HTML_RE.subn(lambda m: m.group(1) + "<head>" + _BASE_TAGS + "</head>", html, count=1)
    if n:
        return new_html
    return "<head>" + _BASE_TAGS + "</head>" + html


def _normalize(text: str) -> str:
    text = unescape(text or "")
    text = _TAG_RE.sub(" ", text)
    text = _NONWORD_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip().lower()


def _gather_refs(aio: dict) -> list:
    """Toutes les références (sources) citées par l'AI Overview, à plat."""
    refs = list(aio.get("references") or [])
    for el in (aio.get("items") or []):
        refs.extend(el.get("references") or [])
        for ln in (el.get("links") or []):
            if ln.get("url"):
                refs.append({"url": ln.get("url"), "title": ln.get("title"),
                             "domain": ln.get("domain"), "source": None})
    return refs


def _aio_ref_hosts(aio: dict) -> set:
    hosts = set()
    for ref in _gather_refs(aio):
        h = (ref.get("domain") or host_of(ref.get("url") or "")).lower()
        if h.startswith("www."):
            h = h[4:]
        if h:
            hosts.add(h)
    return hosts


def _aio_rendered_in_html(aio: dict, html: str) -> bool:
    """Vrai si l'AI Overview de `/advanced` correspond à un AIO réellement
    affiché dans le HTML de l'iframe.

    Les deux endpoints sont des requêtes Google indépendantes : pour un même
    mot-clé l'AIO existe des deux côtés, mais sa *formulation* diffère souvent.
    On accepte donc deux signaux (l'un OU l'autre suffit) :
      1. texte   — un 7-gramme du texte de l'AIO apparaît dans le HTML ;
      2. sources — au moins 2 domaines cités par l'AIO apparaissent dans le
                   HTML (même AIO, rédaction différente → mêmes sources citées).
    """
    if not html:
        return False
    html_norm = _normalize(html)

    # Signal 1 — chevauchement de texte (formulation identique).
    text = aio.get("markdown") or ""
    if not text:
        text = " ".join(
            (el.get("snippet") or el.get("text") or "") for el in (aio.get("items") or [])
        )
    words = _normalize(text).split()
    if len(words) >= 7:
        step = max(1, (len(words) - 7) // 5)
        for i in range(0, len(words) - 6, step):
            if " ".join(words[i:i + 7]) in html_norm:
                return True

    # Signal 2 — chevauchement des sources citées (formulation différente).
    hosts = _aio_ref_hosts(aio)
    if len(hosts) >= 2:
        html_lower = html.lower()
        if sum(1 for h in hosts if h in html_lower) >= 2:
            return True

    return False


def _src(url, title, source, fallback_domain):
    host = host_of(url) or (fallback_domain or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return {
        "title": title or source or host,
        "url": url,
        "source": source or host,
        "host": host,
    }


def _extract_sources(items: list, html: str):
    """items 'advanced' + html → (aio_sources, organic_sources)."""
    aio_sources, organic_sources = [], []

    aio = next((it for it in items if it.get("type") == "ai_overview"), None)
    if aio and _aio_rendered_in_html(aio, html):
        seen = set()
        for ref in _gather_refs(aio):
            url = ref.get("url")
            if not url or url in seen:
                continue
            seen.add(url)
            aio_sources.append(_src(url, ref.get("title"), ref.get("source"), ref.get("domain")))

    seen_o = set()
    for it in items:
        if it.get("type") != "organic":
            continue
        url = it.get("url")
        if not url or url in seen_o:
            continue
        seen_o.add(url)
        organic_sources.append(_src(url, it.get("title"), None, it.get("domain")))

    return aio_sources, organic_sources


def _mark_shared(aio_sources: list, organic_sources: list) -> None:
    aio_hosts = {s["host"] for s in aio_sources if s["host"]}
    org_hosts = {s["host"] for s in organic_sources if s["host"]}
    shared = aio_hosts & org_hosts
    for s in aio_sources:
        s["shared"] = s["host"] in shared
    for s in organic_sources:
        s["shared"] = s["host"] in shared


async def _post_task(client: httpx.AsyncClient, path: str, payload: list) -> dict:
    resp = await client.post(
        f"{settings.dataforseo_base_url.rstrip('/')}{path}", json=payload, headers=_auth_headers()
    )
    resp.raise_for_status()
    data = resp.json()
    tasks = data.get("tasks") or []
    task = tasks[0] if tasks else {}
    if task.get("status_code") != 20000:
        raise RuntimeError(f"DataForSEO task {task.get('status_code')}: {task.get('status_message')}")
    return task


def _first_items(task: dict) -> list:
    res = (task.get("result") or [{}])[0] or {}
    return res.get("items") or []


async def _fetch_one(keyword: str, country: str, device: str) -> dict:
    location_code, language_code = _resolve(country)
    dev = "mobile" if device == "mobile" else "desktop"
    os_name = "android" if dev == "mobile" else "windows"

    html_payload = [{
        "keyword": keyword, "location_code": location_code, "language_code": language_code,
        "device": dev, "os": os_name,
        "load_async_ai_overview": True, "expand_ai_overview": True,
    }]
    adv_payload = [{
        "keyword": keyword, "location_code": location_code, "language_code": language_code,
        "device": dev, "os": os_name, "depth": 20, "load_async_ai_overview": True,
    }]
    timeout = httpx.Timeout(120.0, connect=15.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            html_task, adv_task = await asyncio.gather(
                _post_task(client, HTML_PATH, html_payload),
                _post_task(client, ADVANCED_PATH, adv_payload),
                return_exceptions=True,
            )
    except Exception as exc:  # pragma: no cover - garde-fou réseau
        logger.warning("SERP preview fetch failed (%r): %r", keyword, exc)
        return {"keyword": keyword, "ok": False, "error": "Erreur réseau.",
                "html": "", "aio_sources": [], "organic_sources": [], "has_aio": False}

    if isinstance(html_task, Exception):
        logger.warning("SERP preview html error (%r): %r", keyword, html_task)
        return {"keyword": keyword, "ok": False,
                "error": "Impossible de récupérer la page Google. Réessayez.",
                "html": "", "aio_sources": [], "organic_sources": [], "has_aio": False}

    items_html = _first_items(html_task)
    html = items_html[0].get("html") if items_html and isinstance(items_html[0], dict) else ""
    html = prepare_for_iframe(html or "")
    if not html.strip():
        return {"keyword": keyword, "ok": False, "error": "Réponse vide de Google. Réessayez.",
                "html": "", "aio_sources": [], "organic_sources": [], "has_aio": False}

    aio_sources, organic_sources = [], []
    if not isinstance(adv_task, Exception):
        aio_sources, organic_sources = _extract_sources(_first_items(adv_task), html)
    else:
        logger.warning("SERP preview advanced error (%r): %r", keyword, adv_task)
    _mark_shared(aio_sources, organic_sources)

    return {
        "keyword": keyword,
        "ok": True,
        "html": html,
        "aio_sources": aio_sources,
        "organic_sources": organic_sources,
        "has_aio": bool(aio_sources),
        "error": None,
    }


async def fetch_previews(keywords: list, country: str, device: str) -> list:
    """Récupère la preview (page + sources) pour chaque mot-clé, en parallèle."""
    kws, seen = [], set()
    for kw in keywords:
        k = (kw or "").strip()
        low = k.lower()
        if k and low not in seen:
            seen.add(low)
            kws.append(k)
    kws = kws[:MAX_KEYWORDS]

    sem = asyncio.Semaphore(getattr(settings, "dataforseo_max_concurrent", 10) or 5)

    async def _bounded(kw):
        async with sem:
            return await _fetch_one(kw, country, device)

    return list(await asyncio.gather(*[_bounded(kw) for kw in kws]))
