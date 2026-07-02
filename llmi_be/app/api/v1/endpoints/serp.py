"""SERP "AI Overview Preview" endpoint.

POST /api/v1/serp/preview — pour jusqu'à 5 mots-clés + pays + appareil, renvoie
par mot-clé : la page HTML Google (pour iframe) + les sources structurées
(références AI Overview & résultats organiques, avec recoupement de domaines).
Temps réel, pas de persistance.
"""

import asyncio
import logging
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
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
    if _rate_limited(_client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail=f"Limite quotidienne atteinte ({PREVIEW_DAILY_LIMIT} analyses par jour). "
            "Réessayez demain.",
        )
    device = req.device if req.device in ("desktop", "mobile") else "desktop"
    queries = [(q.keyword, q.geo) for q in req.queries[:MAX_KEYWORDS]]
    results = await fetch_previews(queries, device)
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
