"""Global domain categorization for GEO analysis.

Tiered, cheap-first:
  Tier 0 — curated static rules (exact hosts, domain labels, suffixes):
           free, instant, resolves the Zipf head of citation volume.
  Tier 2 — gpt-5-nano structured batches of 50 domains for the long tail
           (fractions of a cent per hundred domains).

Tier 1 (Own Brand / Competitor) is project-relative and computed in the UI —
it is NOT a property of the domain itself.

Entry point: `classify_new_domains()` — picks citation domains that have no
row in `domain_categories` yet, classifies, upserts. Called incrementally
from handle_finalize (per audit) and by the one-off backfill script.
"""
import json
import logging
from typing import Optional

from app.services.supabase_db import db
from app.services import openai_client

logger = logging.getLogger(__name__)

CATEGORIES = [
    "Corporate", "News/Media", "Review/Comparison", "Marketplace/Retail",
    "Social Media", "Community/Forum", "Video", "Encyclopedia/Reference",
    "Education", "Government/NGO", "Blogs/Personal", "Other",
]

# ── Tier 0: curated rules ────────────────────────────────────────────

# Full-host / registrable-domain matches (checked after stripping "www.").
EXACT: dict = {
    # Encyclopedia / reference
    "wikipedia.org": "Encyclopedia/Reference", "wiktionary.org": "Encyclopedia/Reference",
    "britannica.com": "Encyclopedia/Reference", "larousse.fr": "Encyclopedia/Reference",
    "wikihow.com": "Encyclopedia/Reference", "wikidata.org": "Encyclopedia/Reference",
    # Video
    "youtube.com": "Video", "youtu.be": "Video", "dailymotion.com": "Video",
    "vimeo.com": "Video", "twitch.tv": "Video",
    # Social
    "facebook.com": "Social Media", "instagram.com": "Social Media",
    "x.com": "Social Media", "twitter.com": "Social Media",
    "linkedin.com": "Social Media", "tiktok.com": "Social Media",
    "pinterest.com": "Social Media", "pinterest.fr": "Social Media",
    "snapchat.com": "Social Media", "threads.net": "Social Media",
    # Community / forum
    "reddit.com": "Community/Forum", "quora.com": "Community/Forum",
    "jeuxvideo.com": "Community/Forum", "commentcamarche.net": "Community/Forum",
    "stackoverflow.com": "Community/Forum", "stackexchange.com": "Community/Forum",
    "discord.com": "Community/Forum",
    # Marketplace / retail
    "ebay.com": "Marketplace/Retail", "ebay.fr": "Marketplace/Retail",
    "aliexpress.com": "Marketplace/Retail", "etsy.com": "Marketplace/Retail",
    "fnac.com": "Marketplace/Retail", "darty.com": "Marketplace/Retail",
    "cdiscount.com": "Marketplace/Retail", "boulanger.com": "Marketplace/Retail",
    "leboncoin.fr": "Marketplace/Retail", "manomano.fr": "Marketplace/Retail",
    "rueducommerce.fr": "Marketplace/Retail", "leroymerlin.fr": "Marketplace/Retail",
    "booking.com": "Marketplace/Retail", "airbnb.com": "Marketplace/Retail",
    "airbnb.fr": "Marketplace/Retail", "rakuten.com": "Marketplace/Retail",
    # Review / comparison
    "trustpilot.com": "Review/Comparison", "avis-verifies.com": "Review/Comparison",
    "g2.com": "Review/Comparison", "capterra.com": "Review/Comparison",
    "capterra.fr": "Review/Comparison", "tripadvisor.com": "Review/Comparison",
    "tripadvisor.fr": "Review/Comparison", "yelp.com": "Review/Comparison",
    "yelp.fr": "Review/Comparison", "quechoisir.org": "Review/Comparison",
    "60millions-mag.com": "Review/Comparison", "lesfurets.com": "Review/Comparison",
    "lelynx.fr": "Review/Comparison", "assurland.com": "Review/Comparison",
    "selectra.info": "Review/Comparison", "lesnumeriques.com": "Review/Comparison",
    "opinion-assurances.fr": "Review/Comparison", "hellosafe.fr": "Review/Comparison",
    "comparateurbanque.com": "Review/Comparison", "moneyvox.fr": "Review/Comparison",
    # News / media (FR-heavy per the client base)
    "lemonde.fr": "News/Media", "lefigaro.fr": "News/Media",
    "liberation.fr": "News/Media", "leparisien.fr": "News/Media",
    "lesechos.fr": "News/Media", "bfmtv.com": "News/Media",
    "tf1info.fr": "News/Media", "francetvinfo.fr": "News/Media",
    "ouest-france.fr": "News/Media", "20minutes.fr": "News/Media",
    "huffingtonpost.fr": "News/Media", "lexpress.fr": "News/Media",
    "lepoint.fr": "News/Media", "nouvelobs.com": "News/Media",
    "capital.fr": "News/Media", "challenges.fr": "News/Media",
    "journaldunet.com": "News/Media", "frandroid.com": "News/Media",
    "numerama.com": "News/Media", "01net.com": "News/Media",
    "clubic.com": "News/Media", "nytimes.com": "News/Media",
    "theguardian.com": "News/Media", "forbes.com": "News/Media",
    "bbc.com": "News/Media", "bbc.co.uk": "News/Media", "cnn.com": "News/Media",
    "reuters.com": "News/Media", "bloomberg.com": "News/Media",
    # Government / NGO
    "service-public.fr": "Government/NGO", "ameli.fr": "Government/NGO",
    "urssaf.fr": "Government/NGO", "europa.eu": "Government/NGO",
    "who.int": "Government/NGO", "legifrance.fr": "Government/NGO",
    # Education
    "openclassrooms.com": "Education", "coursera.org": "Education",
    "udemy.com": "Education",
    # Blogs / personal platforms
    "medium.com": "Blogs/Personal", "substack.com": "Blogs/Personal",
    "canalblog.com": "Blogs/Personal", "over-blog.com": "Blogs/Personal",
    "skyrock.com": "Blogs/Personal",

    # ── Curated from the app's own most-cited domains (top-800 by citation
    # count, 2026-08). Hand-classified so the Zipf head never hits the LLM. ──

    # Banks / insurance / fintech (corporate sites)
    "groupama.fr": "Corporate", "macif.fr": "Corporate", "maif.fr": "Corporate",
    "maaf.fr": "Corporate", "matmut.fr": "Corporate", "allianz.fr": "Corporate",
    "axa.fr": "Corporate", "axa-schengen.com": "Corporate", "mutuaide.fr": "Corporate",
    "gmf.fr": "Corporate", "mma.fr": "Corporate", "aesio.fr": "Corporate",
    "generali.fr": "Corporate", "cnp.fr": "Corporate", "ag2rlamondiale.fr": "Corporate",
    "cardif.fr": "Corporate", "swisslife.fr": "Corporate",
    "harmonie-mutuelle.fr": "Corporate", "direct-assurance.fr": "Corporate",
    "hiscox.fr": "Corporate", "april.fr": "Corporate", "metlife.fr": "Corporate",
    "macsf.fr": "Corporate", "agipi.com": "Corporate", "leocare.eu": "Corporate",
    "luko.eu": "Corporate", "orus.eu": "Corporate",
    "boursobank.com": "Corporate", "boursobank-group.com": "Corporate",
    "labanquepostale.fr": "Corporate", "sg.fr": "Corporate",
    "credit-agricole.fr": "Corporate", "ca-immobilier.fr": "Corporate",
    "creditmutuel.fr": "Corporate", "cic.fr": "Corporate",
    "caisse-epargne.fr": "Corporate", "banquepopulaire.fr": "Corporate",
    "bnpparibas.fr": "Corporate", "cofidis.fr": "Corporate",
    "floabank.fr": "Corporate", "sofinco.fr": "Corporate", "wise.com": "Corporate",
    "nalo.fr": "Corporate", "ramify.fr": "Corporate", "linxea.com": "Corporate",
    "corum.fr": "Corporate", "goodvest.fr": "Corporate", "finary.com": "Corporate",
    "monpetitplacement.fr": "Corporate", "indy.fr": "Corporate",
    "prosper-conseil.fr": "Corporate", "solutis.fr": "Corporate",
    "pretto.fr": "Corporate", "cafpi.fr": "Corporate", "mes-allocs.fr": "Corporate",
    "tataaig.com": "Corporate", "icicilombard.com": "Corporate",
    "reliancegeneral.co.in": "Corporate", "acko.com": "Corporate",
    "fabfrenchinsurance.com": "Corporate", "ornikar.com": "Corporate",
    "randstad.fr": "Corporate", "legalstart.fr": "Corporate",
    "legalplace.fr": "Corporate",
    # Real-estate developers & services (corporate)
    "cogedim.com": "Corporate", "vinci-immobilier.com": "Corporate",
    "bouygues-immobilier.com": "Corporate", "nexity.fr": "Corporate",
    "icade-immobilier.com": "Corporate", "kaufmanbroad.fr": "Corporate",
    "emerige.com": "Corporate", "pichet.fr": "Corporate", "lamotte.fr": "Corporate",
    "marignan-immobilier.com": "Corporate", "medicis-patrimoine.com": "Corporate",
    "capifrance.fr": "Corporate", "valority.com": "Corporate",
    "vianova-groupe.fr": "Corporate", "investissement-locatif.com": "Corporate",
    # Brands & other corporate sites
    "nike.com": "Corporate", "balenciaga.com": "Corporate",
    "maisonkitsune.com": "Corporate", "lillet.com": "Corporate",
    "lechocolat-alainducasse.com": "Corporate", "vorwerk.com": "Corporate",
    "ikea.com": "Corporate", "cotesushi.com": "Corporate",
    "midas.fr": "Corporate", "midas.be": "Corporate", "norauto.es": "Corporate",
    "eurostar.com": "Corporate", "sncf-connect.com": "Corporate",
    "nausicaa.fr": "Corporate", "totalenergies.fr": "Corporate",
    "enedis.fr": "Corporate", "sysco.fr": "Corporate",
    "cuisine-plus.fr": "Corporate", "cuisinesdovy.be": "Corporate",
    "mobalpa.fr": "Corporate", "eggo.be": "Corporate",
    "macuisineequipee.be": "Corporate", "vandenborrekitchen.be": "Corporate",
    "ma.cuisinella": "Corporate", "home-design.schmidt": "Corporate",
    "google.com": "Corporate", "apple.com": "Corporate",
    # Marketplaces / listings / retail
    "seloger.com": "Marketplace/Retail", "selogerneuf.com": "Marketplace/Retail",
    "logic-immo.com": "Marketplace/Retail", "explorimmoneuf.com": "Marketplace/Retail",
    "immoneuf.com": "Marketplace/Retail",
    "trouver-un-logement-neuf.com": "Marketplace/Retail",
    "plan-immobilier.fr": "Marketplace/Retail", "logisneuf.com": "Marketplace/Retail",
    "bienici.com": "Marketplace/Retail", "pap.fr": "Marketplace/Retail",
    "ouestfrance-immo.com": "Marketplace/Retail", "coteneuf.com": "Marketplace/Retail",
    "vivredansleneuf.fr": "Marketplace/Retail", "travaux.com": "Marketplace/Retail",
    "houzz.fr": "Marketplace/Retail", "indeed.com": "Marketplace/Retail",
    "hellowork.com": "Marketplace/Retail", "cadremploi.fr": "Marketplace/Retail",
    "maformation.fr": "Marketplace/Retail", "decathlon.fr": "Marketplace/Retail",
    "alltricks.fr": "Marketplace/Retail", "i-run.fr": "Marketplace/Retail",
    "top4running.fr": "Marketplace/Retail", "top4running.com": "Marketplace/Retail",
    "tonton-outdoor.com": "Marketplace/Retail", "runningxpert.com": "Marketplace/Retail",
    "castlebergoutdoors.co.uk": "Marketplace/Retail", "chullanka.com": "Marketplace/Retail",
    "mytheresa.com": "Marketplace/Retail", "farfetch.com": "Marketplace/Retail",
    "nordstrom.com": "Marketplace/Retail", "bloomingdales.com": "Marketplace/Retail",
    "harrods.com": "Marketplace/Retail", "poizon.com": "Marketplace/Retail",
    "autodoc.es": "Marketplace/Retail", "oscaro.es": "Marketplace/Retail",
    "carter-cash.es": "Marketplace/Retail", "castorama.fr": "Marketplace/Retail",
    "thetrainline.com": "Marketplace/Retail", "raileurope.com": "Marketplace/Retail",
    "omio.com": "Marketplace/Retail", "alibaba.com": "Marketplace/Retail",
    "play.google.com": "Marketplace/Retail", "apps.apple.com": "Marketplace/Retail",
    "toute-la-franchise.com": "Marketplace/Retail",
    "observatoiredelafranchise.fr": "Marketplace/Retail",
    # Comparison / review / rankings
    "meilleurtaux.com": "Review/Comparison", "comparabanques.fr": "Review/Comparison",
    "lecomparateurassurance.com": "Review/Comparison",
    "reassurez-moi.fr": "Review/Comparison", "jechange.fr": "Review/Comparison",
    "hyperassur.com": "Review/Comparison", "bonne-assurance.com": "Review/Comparison",
    "goodassur.com": "Review/Comparison", "magnolia.fr": "Review/Comparison",
    "empruntis.com": "Review/Comparison", "panorabanques.com": "Review/Comparison",
    "detective-banque.fr": "Review/Comparison", "cleerly.fr": "Review/Comparison",
    "finance-heros.fr": "Review/Comparison",
    "avenuedesinvestisseurs.fr": "Review/Comparison",
    "index-assurance.fr": "Review/Comparison", "wesur.fr": "Review/Comparison",
    "insurte.com": "Review/Comparison", "assuranceslabs.com": "Review/Comparison",
    "coover.fr": "Review/Comparison", "squaremouth.com": "Review/Comparison",
    "americanvisitorinsurance.com": "Review/Comparison",
    "nerdwallet.com": "Review/Comparison",
    "fournisseurs-electricite.com": "Review/Comparison",
    "monpetitforfait.com": "Review/Comparison", "ariase.com": "Review/Comparison",
    "theworlds50best.com": "Review/Comparison", "rome2rio.com": "Review/Comparison",
    "runnea.fr": "Review/Comparison", "runrepeat.com": "Review/Comparison",
    "lecomparatifdutrail.fr": "Review/Comparison",
    "chaussure-trail.com": "Review/Comparison", "lavoixdutest.fr": "Review/Comparison",
    "green-opinion.com": "Review/Comparison", "immodvisor.com": "Review/Comparison",
    "trustup.be": "Review/Comparison", "diplomeo.com": "Review/Comparison",
    "petitfute.com": "Review/Comparison", "hot-dinners.com": "Review/Comparison",
    "tripadvisor.co.uk": "Review/Comparison",
    # News / media / magazines
    "lequipe.fr": "News/Media", "boursorama.com": "News/Media",
    "letudiant.fr": "News/Media", "elle.com": "News/Media",
    "vogue.com": "News/Media", "whowhatwear.com": "News/Media",
    "harpersbazaar.com": "News/Media", "gq.com": "News/Media",
    "marieclaire.fr": "News/Media", "marieclaire.com": "News/Media",
    "cntraveler.com": "News/Media", "timeout.com": "News/Media",
    "sortiraparis.com": "News/Media", "bostonmagazine.com": "News/Media",
    "independent.co.uk": "News/Media", "tomsguide.com": "News/Media",
    "healthline.com": "News/Media", "santemagazine.fr": "News/Media",
    "doctissimo.fr": "News/Media", "programme-tv.net": "News/Media",
    "connexionfrance.com": "News/Media", "editorialist.com": "News/Media",
    "marmiton.org": "News/Media", "runnersworld.com": "News/Media",
    "runnersworld.fr": "News/Media", "outside.fr": "News/Media",
    "widermag.com": "News/Media", "runmag.fr": "News/Media",
    "journaldutrail.com": "News/Media", "u-trail.com": "News/Media",
    "ski-nordique.net": "News/Media", "tennisactu.net": "News/Media",
    "basketeurope.com": "News/Media", "bebasket.fr": "News/Media",
    "goal.com": "News/Media", "sportbuzzbusiness.fr": "News/Media",
    "lexpress-franchise.com": "News/Media",
    # Blogs / personal
    "seat61.com": "Blogs/Personal", "blog.naver.com": "Blogs/Personal",
    "trail-addict.fr": "Blogs/Personal", "pacing-trail.fr": "Blogs/Personal",
    "conseilsrunning.fr": "Blogs/Personal", "athleexplique.fr": "Blogs/Personal",
    "deepertrails.com": "Blogs/Personal", "traverse-blog.com": "Blogs/Personal",
    "imboredletseat.com": "Blogs/Personal",
    # Government / public bodies / associations
    "anil.org": "Government/NGO", "francetravail.fr": "Government/NGO",
    "senat.fr": "Government/NGO", "assemblee-nationale.fr": "Government/NGO",
    "vie-publique.fr": "Government/NGO", "insee.fr": "Government/NGO",
    "notaires.fr": "Government/NGO", "caf.fr": "Government/NGO",
    "actionlogement.fr": "Government/NGO", "banque-france.fr": "Government/NGO",
    "amf-france.org": "Government/NGO", "santepubliquefrance.fr": "Government/NGO",
    "justice.fr": "Government/NGO", "paris.fr": "Government/NGO",
    "canada.ca": "Government/NGO", "inc-conso.fr": "Government/NGO",
    "bpifrance-creation.fr": "Government/NGO", "bpifrance.fr": "Government/NGO",
    "franceassureurs.fr": "Government/NGO", "qualitel.org": "Government/NGO",
    "sengager.fr": "Government/NGO", "onisep.fr": "Government/NGO",
    "cidj.com": "Government/NGO", "apec.fr": "Government/NGO",
    "allianceflaxlinenhemp.eu": "Government/NGO", "fflose.com": "Government/NGO",
    # Education
    "studi.com": "Education", "afpa.fr": "Education",
    "lafinancepourtous.com": "Education", "lesclesdelabanque.com": "Education",
    # Reference
    "vidal.fr": "Encyclopedia/Reference",
    # Video platforms
    "dazn.com": "Video",
    # Second sweep of the uncovered remainder
    "self.com": "News/Media", "autoplus.fr": "News/Media",
    "parents.fr": "News/Media",
    "net-a-porter.com": "Marketplace/Retail", "hardloop.fr": "Marketplace/Retail",
    "worldnomads.com": "Corporate", "yellowkorner.com": "Corporate",
    "socooc.com": "Corporate", "bymycar.fr": "Corporate",
    "policybazaar.com": "Review/Comparison", "mutuelle.fr": "Review/Comparison",
    "ville-boulogne-sur-mer.fr": "Government/NGO",
    # Not meaningful as sources
    "vertexaisearch.cloud.google.com": "Other", "pagesjaunes.fr": "Other",
}

# Single-label matches: any dot-separated label of the host equals the key.
# Robust to subdomains (fr.wikipedia.org, m.youtube.com, forum.brand.com).
LABEL_RULES: dict = {
    "wikipedia": "Encyclopedia/Reference",
    "wiktionary": "Encyclopedia/Reference",
    "youtube": "Video",
    "dailymotion": "Video",
    "vimeo": "Video",
    "reddit": "Community/Forum",
    "quora": "Community/Forum",
    "forum": "Community/Forum",
    "forums": "Community/Forum",
    "amazon": "Marketplace/Retail",
    "facebook": "Social Media",
    "instagram": "Social Media",
    "linkedin": "Social Media",
    "tiktok": "Social Media",
    "twitter": "Social Media",
    "blogspot": "Blogs/Personal",
    "wordpress": "Blogs/Personal",
    "tumblr": "Blogs/Personal",
    "tripadvisor": "Review/Comparison",
    "trustpilot": "Review/Comparison",
    "leroymerlin": "Marketplace/Retail",
    "indeed": "Marketplace/Retail",
    "decathlon": "Marketplace/Retail",
    "ixina": "Corporate",
    "cuisinella": "Corporate",
    "sysco": "Corporate",
    "vogue": "News/Media",
    "whowhatwear": "News/Media",
    "glassdoor": "Review/Comparison",
}

SUFFIX_RULES: list = [
    (".gouv.fr", "Government/NGO"),
    (".gov", "Government/NGO"),
    (".gc.ca", "Government/NGO"),
    (".edu", "Education"),
    (".ac.uk", "Education"),
    (".univ-paris.fr", "Education"),
]


def _norm(domain: str) -> str:
    d = (domain or "").strip().lower()
    # Extraction sometimes stores full URLs or hosts with paths as "domain".
    if "://" in d:
        d = d.split("://", 1)[1]
    d = d.split("/", 1)[0].split("?", 1)[0].split(":", 1)[0]
    if d.startswith("www."):
        d = d[4:]
    return d.rstrip(".")


def classify_by_rules(domain: str) -> Optional[str]:
    d = _norm(domain)
    if not d:
        return None
    if d in EXACT:
        return EXACT[d]
    labels = d.split(".")
    # Registrable-domain exact match for subdomained hosts (a.b.example.com).
    for i in range(len(labels) - 1):
        if ".".join(labels[i:]) in EXACT:
            return EXACT[".".join(labels[i:])]
    for lbl in labels:
        if lbl in LABEL_RULES:
            return LABEL_RULES[lbl]
    for suffix, cat in SUFFIX_RULES:
        if d.endswith(suffix):
            return cat
    # French university pattern (univ-*.fr)
    if any(lbl.startswith("univ-") for lbl in labels):
        return "Education"
    return None


# ── Tier 2: gpt-5-nano batch classification ──────────────────────────

DOMAIN_CATEGORY_SCHEMA = {
    "name": "domain_categories",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "domains": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "domain": {"type": "string"},
                        "category": {"type": "string", "enum": CATEGORIES},
                    },
                    "required": ["domain", "category"],
                },
            },
        },
        "required": ["domains"],
    },
}

_CATEGORY_GUIDE = (
    "- Corporate: official company/brand/product websites\n"
    "- News/Media: established publications, online magazines, tech press\n"
    "- Review/Comparison: review platforms, comparison/aggregator sites, "
    "consumer testing (Trustpilot-like, comparateurs, 'best X' affiliate sites)\n"
    "- Marketplace/Retail: e-commerce marketplaces and retailers\n"
    "- Social Media: social network platforms\n"
    "- Community/Forum: user-driven discussion platforms\n"
    "- Video: video hosting platforms\n"
    "- Encyclopedia/Reference: encyclopedias, dictionaries, reference data\n"
    "- Education: universities, schools, e-learning platforms\n"
    "- Government/NGO: public sector, intergovernmental, nonprofits\n"
    "- Blogs/Personal: independent blogs, personal sites, niche creators\n"
    "- Other: anything that fits none of the above"
)


async def _classify_batch_llm(domains: list) -> dict:
    """Classify a batch of domains in one gpt-5-nano structured call.

    Raises on empty/unparseable responses so the caller counts the batch as
    failed instead of persisting fallback junk. gpt-5-nano is a reasoning
    model: the completion budget must also cover hidden reasoning tokens
    (4096 died with finish_reason=length, all 4096 spent on reasoning),
    hence 16384 like the sentiment calls.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You classify website domains into categories for marketing "
                "analysis. Categories:\n" + _CATEGORY_GUIDE +
                "\nReturn one entry per input domain, category from the list. "
                "If genuinely unsure, use 'Other'."
            ),
        },
        {
            "role": "user",
            "content": "Classify these domains:\n" + json.dumps(domains, ensure_ascii=False),
        },
    ]
    raw = await openai_client._call_openai(
        messages,
        max_tokens=16384,
        response_format={"type": "json_schema", "json_schema": DOMAIN_CATEGORY_SCHEMA},
        _operation="domain_categorize",
        model=openai_client.MODEL_COMPETITORS,
    )
    if not raw:
        raise RuntimeError("empty model response")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"unparseable model response: {e}")
    out: dict = {}
    for entry in parsed.get("domains", []):
        d = _norm(entry.get("domain") or "")
        cat = entry.get("category")
        if d and cat in CATEGORIES:
            out[d] = cat
    if not out:
        raise RuntimeError("no valid domain entries in model response")
    return out


async def classify_new_domains(limit: int = 300, audit_id: Optional[str] = None) -> dict:
    """Classify citation domains that have no domain_categories row yet.

    Rules first (free), then nano batches of 50 for the remainder. Returns
    {"rules": n, "llm": n, "failed": n}. Safe to call repeatedly — only
    unclassified domains are picked up.
    """
    domains = await db.get_unclassified_citation_domains(limit=limit, audit_id=audit_id)
    if not domains:
        return {"rules": 0, "llm": 0, "failed": 0}

    # Upsert under the ORIGINAL domain string (the citations join key) so
    # every fetched domain converges to a row; normalize only for matching.
    rule_rows: list = []
    rest: list = []  # (original, normalized) pairs
    for d in domains:
        nd = _norm(d)
        if not nd:
            continue
        cat = classify_by_rules(nd)
        if cat:
            rule_rows.append({"domain": d, "category": cat, "source": "rule", "confidence": 1.0})
        else:
            rest.append((d, nd))
    if rule_rows:
        await db.upsert_domain_categories(rule_rows)

    llm_count = 0
    failed = 0
    # Small batches keep nano's reasoning short; 50 at once made it think
    # itself past the token budget.
    BATCH = 20
    for i in range(0, len(rest), BATCH):
        chunk = rest[i:i + BATCH]
        norms = sorted({nd for _, nd in chunk})
        try:
            mapping = await _classify_batch_llm(norms)
        except Exception as e:
            logger.warning(f"[domain-classifier] LLM batch failed ({len(chunk)} domains): {e}")
            failed += len(chunk)
            continue
        rows = [
            {"domain": orig, "category": mapping.get(nd, "Other"), "source": "llm",
             "confidence": 0.8 if nd in mapping else 0.3}
            for orig, nd in chunk
        ]
        await db.upsert_domain_categories(rows)
        llm_count += len(rows)

    logger.info(
        f"[domain-classifier] classified {len(rule_rows)} by rules, "
        f"{llm_count} by LLM, {failed} failed"
        + (f" (audit {audit_id})" if audit_id else "")
    )
    return {"rules": len(rule_rows), "llm": llm_count, "failed": failed}
