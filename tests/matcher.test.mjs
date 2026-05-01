import { strict as assert } from "node:assert";
import {
  matchesFilter,
  planCleanup,
  parseFilter,
  DEFAULT_FILTER,
} from "../matcher.js";

let pass = 0;
let fail = 0;
const log = [];

function t(name, fn) {
  try {
    fn();
    pass++;
    log.push(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    log.push(`  FAIL  ${name}\n        ${e.message.split("\n")[0]}`);
  }
}

t("default filter is 'Claude'", () => {
  assert.equal(DEFAULT_FILTER, "Claude");
});

t("matches exact 'Claude (MCP)'", () => {
  assert.equal(matchesFilter("Claude (MCP)", "Claude"), true);
});

t("matches case-insensitively", () => {
  assert.equal(matchesFilter("CLAUDE (mcp)", "claude"), true);
  assert.equal(matchesFilter("claude (mcp)", "CLAUDE"), true);
});

t("matches partial 'MCP' substring", () => {
  assert.equal(matchesFilter("Claude (MCP)", "MCP"), true);
});

t("matches '⏳Claude' (emoji prefix from issue #16035)", () => {
  assert.equal(matchesFilter("⏳Claude", "Claude"), true);
});

t("matches '✅Claude' (completed marker from issue #16035)", () => {
  assert.equal(matchesFilter("✅Claude", "Claude"), true);
});

t("matches 'Claude Code'", () => {
  assert.equal(matchesFilter("Claude Code", "Claude"), true);
});

t("matches 'Claude in Chrome'", () => {
  assert.equal(matchesFilter("Claude in Chrome", "Claude"), true);
});

t("does NOT match unrelated title", () => {
  assert.equal(matchesFilter("Work", "Claude"), false);
  assert.equal(matchesFilter("Research", "Claude"), false);
});

t("empty filter yields no match (safety)", () => {
  assert.equal(matchesFilter("Claude (MCP)", ""), false);
  assert.equal(matchesFilter("Claude (MCP)", null), false);
  assert.equal(matchesFilter("Claude (MCP)", undefined), false);
});

t("null/undefined title is non-match", () => {
  assert.equal(matchesFilter(null, "Claude"), false);
  assert.equal(matchesFilter(undefined, "Claude"), false);
  assert.equal(matchesFilter("", "Claude"), false);
});

t("planCleanup returns only matching groups", () => {
  const groups = [
    { id: 1, title: "Claude (MCP)" },
    { id: 2, title: "Work" },
    { id: 3, title: "⏳Claude" },
    { id: 4, title: "Research" },
    { id: 5, title: "✅Claude" },
  ];
  const out = planCleanup(groups, "Claude");
  assert.deepEqual(
    out.map((g) => g.id),
    [1, 3, 5]
  );
});

t("planCleanup with empty filter returns nothing", () => {
  const groups = [{ id: 1, title: "Claude (MCP)" }];
  assert.deepEqual(planCleanup(groups, ""), []);
  assert.deepEqual(planCleanup(groups, null), []);
});

t("planCleanup with no matches returns []", () => {
  const groups = [
    { id: 1, title: "Work" },
    { id: 2, title: "Research" },
  ];
  assert.deepEqual(planCleanup(groups, "Claude"), []);
});

t("matches handles non-string titles defensively", () => {
  assert.equal(matchesFilter(42, "42"), true);
  assert.equal(matchesFilter({}, "Claude"), false);
});

// === parseFilter ===
t("parseFilter splits whitespace tokens", () => {
  assert.deepEqual(parseFilter("Claude MCP"), {
    include: ["Claude", "MCP"],
    exclude: [],
  });
});

t("parseFilter splits comma tokens", () => {
  assert.deepEqual(parseFilter("Claude, MCP"), {
    include: ["Claude", "MCP"],
    exclude: [],
  });
});

t("parseFilter handles ! prefix as exclude", () => {
  assert.deepEqual(parseFilter("Claude !Pinned"), {
    include: ["Claude"],
    exclude: ["Pinned"],
  });
});

t("parseFilter ignores empty tokens and lone !", () => {
  assert.deepEqual(parseFilter("  ,  ! ,  Claude   !Foo  "), {
    include: ["Claude"],
    exclude: ["Foo"],
  });
});

t("parseFilter on null/empty returns empty arrays", () => {
  assert.deepEqual(parseFilter(""), { include: [], exclude: [] });
  assert.deepEqual(parseFilter(null), { include: [], exclude: [] });
  assert.deepEqual(parseFilter(undefined), { include: [], exclude: [] });
});

// === multi-keyword include (OR semantics) ===
t("multi-keyword include uses OR", () => {
  assert.equal(matchesFilter("Claude (MCP)", "Claude Foo"), true);
  assert.equal(matchesFilter("Foo bar", "Claude Foo"), true);
  assert.equal(matchesFilter("Bar", "Claude Foo"), false);
});

// === exclude pattern ===
t("exclude blocks otherwise-matching titles", () => {
  assert.equal(matchesFilter("Claude (Pinned)", "Claude !Pinned"), false);
  assert.equal(matchesFilter("Claude (MCP)", "Claude !Pinned"), true);
});

t("exclude is case-insensitive", () => {
  assert.equal(matchesFilter("Claude PINNED", "Claude !pinned"), false);
});

t("filter with only exclude (no include) yields no match", () => {
  assert.equal(matchesFilter("Claude (MCP)", "!Foo"), false);
});

t("planCleanup respects exclude tokens", () => {
  const groups = [
    { id: 1, title: "Claude (MCP)" },
    { id: 2, title: "Claude Pinned" },
    { id: 3, title: "Claude Code" },
  ];
  assert.deepEqual(
    planCleanup(groups, "Claude !Pinned").map((g) => g.id),
    [1, 3]
  );
});

// === effectiveFilter ===
t("effectiveFilter returns stored value when non-empty", () => {
  assert.equal(effectiveFilter("MCP"), "MCP");
  assert.equal(effectiveFilter("Claude !Pinned"), "Claude !Pinned");
});

t("effectiveFilter falls back to DEFAULT_FILTER on empty string", () => {
  assert.equal(effectiveFilter(""), DEFAULT_FILTER);
});

t("effectiveFilter falls back to DEFAULT_FILTER on whitespace only", () => {
  assert.equal(effectiveFilter("   "), DEFAULT_FILTER);
  assert.equal(effectiveFilter("\t\n"), DEFAULT_FILTER);
});

t("effectiveFilter falls back to DEFAULT_FILTER on null/undefined/non-string", () => {
  assert.equal(effectiveFilter(null), DEFAULT_FILTER);
  assert.equal(effectiveFilter(undefined), DEFAULT_FILTER);
  assert.equal(effectiveFilter(42), DEFAULT_FILTER);
  assert.equal(effectiveFilter({}), DEFAULT_FILTER);
});

t("effectiveFilter trims surrounding whitespace", () => {
  assert.equal(effectiveFilter("  Claude  "), "Claude");
});

console.log(log.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
