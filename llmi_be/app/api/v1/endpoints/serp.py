"""SERP "AI Overview Preview" endpoint.

POST /api/v1/serp/preview — pour jusqu'à 5 mots-clés + pays + appareil, renvoie
par mot-clé : la page HTML Google (pour iframe) + les sources structurées
(références AI Overview & résultats organiques, avec recoupement de domaines).
Temps réel, pas de persistance.
"""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.serp_preview import MAX_KEYWORDS, fetch_previews

logger = logging.getLogger(__name__)

router = APIRouter()


class SerpPreviewRequest(BaseModel):
    keywords: List[str] = Field(default_factory=list)
    geo: str = "US"
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
async def serp_preview(req: SerpPreviewRequest):
    device = req.device if req.device in ("desktop", "mobile") else "desktop"
    results = await fetch_previews(req.keywords[:MAX_KEYWORDS], req.geo, device)
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
