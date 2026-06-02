"""
Per-LLM prompt augmentation for outgoing provider requests.

Some providers behave more reliably when we tag the prompt with a hint.
SearchGPT/ChatGPT in particular often skips its web-search tool unless
the prompt explicitly asks for it — so when `force_web_search=True` we
append a literal suffix that nudges the model to call the tool.

The DB-stored prompt (`prompts.prompt_text`) and anything the UI reads
must stay UNCHANGED — the suffix is a transport-layer detail. The
inverse helper `strip_known_provider_suffixes` is called inside the
polling matcher so OneSearch results (which echo the augmented text
back) still line up against the original DB prompt.

If we ever add more per-LLM hints (Bing-specific, Gemini-specific, …),
plug them into both helpers below and the rest of the pipeline keeps
working.
"""

# Single source of truth. Don't change the spacing — the leading space
# ensures the suffix is cleanly separated from the user's prompt
# whether or not the prompt itself ends in whitespace.
FORCE_WEB_SEARCH_SUFFIX = " (use web search to answer)"


def augmented_prompt(llm: str, prompt_text: str, force_web_search: bool) -> str:
    """Return the prompt actually sent to the provider for a given LLM.

    For SearchGPT with force_web_search=True we append the suffix that
    pushes ChatGPT to call its web tool. For every other case we return
    the prompt unchanged — so this helper is safe to call unconditionally
    from the job-submission path.
    """
    if llm == "searchgpt" and force_web_search:
        return f"{prompt_text}{FORCE_WEB_SEARCH_SUFFIX}"
    return prompt_text


def strip_known_provider_suffixes(text: str) -> str:
    """Inverse of augmented_prompt — peel off any suffix we may have
    appended on send.

    Called from the prompt-matcher in audit_pipeline._normalize_prompt
    so the DB-original side and the provider-echo side collapse to the
    same key. If we don't recognise the suffix the function returns the
    text unchanged, which means matching for plain (unaugmented) prompts
    keeps working too.
    """
    if not text:
        return text
    return text.removesuffix(FORCE_WEB_SEARCH_SUFFIX)
