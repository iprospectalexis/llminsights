"""SERP "AI Overview Preview" endpoint.

POST /api/v1/serp/preview — pour jusqu'à 5 mots-clés + pays + appareil, renvoie
par mot-clé : la page HTML Google (pour iframe) + les sources structurées
(références AI Overview & résultats organiques, avec recoupement de domaines).
Temps réel, pas de persistance.
"""

import asyncio
import hmac
import html
import json
import logging
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.serp_preview import MAX_KEYWORDS, fetch_previews

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Anti-abus : limite quotidienne d'analyses /preview par IP ────────────────
# L'outil est public et chaque mot-clé déclenche des appels DataForSEO (payants).
# On limite le nombre de requêtes /preview par IP et par jour (UTC). Compteur en
# mémoire (le conteneur tourne avec UVICORN_WORKERS=1) ; remis à zéro au
# redémarrage. Ajustable via l'env SERP_PREVIEW_DAILY_LIMIT (défaut 20).
try:
    PREVIEW_DAILY_LIMIT = int(os.getenv("SERP_PREVIEW_DAILY_LIMIT", "20"))
except ValueError:
    PREVIEW_DAILY_LIMIT = 20
_preview_hits: dict = {}  # ip -> [jour "YYYY-MM-DD", count]

# IP exemptées de la limite (collègues) : les IP par défaut ci-dessous + celles
# listées dans l'env SERP_PREVIEW_IP_WHITELIST (séparées par des virgules).
_DEFAULT_IP_WHITELIST = {"81.65.132.157", "88.181.106.232"}
PREVIEW_IP_WHITELIST = _DEFAULT_IP_WHITELIST | {
    ip.strip() for ip in os.getenv("SERP_PREVIEW_IP_WHITELIST", "").split(",") if ip.strip()
}

# Journal d'usage (JSONL) : 1 ligne par analyse, pour le suivi par heure/jour/IP.
# Écrit dans le volume persistant /app/results (cf. docker-compose) ; chemin
# ajustable via l'env SERP_USAGE_LOG.
SERP_USAGE_LOG = os.getenv("SERP_USAGE_LOG", "/app/results/serp_usage.jsonl")
# Token protégeant le dashboard d'usage (GET /serp/usage?token=…). Vide = accès
# refusé (le dashboard n'est pas exposé tant que ce token n'est pas défini).
SERP_USAGE_TOKEN = os.getenv("SERP_USAGE_TOKEN", "")


async def _log_usage(ip: str, device: str, pairs: list, results: list, whitelisted: bool) -> None:
    """Ajoute une ligne JSON au journal d'usage. Fire-and-forget : ne casse
    jamais la requête si l'écriture échoue."""
    try:
        rec = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "ip": ip,
            "device": device,
            "whitelisted": whitelisted,
            "keywords_count": len(pairs),
            "keywords": [k for (k, _g) in pairs],
            "geos": [g for (_k, g) in pairs],
            "results_count": len(results),
            "aio_count": sum(1 for r in results if r.get("has_aio")),
        }
        line = json.dumps(rec, ensure_ascii=False)

        def _write() -> None:
            path = Path(SERP_USAGE_LOG)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

        await asyncio.to_thread(_write)
    except Exception as exc:  # pragma: no cover - le suivi ne doit rien casser
        logger.warning("serp usage log failed: %r", exc)


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(ip: str) -> bool:
    """Incrémente le compteur du jour pour cette IP ; renvoie True si la limite
    est déjà atteinte (sans incrémenter au-delà). Les IP de la whitelist ne
    sont jamais limitées."""
    if ip in PREVIEW_IP_WHITELIST:
        return False
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if len(_preview_hits) > 5000:  # purge des entrées des jours précédents
        for k in [k for k, v in _preview_hits.items() if v[0] != today]:
            _preview_hits.pop(k, None)
    entry = _preview_hits.get(ip)
    if not entry or entry[0] != today:
        entry = [today, 0]
    if entry[1] >= PREVIEW_DAILY_LIMIT:
        _preview_hits[ip] = entry
        return True
    entry[1] += 1
    _preview_hits[ip] = entry
    return False


class SerpQuery(BaseModel):
    keyword: str = ""
    geo: str = "US"


class SerpPreviewRequest(BaseModel):
    queries: List[SerpQuery] = Field(default_factory=list)
    device: str = "desktop"


class SourceItem(BaseModel):
    title: str
    url: str
    source: str
    host: str
    shared: bool = False


class SerpPreviewResult(BaseModel):
    keyword: str
    ok: bool
    html: str = ""
    aio_sources: List[SourceItem] = Field(default_factory=list)
    organic_sources: List[SourceItem] = Field(default_factory=list)
    has_aio: bool = False
    error: Optional[str] = None


class SerpPreviewResponse(BaseModel):
    results: List[SerpPreviewResult]


# Endpoint volontairement PUBLIC (pas de verify_api_key) : l'outil AI Overview
# Preview est accessible sans connexion.
@router.post("/preview", response_model=SerpPreviewResponse)
async def serp_preview(req: SerpPreviewRequest, request: Request):
    ip = _client_ip(request)
    if _rate_limited(ip):
        raise HTTPException(
            status_code=429,
            detail=f"Limite quotidienne atteinte ({PREVIEW_DAILY_LIMIT} analyses par jour). "
            "Réessayez demain.",
        )
    device = req.device if req.device in ("desktop", "mobile") else "desktop"
    pairs = [(q.keyword, q.geo) for q in req.queries[:MAX_KEYWORDS] if (q.keyword or "").strip()]
    results = await fetch_previews(pairs, device)
    await _log_usage(ip, device, pairs, results, ip in PREVIEW_IP_WHITELIST)
    return {"results": results}


# ── Lead « Votre stratégie GEO » → e-mail ────────────────────────────────────

class GeoLeadRequest(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    message: str = ""


def _send_lead_email(lead: GeoLeadRequest) -> None:
    """Envoie la demande par e-mail via SMTP (bloquant → à lancer en thread)."""
    s = get_settings()
    if not (s.smtp_host and s.smtp_user and s.smtp_password):
        raise RuntimeError("SMTP non configuré (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)")

    name = f"{lead.first_name} {lead.last_name}".strip() or "(sans nom)"
    msg = EmailMessage()
    msg["Subject"] = f"[GEO] Nouvelle demande — {name}"
    msg["From"] = s.smtp_from or s.smtp_user
    msg["To"] = s.lead_email_to
    if lead.email.strip():
        msg["Reply-To"] = lead.email.strip()
    msg.set_content(
        "Nouvelle demande « Votre stratégie GEO »\n\n"
        f"Prénom / Nom : {name}\n"
        f"E-mail       : {lead.email or '-'}\n"
        f"Téléphone    : {lead.phone or '-'}\n\n"
        f"Message :\n{lead.message or '-'}\n"
    )

    context = ssl.create_default_context()
    if s.smtp_port == 465:
        with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=context, timeout=20) as server:
            server.login(s.smtp_user, s.smtp_password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(s.smtp_user, s.smtp_password)
            server.send_message(msg)


# Endpoint PUBLIC (pas de verify_api_key) : formulaire de la page publique.
@router.post("/lead")
async def serp_lead(req: GeoLeadRequest):
    if not req.email.strip() or not (req.first_name.strip() or req.last_name.strip()):
        raise HTTPException(status_code=422, detail="Prénom/nom et e-mail requis.")
    try:
        await asyncio.to_thread(_send_lead_email, req)
    except Exception as exc:  # pragma: no cover - dépend du SMTP externe
        logger.warning("GEO lead email failed: %r", exc)
        raise HTTPException(status_code=502, detail="Envoi de l'e-mail impossible pour le moment.")
    return {"ok": True}


# ── Dashboard d'usage (protégé par token) ────────────────────────────────────

def _aggregate_usage() -> dict:
    """Lit le journal JSONL et agrège par jour, heure (UTC), IP et mot-clé."""
    days: dict = {}
    hours = [0] * 24
    ips: dict = {}
    kw: dict = {}
    tot_analyses = tot_keywords = tot_results = tot_aio = 0
    path = Path(SERP_USAGE_LOG)
    if path.exists():
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                ts = str(r.get("ts") or "")
                kc = int(r.get("keywords_count") or 0)
                rc = int(r.get("results_count") or 0)
                ac = int(r.get("aio_count") or 0)
                tot_analyses += 1
                tot_keywords += kc
                tot_results += rc
                tot_aio += ac
                d = days.setdefault(ts[:10], {"analyses": 0, "keywords": 0})
                d["analyses"] += 1
                d["keywords"] += kc
                try:
                    hours[int(ts[11:13])] += 1
                except (ValueError, IndexError):
                    pass
                ip = str(r.get("ip") or "?")
                e = ips.setdefault(ip, {"analyses": 0, "keywords": 0, "last": ""})
                e["analyses"] += 1
                e["keywords"] += kc
                if ts > e["last"]:
                    e["last"] = ts
                for k in (r.get("keywords") or []):
                    k = str(k or "").strip().lower()
                    if k:
                        kw[k] = kw.get(k, 0) + 1
    top_ips = sorted(ips.items(), key=lambda x: x[1]["analyses"], reverse=True)[:25]
    top_kw = sorted(kw.items(), key=lambda x: x[1], reverse=True)[:25]
    return {
        "totals": {
            "analyses": tot_analyses,
            "keywords": tot_keywords,
            "unique_ips": len(ips),
            "aio_rate": round(100 * tot_aio / tot_results, 1) if tot_results else 0,
        },
        "days": [{"day": d, "analyses": v["analyses"], "keywords": v["keywords"]}
                 for d, v in sorted(days.items())],
        "hours": hours,
        "top_ips": [{"ip": ip, "analyses": v["analyses"], "keywords": v["keywords"], "last": v["last"][:16]}
                    for ip, v in top_ips],
        "top_keywords": [{"keyword": k, "count": c} for k, c in top_kw],
    }


def _dashboard_html(data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    t = data["totals"]
    rows_ip = "".join(
        f"<tr><td>{html.escape(x['ip'])}</td><td>{x['analyses']}</td>"
        f"<td>{x['keywords']}</td><td>{html.escape(x['last'])}</td></tr>"
        for x in data["top_ips"]
    ) or '<tr><td colspan="4" class="muted">Aucune donnée</td></tr>'
    rows_kw = "".join(
        f"<tr><td>{html.escape(x['keyword'])}</td><td>{x['count']}</td></tr>"
        for x in data["top_keywords"]
    ) or '<tr><td colspan="2" class="muted">Aucune donnée</td></tr>'
    return (
        '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>Usage — AI Overview Preview</title>"
        '<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>'
        "<style>"
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f172a;color:#e2e8f0;padding:24px}"
        "h1{font-size:20px;margin:0 0 16px}h2{font-size:15px;margin:28px 0 10px;color:#cbd5e1}"
        ".cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}"
        ".card{background:#1e293b;border-radius:12px;padding:16px}.card .n{font-size:26px;font-weight:600}"
        ".card .l{font-size:12px;color:#94a3b8;margin-top:4px}"
        ".charts{display:grid;grid-template-columns:1fr 1fr;gap:24px}"
        ".tables{display:grid;grid-template-columns:1fr 1fr;gap:24px}"
        "@media(max-width:800px){.charts,.tables{grid-template-columns:1fr}}"
        "table{width:100%;border-collapse:collapse;font-size:13px}"
        "th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #334155}th{color:#94a3b8;font-weight:500}"
        ".muted{color:#64748b;font-style:italic}"
        "canvas{max-height:280px;background:#1e293b;border-radius:12px;padding:8px}"
        "</style></head><body>"
        "<h1>Usage — AI Overview Preview</h1>"
        '<div class="cards">'
        f'<div class="card"><div class="n">{t["analyses"]}</div><div class="l">Analyses</div></div>'
        f'<div class="card"><div class="n">{t["keywords"]}</div><div class="l">Mots-clés</div></div>'
        f'<div class="card"><div class="n">{t["unique_ips"]}</div><div class="l">IP uniques</div></div>'
        f'<div class="card"><div class="n">{t["aio_rate"]}%</div><div class="l">Taux AI Overview</div></div>'
        "</div>"
        '<div class="charts"><div><h2>Analyses par jour</h2><canvas id="cDay"></canvas></div>'
        '<div><h2>Analyses par heure (UTC)</h2><canvas id="cHour"></canvas></div></div>'
        '<div class="tables">'
        '<div><h2>Top IP</h2><table><thead><tr><th>IP</th><th>Analyses</th><th>Mots-clés</th>'
        f"<th>Dernier (UTC)</th></tr></thead><tbody>{rows_ip}</tbody></table></div>"
        '<div><h2>Top mots-clés</h2><table><thead><tr><th>Mot-clé</th><th>Nb</th></tr></thead>'
        f"<tbody>{rows_kw}</tbody></table></div>"
        "</div>"
        f"<script>const D={payload};"
        "Chart.defaults.color='#94a3b8';Chart.defaults.borderColor='#334155';"
        "new Chart(document.getElementById('cDay'),{type:'bar',data:{labels:D.days.map(d=>d.day),"
        "datasets:[{label:'Analyses',data:D.days.map(d=>d.analyses),backgroundColor:'#6366f1'}]},"
        "options:{plugins:{legend:{display:false}}}});"
        "new Chart(document.getElementById('cHour'),{type:'bar',data:{labels:[...Array(24).keys()].map(h=>h+'h'),"
        "datasets:[{label:'Analyses',data:D.hours,backgroundColor:'#ec4899'}]},"
        "options:{plugins:{legend:{display:false}}}});"
        "</script></body></html>"
    )


# Dashboard protégé par token : GET /api/v1/serp/usage?token=…&format=html|json
@router.get("/usage")
async def serp_usage(token: str = "", format: str = "html"):
    if not SERP_USAGE_TOKEN or not hmac.compare_digest(token, SERP_USAGE_TOKEN):
        raise HTTPException(status_code=403, detail="Accès refusé.")
    data = await asyncio.to_thread(_aggregate_usage)
    if format == "json":
        return JSONResponse(data)
    return HTMLResponse(_dashboard_html(data))
