"""Provider health registry + failover chains.

Single source of truth for "which scraping provider should serve this LLM
right now". Serves two resilience goals:

  1. Keep collecting when one account runs out of funds — billing errors
     open that provider's circuit for BILLING_COOLDOWN and traffic shifts to
     the next provider in the chain; after the cooldown one probe request is
     allowed (half-open), so a topped-up account rejoins automatically.
  2. Keep collecting when a provider is down/erroring — repeated transient
     failures open a short circuit; new jobs and per-row failovers route to
     the alternate provider immediately.

Decision points that consult this module:
  - run_audit / retry-llm: pick the starting provider (configured provider
    first, then the chain) skipping open circuits and missing credentials.
  - handle_polling: when a job hard-fails or rows exhaust, pick the next
    provider in the chain for the re-trigger.
  - job_processor / dataforseo_client: report outcomes into the registry.

State is in-memory — the backend runs a single worker by design
(UVICORN_WORKERS=1, see docker-compose). A restart resets circuits; they
re-learn within a few requests, and a stale-open circuit can't happen.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ── Capabilities & chains ────────────────────────────────────────────

# What each provider can actually scrape TODAY (clients implemented).
# DataForSEO's ai_optimization API also offers ChatGPT/Perplexity — add here
# once DataForSeoClient grows those paths.
PROVIDER_CAPABILITIES: dict[str, set] = {
    "brightdata": {
        "searchgpt", "perplexity", "gemini", "bing-copilot", "grok",
        "google-ai-mode", "google-ai-overview",
    },
    "dataforseo": {"google-ai-overview", "gemini", "perplexity"},
    "serp": {"searchgpt", "perplexity", "gemini", "google-ai-mode", "google-ai-overview"},
}

# Preference order per LLM. The user's configured provider is always tried
# first (callers pass it as `preferred`); these are the fallbacks, ordered by
# observed reliability/cost for this project.
DEFAULT_CHAINS: dict[str, list] = {
    "searchgpt": ["serp", "brightdata"],
    # BrightData's perplexity dataset went dark on 2026-08-26 (empty
    # hash-keyed records, no answers); DataForSEO ai_optimization is the
    # working source now.
    "perplexity": ["dataforseo", "brightdata"],
    "gemini": ["brightdata", "dataforseo", "serp"],
    "google-ai-overview": ["dataforseo", "brightdata"],
    "google-ai-mode": ["brightdata", "serp"],
    "bing-copilot": ["brightdata"],
    "grok": ["brightdata"],
}

# data_provider label stored on llm_responses rows / audits.
_PROVIDER_LABELS = {
    "brightdata": "BrightData",
    "dataforseo": "OneSearch SERP API",
    "serp": "OneSearch SERP API",
}

# ── Circuit parameters ───────────────────────────────────────────────

TRANSIENT_OPEN_AFTER = 3                  # consecutive failures → open
TRANSIENT_COOLDOWN = timedelta(minutes=10)
BILLING_COOLDOWN = timedelta(minutes=60)  # re-probes hourly until topped up

_BILLING_MARKERS = (
    "insufficient funds", "not enough funds", "money limit", "low balance",
    "balance is too low", "payment required", "suspended", "top up",
    "402", "40201",
)

_state: dict[str, dict] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get(provider: str) -> dict:
    return _state.setdefault(provider, {
        "consecutive": 0,
        "opened_until": None,
        "reason": None,
        "last_error": None,
        "last_failure_at": None,
        "last_ok_at": None,
    })


# ── Credentials / classification ─────────────────────────────────────

def has_credentials(provider: str) -> bool:
    if provider == "dataforseo":
        return bool(settings.dataforseo_login and settings.dataforseo_password)
    if provider == "brightdata":
        return bool(settings.brightdata_api_key)
    if provider == "serp":
        return bool(settings.serp_api_key)
    return False


def classify_error(error: str) -> str:
    """'billing' (account out of funds / suspended) or 'transient'."""
    low = (error or "").lower()
    if any(m in low for m in _BILLING_MARKERS):
        return "billing"
    return "transient"


# ── Outcome recording ────────────────────────────────────────────────

def record_success(provider: str) -> None:
    st = _get(provider)
    if st["reason"]:
        logger.info(f"[provider-health] {provider}: recovered (circuit closed)")
    st["consecutive"] = 0
    st["opened_until"] = None
    st["reason"] = None
    st["last_ok_at"] = _now()


def record_failure(provider: str, error: str = "") -> str:
    """Record a provider-level failure. Returns the classification."""
    kind = classify_error(error)
    st = _get(provider)
    st["consecutive"] += 1
    st["last_error"] = (error or "")[:300]
    st["last_failure_at"] = _now()

    candidate = None
    reason = None
    if kind == "billing":
        candidate = _now() + BILLING_COOLDOWN
        reason = "billing"
    elif st["consecutive"] >= TRANSIENT_OPEN_AFTER:
        candidate = _now() + TRANSIENT_COOLDOWN
        reason = "errors"

    if candidate:
        existing = st.get("opened_until")
        # Never SHORTEN an open circuit. Real case (2026-08-17): the in-client
        # hook classified a 402 as billing (1h window), then the job-level
        # failure "All N prompts failed" — a generic message that classifies
        # as transient — overwrote it down to 10 minutes.
        if existing and existing >= candidate:
            pass
        else:
            st["opened_until"] = candidate
            st["reason"] = reason
            logger.warning(
                f"[provider-health] {provider}: circuit open until "
                f"{candidate.isoformat(timespec='seconds')} "
                f"({reason}; {(error or '')[:120]})"
            )
    return kind


# ── Availability / routing ───────────────────────────────────────────

def is_open(provider: str) -> bool:
    st = _get(provider)
    ou = st.get("opened_until")
    if ou and _now() < ou:
        return True
    if ou:
        # Cooldown passed → half-open: let traffic through, but stay armed so
        # a single failure re-opens immediately.
        st["opened_until"] = None
        st["consecutive"] = max(TRANSIENT_OPEN_AFTER - 1, 0)
        logger.info(f"[provider-health] {provider}: half-open probe allowed")
    return False


def available(provider: str, llm: Optional[str] = None) -> bool:
    if llm is not None and llm not in PROVIDER_CAPABILITIES.get(provider, set()):
        return False
    return has_credentials(provider) and not is_open(provider)


def pick_provider(
    llm: str,
    preferred: Optional[str] = None,
    exclude: Optional[set] = None,
) -> Optional[str]:
    """First capable, credentialed, circuit-closed provider for `llm`.

    Order: `preferred` (the user's configured provider) first, then the
    default chain. Returns None when nothing is available.
    """
    exclude = exclude or set()
    chain: list = []
    if preferred:
        chain.append(preferred)
    for p in DEFAULT_CHAINS.get(llm, []):
        if p not in chain:
            chain.append(p)
    for p in chain:
        if p in exclude:
            continue
        if available(p, llm):
            return p
    return None


def reason(provider: str) -> str:
    """Short human string for why a provider is (un)available."""
    if not has_credentials(provider):
        return "no credentials"
    st = _get(provider)
    if st.get("opened_until") and _now() < st["opened_until"]:
        return f"circuit open: {st.get('reason') or 'errors'}"
    return "ok"


def label(provider: str) -> str:
    return _PROVIDER_LABELS.get(provider, provider)


def snapshot() -> dict:
    """Registry state for the /provider-health endpoint."""
    out = {}
    for p in PROVIDER_CAPABILITIES:
        st = _get(p)
        ou = st.get("opened_until")
        out[p] = {
            "status": "open" if (ou and _now() < ou) else "ok",
            "reason": st.get("reason"),
            "credentials": has_credentials(p),
            "consecutive_failures": st.get("consecutive", 0),
            "opened_until": ou.isoformat() if ou else None,
            "last_error": st.get("last_error"),
            "last_ok_at": st.get("last_ok_at").isoformat() if st.get("last_ok_at") else None,
            "last_failure_at": st.get("last_failure_at").isoformat() if st.get("last_failure_at") else None,
            "capabilities": sorted(PROVIDER_CAPABILITIES.get(p, set())),
        }
    return out
