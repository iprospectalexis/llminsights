from fastapi import APIRouter, Depends

from app.api.deps import verify_audit_access

from app.api.v1.endpoints.jobs import router as jobs_router
from app.api.v1.endpoints.api_keys import router as api_keys_router
from app.api.v1.endpoints.audits import router as audits_router
from app.api.v1.endpoints.serp import router as serp_router

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
    # Every audits endpoint requires a signed-in Supabase user (the browser
    # sends its session token) or the master API key (ops). POST /audits/run
    # spends provider credits, so this surface must not stay open.
    dependencies=[Depends(verify_audit_access)],
)

api_router.include_router(
    serp_router,
    prefix="/serp",
    tags=["SERP"],
)
