// A small robots.txt reader: whether one path may be fetched by our importer.
//
// Rules are taken from the group that names our agent, else from "*". The longest
// matching Allow/Disallow wins and Allow wins a tie (the usual crawler reading);
// "*" and a trailing "$" work in a pattern. An empty Disallow allows everything.
// Anything that cannot be read as a robots file allows the page: a missing or
// broken robots.txt is not a "no".

export type RobotsRule = { allow: boolean; pattern: string };

export function parseRobots(text: string, agent: string): RobotsRule[] {
  const me = agent.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const at = line.indexOf(":");
    if (at < 1) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === "allow") cur.rules.push({ allow: true, pattern: value });
    else if (field === "disallow") cur.rules.push({ allow: false, pattern: value });
  }
  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): boolean {
  if (pattern === "") return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

/** Whether robots rules allow fetching `path` (path plus query, e.g. "/a/b?x=1"). */
export function robotsAllows(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}
