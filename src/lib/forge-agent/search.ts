import type { RankedSearchHit, SearchableItem } from "@/lib/forge-agent/types";

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s./:_-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function scoreItem(item: SearchableItem, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const name = item.name.toLowerCase();
  const description = item.description.toLowerCase();
  const path = (item.path ?? item.uriTemplate ?? "").toLowerCase();
  const tags = item.tags.map((tag) => tag.toLowerCase());
  let score = 0;

  for (const token of tokens) {
    let tokenScore = 0;
    if (name === token) tokenScore = Math.max(tokenScore, 100);
    if (name.startsWith(token) || name.endsWith(`.${token}`)) {
      tokenScore = Math.max(tokenScore, 80);
    }
    if (name.includes(token)) tokenScore = Math.max(tokenScore, 50);
    if (tags.some((tag) => tag === token || tag.includes(token))) {
      tokenScore = Math.max(tokenScore, 25);
    }
    if (path.includes(token)) tokenScore = Math.max(tokenScore, 30);
    if (description.includes(token)) tokenScore = Math.max(tokenScore, 20);
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }
  return score;
}

export function rankForgeAgentHits(
  query: string,
  items: SearchableItem[],
): RankedSearchHit[] {
  const tokens = tokenize(query);
  return items
    .map((item) => ({ ...item, score: scoreItem(item, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
