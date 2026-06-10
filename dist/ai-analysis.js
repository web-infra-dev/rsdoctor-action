"use strict";exports.ids=[277],exports.modules={"./src/ai-analysis.ts"(e,s,n){n.d(s,{analyzeWithAI:()=>l});var i=n("fs"),t=n("./node_modules/.pnpm/ai@6.0.159_zod@4.3.6/node_modules/ai/dist/index.mjs"),a=n("./node_modules/.pnpm/@ai-sdk+anthropic@3.0.69_zod@4.3.6/node_modules/@ai-sdk/anthropic/dist/index.mjs"),o=n("./node_modules/.pnpm/@ai-sdk+deepseek@2.0.29_zod@4.3.6/node_modules/@ai-sdk/deepseek/dist/index.mjs"),d=n("./node_modules/.pnpm/@ai-sdk+google@3.0.63_zod@4.3.6/node_modules/@ai-sdk/google/dist/index.mjs"),r=n("./node_modules/.pnpm/@ai-sdk+openai@3.0.52_zod@4.3.6/node_modules/@ai-sdk/openai/dist/index.mjs");async function l(e,s,n="claude-3-5-haiku-latest"){if(!s)return console.log("ℹ️  No AI token provided, skipping AI analysis"),null;if(!i.existsSync(e))return console.log(`⚠️  Bundle diff JSON not found at ${e}, skipping AI analysis`),null;try{var u;let l,c,p=(u=JSON.parse(i.readFileSync(e,"utf8")),(l=JSON.stringify(u,null,2)).length>5e4&&(l=l.substring(0,5e4)+"\n... (truncated due to size)"),`You are a senior frontend performance engineer. Analyze the Rsdoctor bundle-diff JSON below (baseline → current) and produce a concise GitHub PR comment in Markdown.

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
${l}
\`\`\``),m=(c=n.toLowerCase()).startsWith("claude")?"anthropic":c.startsWith("gemini")?"google":c.startsWith("deepseek")?"deepseek":c.startsWith("qwen")?"qwen":"openai";console.log(`🤖 Running AI analysis with ${m} (${n})...`);let h=function(e,s,n){switch(e){case"anthropic":return(0,a.nM)({apiKey:n})(s);case"google":return(0,d.sw)({apiKey:n})(s);case"deepseek":return(0,o.PW)({apiKey:n})(s);case"qwen":return(0,r.ry)({apiKey:n,baseURL:"https://dashscope.aliyuncs.com/compatible-mode/v1"})(s);default:return(0,r.ry)({apiKey:n})(s)}}(m,n,s),{text:g}=await (0,t.Df)({model:h,maxOutputTokens:2048,prompt:p});return console.log("✅ AI analysis completed"),{analysis:g,provider:m,model:n}}catch(e){return console.warn(`⚠️ AI analysis failed: ${e}`),null}}}};