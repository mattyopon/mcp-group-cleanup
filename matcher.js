export const DEFAULT_FILTER = "Claude";

export function effectiveFilter(stored) {
  if (typeof stored !== "string") return DEFAULT_FILTER;
  const trimmed = stored.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_FILTER;
}

export function parseFilter(input) {
  const result = { include: [], exclude: [] };
  if (input == null) return result;
  const str = String(input);
  for (const raw of str.split(/[\s,]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    if (tok.startsWith("!")) {
      const rest = tok.slice(1).trim();
      if (rest) result.exclude.push(rest);
    } else {
      result.include.push(tok);
    }
  }
  return result;
}

export function matchesFilter(title, input) {
  const { include, exclude } = parseFilter(input);
  if (include.length === 0) return false;
  const t = String(title ?? "").toLowerCase();
  if (!include.some((k) => t.includes(k.toLowerCase()))) return false;
  if (exclude.some((k) => t.includes(k.toLowerCase()))) return false;
  return true;
}

export function planCleanup(groups, filter) {
  return groups.filter((g) => matchesFilter(g.title, filter));
}
