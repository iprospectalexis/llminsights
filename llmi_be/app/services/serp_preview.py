"""SERP "AI Overview Preview" — page HTML Google + sources (AIO + organique).

Pour un mot-clé / pays / appareil, on récupère TOUT depuis un SEUL fetch Google
(recommandation du support DataForSEO), ce qui garantit que l'iframe et la
colonne « Sources » proviennent exactement du même résultat :

  1. /v3/serp/google/organic/live/html              → la page HTML (pour
     l'iframe) avec load_async_ai_overview + expand_ai_overview ; la réponse
     fournit aussi un `task id`.
  2. /v3/serp/google/organic/task_get/advanced/{id} → données structurées
     (références de l'AI Overview + résultats organiques) DU MÊME fetch.

Comme les deux proviennent du même résultat Google, plus besoin d'heuristique
pour deviner si l'AIO du JSON correspond à celui du HTML : s'il est présent dans
l'un, il l'est dans l'autre (texte et sources identiques).

Réutilise la config et la carte pays de `dataforseo_client`. Indépendant du
pipeline d'audit (temps réel, pas de persistance).
"""

import asyncio
import base64
import logging
import re
from urllib.parse import urlparse

import httpx

from app.config import get_settings
from app.services.dataforseo_client import COUNTRY_LOCATION_LANG, DEFAULT_LOCATION_LANG

logger = logging.getLogger(__name__)
settings = get_settings()

HTML_PATH = "/v3/serp/google/organic/live/html"
TASK_GET_ADVANCED_PATH = "/v3/serp/google/organic/task_get/advanced/"

# Pays manquants dans dataforseo_client.COUNTRY_LOCATION_LANG.
_EXTRA_LOCATION_LANG = {"JP": (2392, "ja")}

MAX_KEYWORDS = 5

_BASE_TAGS = '<base href="https://www.google.com/"><base target="_blank">'
_HEAD_RE = re.compile(r"(<head\b[^>]*>)", re.IGNORECASE)
_HTML_RE = re.compile(r"(<html\b[^>]*>)", re.IGNORECASE)
_NOSCRIPT_RE = re.compile(r"<noscript\b[^>]*>.*?</noscript>", re.IGNORECASE | re.DOTALL)


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


def _extract_sources(items: list):
    """items 'advanced' (MÊME fetch que le HTML) → (aio_sources, organic_sources).

    Plus d'heuristique : l'AIO structuré provient du même résultat Google que le
    HTML de l'iframe (task_get/advanced sur l'id du live/html), donc s'il est
    présent ici il l'est aussi dans l'iframe."""
    aio_sources, organic_sources = [], []

    aio = next((it for it in items if it.get("type") == "ai_overview"), None)
    if aio:
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


async def _get_task(client: httpx.AsyncClient, path: str, tries: int = 4) -> dict:
    """GET task_get/… ; relance brièvement si le résultat n'est pas encore prêt.
    En pratique il l'est immédiatement pour une tâche live déjà terminée."""
    last = {}
    for attempt in range(tries):
        resp = await client.get(
            f"{settings.dataforseo_base_url.rstrip('/')}{path}", headers=_auth_headers()
        )
        resp.raise_for_status()
        last = ((resp.json().get("tasks") or [{}])[0]) or {}
        if last.get("status_code") == 20000 and last.get("result"):
            return last
        if attempt < tries - 1:
            await asyncio.sleep(2.0)
    raise RuntimeError(f"DataForSEO task_get {last.get('status_code')}: {last.get('status_message')}")


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
    timeout = httpx.Timeout(120.0, connect=15.0)

    aio_sources, organic_sources = [], []
    html = ""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1) UN seul fetch Google : live/html → page HTML (iframe) + task id.
            html_task = await _post_task(client, HTML_PATH, html_payload)
            task_id = html_task.get("id")

            items_html = _first_items(html_task)
            raw_html = items_html[0].get("html") if items_html and isinstance(items_html[0], dict) else ""
            html = prepare_for_iframe(raw_html or "")
            if not html.strip():
                return {"keyword": keyword, "ok": False, "error": "Réponse vide de Google. Réessayez.",
                        "html": "", "aio_sources": [], "organic_sources": [], "has_aio": False}

            # 2) Sources structurées DU MÊME fetch : task_get/advanced/{id}.
            if task_id:
                try:
                    adv_task = await _get_task(client, TASK_GET_ADVANCED_PATH + str(task_id))
                    aio_sources, organic_sources = _extract_sources(_first_items(adv_task))
                except Exception as exc:  # pragma: no cover - sources best-effort
                    logger.warning("SERP preview task_get/advanced failed (%r): %r", keyword, exc)
    except Exception as exc:  # pragma: no cover - garde-fou réseau
        logger.warning("SERP preview fetch failed (%r): %r", keyword, exc)
        return {"keyword": keyword, "ok": False,
                "error": "Impossible de récupérer la page Google. Réessayez.",
                "html": "", "aio_sources": [], "organic_sources": [], "has_aio": False}

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
