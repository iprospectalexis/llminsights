from fastapi import APIRouter

from app.api.v1.endpoints.jobs import router as jobs_router
from app.api.v1.endpoints.api_keys import router as api_keys_router
from app.api.v1.endpoints.audits import router as audits_router

api_router = APIRouter()

api_router.include_router(
    jobs_router,
    prefix="/jobs",
    tags=["Jobs"],
)

api_router.include_router(
    api_keys_router,
    prefix="/api-keys",
    tags=["API Keys"],
)

api_router.include_router(
    audits_router,
    prefix="/audits",
    tags=["Audits"],
)
