const MAX_CHARS = 50000;

export function buildPrompt(diffData: unknown): string {
  // Truncate large diff data to avoid token limits (~50k chars)
  let diffStr = JSON.stringify(diffData, null, 2);
  if (diffStr.length > MAX_CHARS) {
    diffStr = diffStr.substring(0, MAX_CHARS) + '\n... (truncated due to size)';
  }

  return `You are a senior frontend performance engineer. Analyze the Rsdoctor bundle-diff JSON below (baseline → current) and produce a concise GitHub PR comment in Markdown.

## Output format

### 📊 Size Changes

| Asset / Chunk | Baseline | Current | Δ Size | Δ % | Initial? |
|---|---|---|---|---|---|

(Only list entries with **>5 % or >10 KB** increase. If none, write "No significant regressions detected 🎉".)

### 🔍 Root Cause Analysis
- Bullet points: which modules / dependencies drove each regression.

### ⚠️ Risk Assessment
Overall severity: **Low / Medium / High**
- One-sentence justification focusing on initial-chunk impact and total size delta.

### 💡 Optimization Suggestions
- Numbered, actionable steps (e.g. code-split, tree-shake, replace heavy deps).

## Priority rules
1. Initial / entry chunks > async chunks > static assets.
2. Newly added large modules or duplicate dependencies deserve explicit callout.
3. If total bundle size *decreased*, highlight the wins instead.

## Constraints
- Be concise — aim for <300 words.
- Use exact numbers from the data; do not fabricate figures.
- If the diff data is empty or shows no meaningful change, state that clearly and skip the table.

Bundle diff data:
\`\`\`json
${diffStr}
\`\`\``;
}
