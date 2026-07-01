"""SERP "AI Overview Preview" endpoint.

POST /api/v1/serp/preview — pour jusqu'à 5 mots-clés + pays + appareil, renvoie
par mot-clé : la page HTML Google (pour iframe) + les sources structurées
(références AI Overview & résultats organiques, avec recoupement de domaines).
Temps réel, pas de persistance.
"""

from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.serp_preview import MAX_KEYWORDS, fetch_previews

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
