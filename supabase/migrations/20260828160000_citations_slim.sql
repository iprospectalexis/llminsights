-- Slim server-side projection of llm_responses.citations for the
-- project dashboards.
--
-- The raw `citations` jsonb (BrightData ChatGPT variant) carries full
-- source entries — titles, descriptions, favicon URLs, per-entry
-- metadata — and is 65% of the dashboard's llm_responses payload
-- (39.4 MB raw on the heaviest 90-day window). The frontend only ever
-- reads `url`, `cited`, and `title`/`description` (the latter solely as
-- a citation_text fallback when the entry is missing from the
-- citations table).
--
-- PostgREST computed column: first argument is the table row type, so
-- the frontend selects it as `citations:citations_slim` and every
-- consumer keeps seeing a `citations` field with identical semantics:
--   - NULL stays NULL            (web-search-disabled detection)
--   - arrays stay arrays          (even when empty)
--   - non-array oddities pass through verbatim
--   - entry.cited: true/false kept, explicit null/absent -> absent
--     (client reads undefined -> same falsy handling as before)
--   - entry.title truncated to 120 chars; description kept only when
--     there is no title, truncated to 160 (citation_text fallback).
CREATE OR REPLACE FUNCTION public.citations_slim(r public.llm_responses)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN r.citations IS NULL THEN NULL
    WHEN jsonb_typeof(r.citations) != 'array' THEN r.citations
    ELSE (
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'url', e->>'url',
               'cited', e->'cited',
               'title', left(coalesce(nullif(e->>'title',''), nullif(e->>'name','')), 120),
               'description', CASE
                 WHEN coalesce(nullif(e->>'title',''), nullif(e->>'name','')) IS NULL
                 THEN left(e->>'description', 160)
               END
             ))), '[]'::jsonb)
      FROM jsonb_array_elements(r.citations) e
    )
  END
$$;

COMMENT ON FUNCTION public.citations_slim(public.llm_responses) IS
  'PostgREST computed column: url/cited/title-only view of llm_responses.citations for dashboard payload reduction';

GRANT EXECUTE ON FUNCTION public.citations_slim(public.llm_responses) TO authenticated, anon, service_role;
