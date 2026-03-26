"""
Converter for transforming JSON from ChatGPT export format to target format.
"""

import json
import re
import logging
from datetime import datetime
from urllib.parse import urlparse, quote
from typing import Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_domain(url: str) -> str:
    """Extracts domain from URL."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        parts = domain.split('.')
        if len(parts) >= 2:
            return parts[0] if parts[0] not in ['co', 'com', 'org', 'net'] else domain
        return domain
    except:
        return url


def extract_search_queries(raw_response: list) -> list:
    """
    Extracts search queries from raw_response.
    Looks for metadata.search_model_queries.queries in streaming events.
    Returns list of query strings.
    """
    queries = []

    for line in raw_response:
        if not isinstance(line, str):
            continue

        if line.startswith('data: '):
            json_str = line[6:].strip()
            if not json_str:
                continue

            try:
                data = json.loads(json_str)
            except json.JSONDecodeError:
                continue

            if not isinstance(data, dict):
                continue

            # Look for metadata in various structures
            metadata = None

            # Format 1: {"v": {"message": {"metadata": {...}}}}
            if isinstance(data.get('v'), dict):
                msg = data['v'].get('message', {})
                if isinstance(msg, dict):
                    metadata = msg.get('metadata', {})

            # Format 2: Direct metadata in data
            if metadata is None and 'metadata' in data:
                metadata = data.get('metadata', {})

            if metadata and isinstance(metadata, dict):
                search_model_queries = metadata.get('search_model_queries', {})
                if isinstance(search_model_queries, dict):
                    found_queries = search_model_queries.get('queries', [])
                    if isinstance(found_queries, list) and found_queries:
                        # Return the first set of queries found
                        return found_queries

    return queries


def extract_all_sources(raw_response: list) -> list:
    """
    Extracts all_sources from raw_response (streaming events).
    Returns list of sources with fields:
    domain, url, type, title, snippet, ref_id, ref_type, pub_date, attribution
    """
    all_sources = []
    seen_urls = set()

    for line in raw_response:
        if not isinstance(line, str):
            continue

        if line.startswith('data: '):
            json_str = line[6:].strip()
            if not json_str:
                continue

            try:
                data = json.loads(json_str)
            except json.JSONDecodeError:
                continue

            if not isinstance(data, dict):
                continue

            search_groups = []

            # Format 1: {"v": [{"type": "search_result_group", ...}]}
            if isinstance(data.get('v'), list):
                for item in data['v']:
                    if isinstance(item, dict) and item.get('type') == 'search_result_group':
                        search_groups.append(item)

            # Format 2: inside message/metadata/search_result_groups
            if isinstance(data.get('v'), dict):
                msg = data['v'].get('message', {})
                metadata = msg.get('metadata', {})
                groups = metadata.get('search_result_groups', [])
                if isinstance(groups, list):
                    search_groups.extend(groups)

            for group in search_groups:
                domain = group.get('domain', '')
                entries = group.get('entries', [])

                for entry in entries:
                    if not isinstance(entry, dict):
                        continue

                    url = entry.get('url', '')

                    if url in seen_urls:
                        continue
                    seen_urls.add(url)

                    ref_id_data = entry.get('ref_id', {})
                    if isinstance(ref_id_data, dict):
                        ref_id = ref_id_data.get('ref_index')
                        ref_type = ref_id_data.get('ref_type', 'search')
                    else:
                        ref_id = None
                        ref_type = 'search'

                    source = {
                        'domain': domain or entry.get('attribution', ''),
                        'url': url,
                        'type': entry.get('type', 'search_result'),
                        'title': entry.get('title', ''),
                        'snippet': entry.get('snippet', ''),
                        'ref_id': ref_id,
                        'ref_type': ref_type,
                        'pub_date': entry.get('pub_date'),
                        'attribution': entry.get('attribution', '')
                    }
                    all_sources.append(source)

    all_sources.sort(key=lambda x: (x['ref_id'] is None, x['ref_id'] or 0))
    return all_sources


def markdown_to_plain_text(markdown_text: str) -> str:
    """Converts markdown to plain text."""
    text = markdown_text

    # Remove markdown headers
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)

    # Remove bold
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'__(.+?)__', r'\1', text)

    # Remove italic
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'_(.+?)_', r'\1', text)

    # Convert links [text](url) -> text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)

    # Remove reference links [1]: url
    text = re.sub(r'^\[\d+\]:\s+.+', '', text, flags=re.MULTILINE)

    # Remove horizontal lines
    text = re.sub(r'^---+', '', text, flags=re.MULTILINE)

    # Remove extra empty lines
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def extract_citations_from_links(links: list) -> tuple[list, list]:
    """
    Extracts citations and links_attached from links list.
    Returns (citations, links_attached)
    """
    citations = []
    links_attached = []

    for i, link in enumerate(links, 1):
        url = link.get('url', '')
        title = link.get('title', '')
        text = link.get('text', '')
        description = link.get('description')
        section = link.get('section', '')

        domain = extract_domain(url)

        is_cited = section == 'citations'

        citation = {
            'url': url,
            'icon': None,
            'cited': is_cited,
            'title': title,
            'domain': domain,
            'description': description if not is_cited else None
        }
        citations.append(citation)

        if is_cited:
            link_attached = {
                'url': url,
                'text': text or domain,
                'position': i
            }
            links_attached.append(link_attached)

    return citations, links_attached


def convert_record(prompt: str, response_data: dict, timestamp: str = None, country: str = "") -> dict:
    """
    Converts one record from source format to target format.
    """
    if timestamp is None:
        timestamp = datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'

    markdown_text = response_data.get('markdown_text', '')
    llm_model = response_data.get('llm_model', 'gpt-5')
    source_citations = response_data.get('citations', [])
    raw_response = response_data.get('raw_response', [])
    all_sources = extract_all_sources(raw_response)
    search_queries = extract_search_queries(raw_response)

    citations, links_attached = extract_citations_from_links(source_citations)
    answer_text = markdown_to_plain_text(markdown_text)

    encoded_prompt = quote(prompt)
    url = f"https://chatgpt.com/?model=gpt-4&q={encoded_prompt}"

    record_country = country or 'FR'

    result = {
        'map': None,
        'url': url,
        'index': None,
        'input': {
            'url': 'https://chatgpt.com/',
            'prompt': prompt,
            'country': record_country,
            'web_search': True,
            'additional_prompt': ''
        },
        'model': llm_model,
        'is_map': False,
        'prompt': prompt,
        'country': record_country,
        'shopping': [],
        'shopping_visible': False,
        'citations': citations,
        'timestamp': timestamp,
        'references': [],
        'answer_text': answer_text,
        'links_attached': links_attached,
        'answer_section_html': '',
        'answer_text_markdown': markdown_text,
        'web_search_triggered': len(source_citations) > 0 or len(search_queries) > 0,
        'web_search_query': search_queries if search_queries else (prompt if len(source_citations) > 0 else None),
        'search_sources': [],
        'recommendations': [],
        'additional_prompt': '',
        'additional_answer_text': None,
        'all_sources': all_sources
    }

    return result


def extract_all_sources_from_bd_events(events: list) -> list:
    """
    Extracts all_sources from BrightData response_raw events.
    BrightData events are JSON objects (not SSE "data: " lines).
    Looks for search_result_groups in message metadata.
    """
    all_sources = []
    seen_urls = set()

    for evt in events:
        if not isinstance(evt, dict):
            continue

        search_groups = []

        # Check in message metadata
        v = evt.get('v')
        if isinstance(v, dict):
            msg = v.get('message', {})
            if isinstance(msg, dict):
                metadata = msg.get('metadata', {})
                if isinstance(metadata, dict):
                    groups = metadata.get('search_result_groups', [])
                    if isinstance(groups, list):
                        search_groups.extend(groups)

        # Check in patch operations (events with o=patch)
        if isinstance(v, list):
            for sub in v:
                if isinstance(sub, dict):
                    p = sub.get('p', '')
                    if 'search_result_groups' in p:
                        sv = sub.get('v')
                        if isinstance(sv, list):
                            for item in sv:
                                if isinstance(item, dict) and item.get('type') == 'search_result_group':
                                    search_groups.append(item)

        for group in search_groups:
            if not isinstance(group, dict):
                continue
            domain = group.get('domain', '')
            entries = group.get('entries', [])

            for entry in entries:
                if not isinstance(entry, dict):
                    continue

                url = entry.get('url', '')
                if url in seen_urls:
                    continue
                seen_urls.add(url)

                ref_id_data = entry.get('ref_id', {})
                if isinstance(ref_id_data, dict):
                    ref_id = ref_id_data.get('ref_index')
                    ref_type = ref_id_data.get('ref_type', 'search')
                else:
                    ref_id = None
                    ref_type = 'search'

                source = {
                    'domain': domain or entry.get('attribution', ''),
                    'url': url,
                    'type': entry.get('type', 'search_result'),
                    'title': entry.get('title', ''),
                    'snippet': entry.get('snippet', ''),
                    'ref_id': ref_id,
                    'ref_type': ref_type,
                    'pub_date': entry.get('pub_date'),
                    'attribution': entry.get('attribution', '')
                }
                all_sources.append(source)

    all_sources.sort(key=lambda x: (x['ref_id'] is None, x['ref_id'] or 0))
    return all_sources


def extract_search_queries_from_bd_events(events: list) -> list:
    """
    Extracts search queries from BrightData response_raw events.
    Looks for search_model_queries in message metadata.
    """
    for evt in events:
        if not isinstance(evt, dict):
            continue

        v = evt.get('v')
        if isinstance(v, dict):
            msg = v.get('message', {})
            if isinstance(msg, dict):
                metadata = msg.get('metadata', {})
                if isinstance(metadata, dict):
                    smq = metadata.get('search_model_queries', {})
                    if isinstance(smq, dict):
                        queries = smq.get('queries', [])
                        if isinstance(queries, list) and queries:
                            return queries

    return []


def convert_brightdata_record(item: dict, country: str = "") -> dict:
    """
    Converts a single BrightData record to the same format as SERP converted records.
    """
    # Parse response_raw to extract all_sources and search queries
    raw_events = []
    response_raw = item.get('response_raw')
    if response_raw:
        try:
            raw_events = json.loads(response_raw) if isinstance(response_raw, str) else response_raw
        except (json.JSONDecodeError, TypeError):
            pass

    all_sources = extract_all_sources_from_bd_events(raw_events)

    # Use existing web_search_query or extract from response_raw
    web_search_query = item.get('web_search_query')
    if not web_search_query:
        extracted = extract_search_queries_from_bd_events(raw_events)
        web_search_query = extracted if extracted else None

    # Fix country: prefer explicit param, then item value, then fallback
    record_country = country or item.get('country') or ''

    # Fix input
    input_data = item.get('input', {})
    if isinstance(input_data, dict):
        input_data = {
            'url': input_data.get('url', 'https://chatgpt.com/'),
            'prompt': input_data.get('prompt', item.get('prompt', '')),
            'country': record_country or input_data.get('country', ''),
            'web_search': item.get('web_search_triggered', True),
            'additional_prompt': input_data.get('additional_prompt', ''),
        }

    return {
        'map': item.get('map'),
        'url': item.get('url', ''),
        'index': item.get('index'),
        'input': input_data,
        'model': item.get('model', ''),
        'is_map': item.get('is_map', False),
        'prompt': item.get('prompt', ''),
        'country': record_country,
        'shopping': item.get('shopping', []),
        'shopping_visible': item.get('shopping_visible', False),
        'citations': item.get('citations') or [],
        'timestamp': item.get('timestamp', ''),
        'references': item.get('references', []),
        'answer_text': item.get('answer_text', ''),
        'links_attached': item.get('links_attached') or [],
        'answer_section_html': item.get('answer_section_html', ''),
        'answer_text_markdown': item.get('answer_text_markdown', ''),
        'web_search_triggered': item.get('web_search_triggered', False),
        'web_search_query': web_search_query,
        'search_sources': item.get('search_sources', []),
        'recommendations': item.get('recommendations', []),
        'additional_prompt': item.get('additional_prompt', ''),
        'additional_answer_text': item.get('additional_answer_text'),
        'all_sources': all_sources,
    }


def extract_aio_citations_from_page_html(page_html: str) -> list:
    """
    Extract citations from Google AI Overview page_html.
    Parses AIO source card anchors for title (aria-label) and url (href).
    Tries known class patterns; skips Google-internal URLs and duplicate overlay links.
    Returns deduplicated list of {domain, url, title} dicts.
    """
    citations = []
    seen_urls = set()

    # KEVENd = AI Overview source card links (BrightData snapshots)
    # NDNGvf = alternate class seen in some Google renders
    patterns = [
        r'<a\s[^>]*class="KEVENd"[^>]*>',
        r'<a\s[^>]*class="NDNGvf"[^>]*>',
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, page_html):
            tag = match.group(0)

            href_match = re.search(r'\bhref="([^"]*)"', tag)
            if not href_match:
                continue
            url = href_match.group(1).replace("&amp;", "&")

            # Skip Google-internal and relative URLs
            if not url.startswith("http") or "google.com" in url:
                continue

            # Deduplicate on base URL (strip #:~:text= highlight fragments)
            base_url = re.sub(r"#:~:text=.*$", "", url)
            if base_url in seen_urls:
                continue
            seen_urls.add(base_url)

            label_match = re.search(r'aria-label="([^"]*)"', tag)
            title = label_match.group(1) if label_match else ""
            # HTML entity decode
            title = (title.replace("&amp;", "&").replace("&#x201C;", "\u201c")
                     .replace("&#x201D;", "\u201d").replace("&#39;", "'")
                     .replace("&apos;", "'").replace("&quot;", '"'))
            title = re.sub(r"\.\s*Opens in new tab\.$", "", title).strip()

            citations.append({
                "domain": extract_domain(base_url),
                "url": base_url,
                "title": title,
            })

    return citations


def _decode_html_entities(text: str) -> str:
    """Decode common HTML entities in attribute values."""
    return (text.replace("&amp;", "&").replace("&#x201C;", "\u201c")
                .replace("&#x201D;", "\u201d").replace("&#39;", "'")
                .replace("&apos;", "'").replace("&quot;", '"'))


def extract_aio_ndngvf_citations(page_html: str) -> list:
    """
    Extract citations using XPath rule: //li[@class="CyMdWb"]//a[@class="NDNGvf"]
    These are the compact AI Overview citation entries.
    Returns list of {url, icon, cited, title, domain, description} dicts.
    """
    results = []
    seen_urls = set()

    for li_match in re.finditer(r'<li\s[^>]*class="CyMdWb"[^>]*>', page_html):
        li_start = li_match.start()
        li_end = page_html.find("</li>", li_start)
        if li_end == -1:
            continue
        li_block = page_html[li_start:li_end + 5]

        a_match = re.search(r'<a\s[^>]*class="NDNGvf"[^>]*>', li_block)
        if not a_match:
            continue
        tag = a_match.group(0)

        href_match = re.search(r'\bhref=["\']([^"\']*)["\']', tag)
        if not href_match:
            continue
        url = _decode_html_entities(href_match.group(1))
        if not url.startswith("http") or "google.com" in url:
            continue

        base_url = re.sub(r"#:~:text=.*$", "", url)
        if base_url in seen_urls:
            continue
        seen_urls.add(base_url)

        label_match = re.search(r'aria-label=["\']([^"\']*)["\']', tag)
        title = _decode_html_entities(label_match.group(1)) if label_match else ""
        title = re.sub(r"\.\s*Opens in new tab\.$", "", title).strip()

        domain = extract_domain(base_url)
        results.append({
            "url": base_url,
            "icon": None,
            "cited": True,
            "title": title,
            "domain": domain,
            "description": None,
        })

    return results


def convert_google_aio_record(item: dict, country: str = "") -> dict:
    """
    Converts a single Google AI Overview BrightData record to the target format.
    answer_text comes from aio_text; all_sources are extracted from page_html NDNGvf anchors.
    The organic field is preserved as requested.
    """
    keyword = item.get("keyword", "")
    aio_text = item.get("aio_text") or ""
    record_country = country or item.get("country") or ""
    timestamp = item.get("timestamp") or (datetime.utcnow().isoformat(timespec="milliseconds") + "Z")

    page_html = item.get("page_html") or ""
    # all_sources: all KEVENd source cards in the AI Overview
    all_sources = extract_aio_citations_from_page_html(page_html) if page_html else []
    # citations: compact list from //li[@class="CyMdWb"]//a[@class="NDNGvf"]
    citations = extract_aio_ndngvf_citations(page_html) if page_html else []

    return {
        "map": None,
        "url": item.get("url", "https://www.google.com/"),
        "index": None,
        "input": {
            "url": "https://www.google.com/",
            "keyword": keyword,
            "country": record_country,
        },
        "model": "google_ai_overview",
        "is_map": False,
        "prompt": keyword,
        "country": record_country,
        "shopping": [],
        "shopping_visible": False,
        "citations": citations,
        "timestamp": timestamp,
        "references": [],
        "answer_text": aio_text,
        "links_attached": [],
        "answer_section_html": "",
        "answer_text_markdown": aio_text,
        "web_search_triggered": True,
        "web_search_query": keyword,
        "search_sources": [],
        "recommendations": [],
        "additional_prompt": "",
        "additional_answer_text": None,
        "all_sources": all_sources,
        "organic": item.get("organic") or [],
    }


class JsonConverter:
    """
    Converts merged JSON from ChatGPT export format to target format.
    """

    def _is_already_converted(self, item: dict) -> bool:
        """Check if an item is already in the converted/target format."""
        # Target format has these keys: prompt, answer_text, url, model, etc.
        target_keys = {'prompt', 'answer_text', 'url', 'model', 'timestamp'}
        item_keys = set(item.keys())
        # If item has at least 3 of these target keys, it's already converted
        return len(target_keys & item_keys) >= 3

    def _is_prompts_dict(self, item: dict) -> bool:
        """Check if item is a prompts dictionary (hash -> prompt string)."""
        if not item:
            return False
        # All values must be strings (the actual prompts)
        # Keys are hash strings (64 chars hex)
        return all(isinstance(v, str) for v in item.values())

    def _is_responses_dict(self, item: dict) -> bool:
        """Check if item is a responses dictionary (hash -> response object)."""
        if not item:
            return False
        # All values must be dicts with response data
        for value in item.values():
            if not isinstance(value, dict):
                return False
            # Should have at least one response key
            if 'markdown_text' in value or 'raw_response' in value or 'llm_model' in value or 'response_text' in value:
                return True
        # If all are dicts but no response keys found, check if they look like responses
        # (have typical response structure)
        for value in item.values():
            if isinstance(value, dict) and ('prompt' in value or 'citations' in value):
                return True
        return False

    def convert_file(self, input_path: str, output_path: str = None, country: str = "") -> tuple[str, int]:
        """
        Converts JSON file from source format to target format.

        Args:
            input_path: Path to source file
            output_path: Path to output file (auto-generated if None)

        Returns:
            (output_path, record_count)
        """
        logger.info(f"Converting JSON file: {input_path}")

        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        if not isinstance(data, list) or len(data) == 0:
            raise ValueError("Expected non-empty array")

        # Determine output path
        if output_path is None:
            output_path = input_path.replace('.json', '_converted.json')

        # Check if data is already in converted format
        # (each item has prompt, answer_text, url, etc.)
        if data and isinstance(data[0], dict) and self._is_already_converted(data[0]):
            logger.info(f"Data is already in converted format ({len(data)} records)")
            # Just copy to output path
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return output_path, len(data)

        # Source format can be:
        # 1. Single batch: [prompts_dict, response_dict]
        # 2. Merged batches: [prompts1, responses1, prompts2, responses2, ...]
        # 3. Mixed: [prompts_dict, {hash: resp}, {hash: resp}, ...]
        # Each prompts_dict has hash keys as keys and prompts as values
        # Each responses_dict has hash keys as keys and response data as values

        if len(data) < 2:
            raise ValueError("Expected at least 2 items: [prompts_dict, response_dict, ...]")

        # Separate prompts_dicts from responses_dicts
        prompts_dict = {}
        responses_dict = {}

        logger.info(f"Processing {len(data)} items from merged data")

        for idx, item in enumerate(data):
            if not isinstance(item, dict):
                logger.warning(f"Item {idx} is not a dict: {type(item)}")
                continue

            if not item:
                logger.warning(f"Item {idx} is empty dict")
                continue

            if self._is_prompts_dict(item):
                before = len(prompts_dict)
                prompts_dict.update(item)
                added = len(prompts_dict) - before
                logger.debug(f"Item {idx}: prompts dict with {len(item)} entries, added {added} new")
            elif self._is_responses_dict(item):
                before = len(responses_dict)
                responses_dict.update(item)
                added = len(responses_dict) - before
                logger.debug(f"Item {idx}: responses dict with {len(item)} entries, added {added} new")
            else:
                # Log more details about unknown format
                value_types = set(type(v).__name__ for v in item.values())
                sample_keys = list(item.keys())[:3]
                logger.warning(f"Item {idx}: unknown format, value types: {value_types}, sample keys: {sample_keys}")

        logger.info(f"Merged totals: {len(prompts_dict)} unique prompts, {len(responses_dict)} unique responses")

        if len(prompts_dict) == 0:
            logger.error("No prompts found in data")
            raise ValueError("No prompts dictionary found in data")

        if len(responses_dict) == 0:
            logger.error("No responses found in data")
            raise ValueError("No responses dictionary found in data")

        results = []
        timestamp = datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'

        matched = 0
        unmatched_prompts = 0
        for hash_key, prompt in prompts_dict.items():
            if hash_key in responses_dict:
                response_data = responses_dict[hash_key]
                converted = convert_record(prompt, response_data, timestamp, country=country)
                results.append(converted)
                matched += 1
            else:
                unmatched_prompts += 1
                if unmatched_prompts <= 5:
                    logger.warning(f"No response for prompt hash {hash_key[:20]}...: {prompt[:50]}...")

        if unmatched_prompts > 0:
            logger.warning(f"Total unmatched prompts: {unmatched_prompts}")

        # Check for responses without prompts
        unmatched_responses = 0
        for hash_key in responses_dict:
            if hash_key not in prompts_dict:
                unmatched_responses += 1
        if unmatched_responses > 0:
            logger.warning(f"Total responses without matching prompts: {unmatched_responses}")

        logger.info(f"Matched {matched} prompt-response pairs, converted {len(results)} records")

        # Save result
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        logger.info(f"Saved converted results to {output_path}")

        return output_path, len(results)

    def _is_brightdata_format(self, item: dict) -> bool:
        """Check if item is in BrightData raw format (has response_raw and answer_html)."""
        return 'response_raw' in item or 'answer_html' in item

    def _is_google_aio_format(self, item: dict) -> bool:
        """Check if item is Google AI Overview format (has keyword and aio_text/aio_citations)."""
        return 'keyword' in item and ('aio_text' in item or 'aio_citations' in item)

    def convert_brightdata_data(self, data: list, output_path: str, country: str = "") -> tuple[str, int]:
        """
        Converts BrightData raw data to the same format as SERP converted records.

        Args:
            data: List of BrightData raw items
            output_path: Path to output file
            country: ISO country code to use for all records

        Returns:
            (output_path, record_count)
        """
        if not isinstance(data, list) or len(data) == 0:
            raise ValueError("Expected non-empty array")

        results = []
        for item in data:
            if not isinstance(item, dict):
                continue
            converted = convert_brightdata_record(item, country=country)
            results.append(converted)

        logger.info(f"Converted {len(results)} BrightData records")

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False)

        return output_path, len(results)

    def convert_google_aio_data(self, data: list, output_path: str, country: str = "") -> tuple[str, int]:
        """
        Converts Google AI Overview BrightData data to the target format.
        """
        if not isinstance(data, list) or len(data) == 0:
            raise ValueError("Expected non-empty array")

        results = []
        for item in data:
            if not isinstance(item, dict):
                continue
            results.append(convert_google_aio_record(item, country=country))

        logger.info(f"Converted {len(results)} Google AI Overview records")

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False)

        return output_path, len(results)

    def convert_data(self, data: list, output_path: str, country: str = "") -> tuple[str, int]:
        """
        Converts data directly from memory to target format.
        Avoids file I/O for reading - more efficient when data is already in memory.

        Args:
            data: List of items to convert (already loaded in memory)
            output_path: Path to output file

        Returns:
            (output_path, record_count)
        """
        if not isinstance(data, list) or len(data) == 0:
            raise ValueError("Expected non-empty array")

        # Check if data is already in converted format
        if data and isinstance(data[0], dict) and self._is_already_converted(data[0]):
            logger.info(f"Data is already in converted format ({len(data)} records)")
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            return output_path, len(data)

        if len(data) < 2:
            raise ValueError("Expected at least 2 items: [prompts_dict, response_dict, ...]")

        # Separate prompts_dicts from responses_dicts
        prompts_dict = {}
        responses_dict = {}

        for idx, item in enumerate(data):
            if not isinstance(item, dict) or not item:
                continue

            if self._is_prompts_dict(item):
                prompts_dict.update(item)
            elif self._is_responses_dict(item):
                responses_dict.update(item)

        logger.info(f"Converting: {len(prompts_dict)} prompts, {len(responses_dict)} responses")

        if len(prompts_dict) == 0:
            raise ValueError("No prompts dictionary found in data")
        if len(responses_dict) == 0:
            raise ValueError("No responses dictionary found in data")

        results = []
        timestamp = datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'

        for hash_key, prompt in prompts_dict.items():
            if hash_key in responses_dict:
                response_data = responses_dict[hash_key]
                converted = convert_record(prompt, response_data, timestamp, country=country)
                results.append(converted)

        logger.info(f"Converted {len(results)} records")

        # Save result (compact format for speed)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False)

        return output_path, len(results)


# Singleton instance
json_converter = JsonConverter()
