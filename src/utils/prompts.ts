export interface ParsedPrompt {
  group: string;
  text: string;
}

export function parsePrompts(input: string): ParsedPrompt[] {
  const seen = new Set<string>();
  return input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [maybeGroup, ...rest] = line.split(';');
      if (rest.length > 0) {
        const text = rest.join(';').trim();
        return { group: maybeGroup.trim() || 'General', text };
      }
      return { group: 'General', text: line };
    })
    .filter(({ text }) => {
      const key = text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function formatPromptsForDisplay(prompts: ParsedPrompt[]): string {
  return prompts
    .map(p => p.group === 'General' ? p.text : `${p.group};${p.text}`)
    .join('\n');
}

export function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}