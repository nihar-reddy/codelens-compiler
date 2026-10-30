const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const demo = `#include <iostream>
using namespace std;

int main() {
    int total = 10;
    int unused = 20;
    total = 25;
    cout << total;

    if (false) {
        cout << "constant branch";
    }

    return 0;
    cout << "unreachable";
}`;
const stages = [
  ['Source program','Provide or upload the C/C++ source to analyze.'],
  ['Lexical analysis','Inspect the actual token stream generated from the submitted source.'],
  ['Syntax & structure tree','Review parsed statement nodes and delimiter-balance diagnostics.'],
  ['Symbol table & use information','Inspect declarations, read counts, write counts and usage status.'],
  ['Control-flow analysis','Follow the simplified sequential reachability model and inspect unreachable statements.'],
  ['Data-flow analysis','Trace definitions and reads to understand when assigned values are consumed or overwritten.'],
  ['Redundancy detector','Review the rules that fired and the evidence associated with each finding.'],
  ['Explanation engine','Read the what, where, why and suggested action for every warning.'],
  ['Source-level warnings','Review findings together, filter by category, and jump to source lines.'],
  ['Revised source','Review conservative suggested edits before copying or downloading the revised code.']
];
const benchmarkCases = [
 {name:'Unused local', code:'int main() {\n int unused = 4;\n return 0;\n}', expected:['Unused Variable']},
 {name:'Overwritten initializer', code:'int main() {\n int score = 5;\n score = 9;\n cout << score;\n return 0;\n}', expected:['Redundant Assignment']},
 {name:'Statement after return', code:'int main() {\n return 0;\n cout << 3;\n}', expected:['Unreachable Code']},
 {name:'Literal condition', code:'int main() {\n if (false) {\n cout << 1;\n }\n return 0;\n}', expected:['Constant Condition']},
 {name:'Clean variable read', code:'int main() {\n int count = 3;\n cout << count;\n return 0;\n}', expected:[]},
 {name:'Self-update is not a dead store', code:'int main() {\n int x = 5;\n x = x + 1;\n cout << x;\n return 0;\n}', expected:[]},
 {name:'Two consecutive overwrites', code:'int main() {\n int x = 1;\n x = 2;\n x = 3;\n cout << x;\n return 0;\n}', expected:['Redundant Assignment','Redundant Assignment']},
 {name:'Identifier appears only inside a string', code:'int main() {\n int x = 1;\n cout << \"x\";\n return 0;\n}', expected:['Unused Variable']},
 {name:'Unused shadowed local', code:'int main() {\n int x = 1;\n {\n  int x = 2;\n }\n cout << x;\n return 0;\n}', expected:['Unused Variable']},
 {name:'Several statements on one line', code:'int main() { int x = 1; x = 2; cout << x; return 0; }', expected:['Redundant Assignment']},
 {name:'Unreachable declaration — primary diagnosis', code:'int main() {\n return 0;\n int dead = 1;\n}', expected:['Unreachable Code']},
 {name:'Overwritten result of a call', code:'int compute() { return 1; }\nint main() {\n int result;\n result = compute();\n result = 42;\n cout << result;\n return 0;\n}', expected:['Redundant Assignment']}
];
let currentStage=1, report=null, sourceDraft=demo, analysisSource='', lastLatency=0, benchmark=null, toastTimer=null, analyzeBusy=false;
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(s){const el=$('#toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3000)}
function linesOf(s){return s ? s.split('\n').length : 0}
function editor(){return $('#sourceCode')}
function goStage(n){currentStage=Math.max(1,Math.min(10,n));renderStage();window.scrollTo({top:0,behavior:'smooth'})}
function setStageState(){ $$('.stage-link').forEach(b=>{const n=+b.dataset.step;b.classList.toggle('active',n===currentStage);b.classList.toggle('complete',!!report&&n<currentStage);const state=b.querySelector('.stage-state');if(state)state.textContent=report&&n<currentStage?'✓':n===currentStage?'●':'○'}); }
function metric(id,value,suffix=''){const el=$('#'+id);if(el)el.innerHTML=`${esc(value)}<small>${suffix}</small>`}
function updateMetrics(){
 if(!report){metric('metricLatency','—','ms');metric('metricDensity','—','/ 100 LOC');metric('metricPrecision','—','%');metric('metricRecall','—','%');metric('metricF1','—','%');return}
 metric('metricLatency',lastLatency.toFixed(2),'ms');$('#metricLatencyNote').textContent='Measured for latest source analysis';
 metric('metricDensity',report.summary.redundancy_density,'/ 100 LOC');$('#metricDensityNote').textContent=`${report.summary.warnings} findings across ${report.summary.lines} lines`;
 if(benchmark){metric('metricPrecision',benchmark.precision.toFixed(1),'%');metric('metricRecall',benchmark.recall.toFixed(1),'%');metric('metricF1',benchmark.f1.toFixed(1),'%');$('#metricF1Note').textContent=`${benchmark.tp} TP · ${benchmark.fp} FP · ${benchmark.fn} FN · ${benchmark.total} cases`}
 else {metric('metricPrecision','…','%');metric('metricRecall','…','%');metric('metricF1','…','%');$('#metricF1Note').textContent='Evaluating the 12-case labeled benchmark…'}
}
async function fetchWithTimeout(url,options={},timeoutMs=7000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}catch(err){if(err&&err.name==='AbortError')throw new Error(`Request timed out after ${timeoutMs/1000}s (${url}). Check that this CodeLens server is running.`);throw new Error(`Could not reach ${url}. ${err&&err.message?err.message:'Network request failed'}`)}finally{clearTimeout(timer)}}
async function apiAnalyze(source){const t=performance.now();const res=await fetchWithTimeout('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})},10000);let data;try{data=await res.json()}catch{throw Error(`The local server returned an invalid response (HTTP ${res.status}). You may be connected to an older server; restart CodeLens on port 8023.`)}if(!res.ok||data.error)throw Error(data.error||`HTTP ${res.status}`);return {data,ms:performance.now()-t}}
async function calculateBenchmark(){
 const results=await Promise.all(benchmarkCases.map(async c=>({test:c,...(await apiAnalyze(c.code))})));
 let tp=0,fp=0,fn=0,passed=0,rows=[];
 for(const item of results){
  const c=item.test, actual=item.data.warnings.map(w=>w.type);
  const expectedCounts=new Map(),actualCounts=new Map();
  c.expected.forEach(t=>expectedCounts.set(t,(expectedCounts.get(t)||0)+1));
  actual.forEach(t=>actualCounts.set(t,(actualCounts.get(t)||0)+1));
  const types=new Set([...expectedCounts.keys(),...actualCounts.keys()]);
  let caseTP=0,caseFP=0,caseFN=0;
  for(const type of types){const e=expectedCounts.get(type)||0,a=actualCounts.get(type)||0;caseTP+=Math.min(e,a);caseFP+=Math.max(0,a-e);caseFN+=Math.max(0,e-a)}
  tp+=caseTP;fp+=caseFP;fn+=caseFN;const ok=caseFP===0&&caseFN===0;passed+=ok?1:0;
  rows.push({name:c.name,expected:c.expected,actual,ok,caseTP,caseFP,caseFN});
 }
 const precision=tp+fp?100*tp/(tp+fp):0,recall=tp+fn?100*tp/(tp+fn):0,f1=precision+recall?2*precision*recall/(precision+recall):0;
 benchmark={tp,fp,fn,precision,recall,f1,passed,total:benchmarkCases.length,rows};updateMetrics();
 if(currentStage===8)renderStage();
}
function renderBenchmark(){if(!benchmark)return '<div class="callout warning"><b>Benchmark pending</b><p>The labeled evaluation suite is still running. The headline analysis is already available.</p></div>';const statusRows=benchmark.rows.map(r=>[esc(r.name),esc(r.expected.length?r.expected.join(', '):'None'),esc(r.actual.length?r.actual.join(', '):'None'),r.ok?'<span class="status-positive">PASS</span>':`<span class="status-negative">REVIEW · ${r.caseFP} FP / ${r.caseFN} FN</span>`]);return `${summaryCards([['EXACT CASES',`${benchmark.passed}/${benchmark.total}`, 'Expected finding counts matched'],['TRUE POSITIVES',benchmark.tp,'Expected and detected findings'],['FALSE POSITIVES',benchmark.fp,'Unexpected/extra findings'],['FALSE NEGATIVES',benchmark.fn,'Expected findings missed']])}${panel('Labeled benchmark suite','Expected finding types compared as counts, so repeated detections are evaluated correctly',table(['TEST CASE','EXPECTED','DETECTED','RESULT'],statusRows)+`<p class="table-note">The suite includes known edge cases for strings, shadowed scopes, multiple statements per line, and duplicate diagnostics in unreachable code. These expose current analyzer limitations; scores are not manually set.</p>`)}`}
function summaryCards(items){return `<div class="summary-stat-grid">${items.map(x=>`<div class="summary-stat"><small>${esc(x[0])}</small><b>${esc(x[1])}</b><span>${esc(x[2]||'')}</span></div>`).join('')}</div>`}
function panel(title,subtitle,body,extra=''){return `<section class="subpanel ${extra}"><div class="subpanel-head"><div><b>${title}</b><small>${subtitle||''}</small></div></div><div class="subpanel-body">${body}</div></section>`}
function table(headers,rows){return `<div class="data-table-wrap"><table class="data-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No rows to display.</td></tr>`}</tbody></table></div>`}
function warningCards(ws){if(!ws.length)return `<div class="empty-state"><div class="empty-state-icon">✓</div><h4>No selected redundancy patterns detected</h4><p>This is not a guarantee that the source is bug-free. The analyzer only checks its supported subset and rules.</p></div>`;return `<div class="warning-list">${ws.map(w=>`<article class="warning-card"><div class="warning-top"><span class="severity-dot ${w.severity==='error'?'error':w.severity==='info'?'info':''}"></span><b class="warning-type">${esc(w.type)}</b><span class="warning-line">LINE ${w.line}${w.related_line?` · RELATED ${w.related_line}`:''}</span></div><p>${esc(w.message)}</p><p class="reason">${esc(w.reason)}</p><div class="warning-grid"><div><small>ANALYSIS</small><p>${esc(w.analysis)}</p></div><div><small>WHY IT MATTERS</small><p>${esc(w.type==='Unreachable Code'?'This statement is not reached in the supported sequential flow.':w.type==='Redundant Assignment'?'The earlier stored value is overwritten before a read.':w.type==='Unused Variable'?'The declaration has no detected read in reachable supported statements.':'The condition uses a literal value.')}</p></div><div><small>SUGGESTED ACTION</small><p>${esc(w.suggestion)}</p></div></div></article>`).join('')}</div>`}
function editorMarkup(){return `<div id="analysisError" class="analysis-error" hidden role="alert"></div><div class="input-layout"><div class="editor-card"><div class="editor-top"><div class="editor-title"><span class="window-dot red"></span><span class="window-dot amber"></span><span class="window-dot green"></span><b>source.cpp</b><span class="editor-badge">C / C++ subset</span></div><div class="code-actions"><button class="btn btn-quiet" id="uploadBtn">↑ Upload</button><input id="fileInput" type="file" accept=".c,.cc,.cpp,.h,.hpp,.txt" hidden><button class="btn btn-quiet" id="clearBtn">Clear</button></div></div><div class="editor-body"><div class="editor-gutter" id="editorGutter">1</div><textarea id="sourceCode" class="code-input" spellcheck="false" aria-label="Source code input" placeholder="Paste your C/C++ source here…">${esc(sourceDraft)}</textarea></div><div class="editor-bottom"><span id="editorLineCount">7 lines</span><span id="editorCharCount">— characters</span><span>Local processing · source stays on this machine</span></div></div><aside class="input-side"><div class="callout"><b>What happens next?</b><p>Analyze once to populate stages 2–10 with results from the same source snapshot.</p></div><div class="callout warning"><b>Supported subset</b><p>Line-oriented statements and selected redundancy rules. Not a full C/C++ compiler or complete CFG.</p></div><button class="btn btn-primary" id="analyzeMain">▶ Analyze source</button></aside></div>`}
function renderSource(){return editorMarkup()}
function renderTokens(){const toks=report.tokens;const counts={};toks.forEach(t=>counts[t.kind]=(counts[t.kind]||0)+1);return `${summaryCards([['TOKENS',toks.length,'Recognized lexical items'],['KEYWORDS',counts.keyword||0,'Language / library keywords'],['IDENTIFIERS',counts.identifier||0,'Names in source'],['LITERALS',(counts.number||0)+(counts.literal||0),'Numeric and quoted literals']])}${panel('Token stream','Actual tokens emitted by the analyzer',`<div class="token-legend"><span class="token keyword">Keyword</span><span class="token identifier">Identifier</span><span class="token number">Number</span><span class="token literal">Literal</span><span class="token operator">Operator</span><span class="token symbol">Symbol</span></div><div class="token-filter"><input id="tokenSearch" class="mini-select" placeholder="Filter token value or kind…"><span>${toks.length} tokens</span></div><div class="token-grid" id="tokenGrid">${toks.map(t=>`<span class="token-chip ${esc(t.kind)}" data-token="${esc((t.value+' '+t.kind).toLowerCase())}" title="${esc(t.kind)} · line ${t.line}"><small>${t.line}</small>${esc(t.value)}<em>${esc(t.kind)}</em></span>`).join('')}</div>`)}`}
function renderAstNode(node){
 const icons={program:'⌘',function:'ƒ',control:'◇',declaration:'▤',assignment:'↳',return:'⇥',statement:'•'};
 const kind=String(node.kind||'statement');
 const line=node.line?`<small>LINE ${node.line}</small>`:'';
 const row=`<span class="ast-icon">${icons[kind]||'•'}</span><span class="ast-kind ${esc(kind)}">${esc(kind)}</span><code>${esc(node.text||'Source unit')}</code>${line}`;
 if(node.children&&node.children.length){return `<li class="ast-item"><details class="ast-branch" open><summary>${row}<span class="ast-toggle" aria-hidden="true">−</span></summary><ul>${node.children.map(renderAstNode).join('')}</ul></details></li>`}
 return `<li class="ast-item"><div class="ast-leaf">${row}</div></li>`;
}
function buildStructureTree(rows){
 const root={kind:'program',text:'Source unit',line:null,depth:-1,children:[]};
 const stack=[{depth:-1,node:root}];
 for(const st of rows){
  const depth=Math.max(0,Number(st.depth)||0);
  while(stack.length>1&&stack[stack.length-1].depth>=depth)stack.pop();
  const node={...st,depth,children:[]};
  stack[stack.length-1].node.children.push(node);
  stack.push({depth,node});
 }
 return root;
}
function renderTree(){
 const rows=report.statements;
 const root=buildStructureTree(rows);
 const syntax=report.syntax_issues.length?`<div class="callout warning"><b>Structure diagnostics (${report.syntax_issues.length})</b>${report.syntax_issues.map(x=>`<p>Line ${x.line}: ${esc(x.message)}</p>`).join('')}</div>`:`<div class="callout success"><b>Delimiter balance</b><p>No unmatched (), [] or {} delimiters were detected. This is not full grammar validation.</p></div>`;
 const classification=rows.map(st=>[`<span class="ast-kind ${esc(st.kind)}">${esc(st.kind)}</span>`,`<code>${esc(st.text)}</code>`,st.line,st.depth||0]);
 return `${summaryCards([['TREE NODES',rows.length+1,'Program root plus recognized statements'],['DELIMITER ISSUES',report.syntax_issues.length,'Balance checks only'],['MAX NESTING',rows.reduce((m,s)=>Math.max(m,s.depth||0),0),'Approximate brace depth']])}${panel('Program syntax tree','Expandable parent–child view inferred from recognized statements and brace depth',`<div class="ast-toolbar"><span><i></i> Parent / child relationships</span><button type="button" class="btn btn-quiet" id="astExpandAll">Expand all</button><button type="button" class="btn btn-quiet" id="astCollapseAll">Collapse branches</button></div><div class="ast-tree"><ul>${renderAstNode(root)}</ul></div><p class="table-note">This is a simplified structural tree, not a standards-complete C/C++ abstract syntax tree (AST). Nodes come from the analyzer's supported line-oriented statement parser.</p>${syntax}`)}${panel('Statement classification','Detailed line-by-line rows retained as a separate view',table(['NODE TYPE','SOURCE STATEMENT','LINE','DEPTH'],classification))}`
}
function renderSymbols(){const syms=report.symbols;const rows=syms.map(s=>[`<code>${esc(s.name)}</code>`,esc(s.type),s.line,s.reads,s.writes,s.used?'<span class="status-positive">● Read</span>':'<span class="status-negative">● No detected read</span>']);return `${summaryCards([['DECLARATIONS',syms.length,'Supported local declarations'],['READS',syms.reduce((a,s)=>a+s.reads,0),'Identifier references counted as reads'],['WRITES',syms.reduce((a,s)=>a+s.writes,0),'Initializations + assignments']])}${panel('Symbol / use table','Names are keyed by identifier; nested scopes are simplified',table(['NAME','TYPE','DECL. LINE','READS','WRITES','STATUS'],rows)+`<p class="table-note">This is a heuristic symbol table. Shadowed variables and complete lexical scope are not modeled.</p>`)}`}
function renderFlow(){return `${summaryCards([['FLOW NODES',report.flow_nodes.length,'Start + statement sketch + exit'],['UNREACHABLE',report.summary.unreachable,'Marked by sequential return analysis'],['CONTROL FLOW','SEQUENTIAL','Branch edges are not fully modeled']])}${panel('Control-flow graph · simplified','Vertical graph sketch, not a complete compiler CFG',`<div class="flow-canvas">${report.flow_nodes.map((n,i)=>`<div class="flow-node-wrap"><div class="flow-node ${n.kind==='start'?'entry':n.kind==='exit'?'exit':!n.reachable?'dead':''}"><span class="flow-shape">${n.kind==='start'?'▶':n.kind==='exit'?'■':!n.reachable?'!':'◇'}</span><div class="flow-text"><small>${n.line?`LINE ${n.line} · ${esc(n.kind.toUpperCase())}`:esc(n.kind.toUpperCase())}</small><code>${esc(n.label)}</code></div>${!n.reachable?'<span class="flow-tag">UNREACHABLE</span>':''}</div>${i<report.flow_nodes.length-1?'<div class="flow-edge"></div>':''}</div>`).join('')}</div>`)}`}
function renderDataflow(){const assignments=report.warnings.filter(w=>w.type==='Redundant Assignment');const rows=report.statements.filter(s=>s.kind==='declaration'||s.kind==='assignment').map(s=>{const hit=assignments.some(w=>w.line===s.line||w.related_line===s.line);return [`${s.line}`,`<code>${esc(s.text)}</code>`,s.kind,hit?'<span class="status-negative">Potential overwrite</span>':s.reachable?'<span class="status-positive">Reachable</span>':'<span class="status-negative">Unreachable</span>']});return `${summaryCards([['DEFINITION SITES',rows.length,'Declarations and assignments'],['OVERWRITTEN VALUES',assignments.length,'Matched by the current rule'],['READ / WRITE MODEL','BASIC','Sequential approximation']])}${panel('Definition–use trace','Inspect assignment statements and overwrite evidence',table(['LINE','SOURCE','KIND','ANALYSIS'],rows)+`<div class="callout">A full reaching-definitions / live-variable solver is not implemented. These findings use sequential name-based heuristics and should be reviewed.</div>`)}`}
function renderDetector(){const rules=[['Unused Variable','SYMBOL / USE',report.summary.unused,'A declaration has no detected read in reachable supported statements.','#ffc465'],['Redundant Assignment','DEFINITION / USE',report.summary.assignments,'An earlier value is overwritten before a detected read.','#42c4ff'],['Unreachable Code','CONTROL FLOW',report.summary.unreachable,'A statement follows an unconditional return in the supported block.','#ff718a'],['Constant Condition','LITERAL CHECK',report.summary.constants,'An if condition contains a literal true / false / 0 / 1.','#ab88ff']];return `${summaryCards([['RULES ACTIVE',4,'Implemented selected checks'],['FINDINGS',report.warnings.length,'Across all rule categories'],['STRUCTURE ISSUES',report.syntax_issues.length,'Delimiter diagnostics']])}<div class="rule-cards">${rules.map((r,i)=>`<article class="rule-card" style="--rule-color:${r[4]}"><div class="rule-card-head"><span class="rule-index">0${i+1}</span><h4>${r[0]}</h4><span class="rule-count">${r[2]}</span></div><p>${r[3]}</p><div class="rule-card-foot"><span>${r[1]}</span><strong>${r[2]?'TRIGGERED':'NO MATCH'}</strong></div></article>`).join('')}</div>${panel('Rule evaluation','Each count is derived from the current analyzer response',warningCards(report.warnings))}`}
function renderExplanations(){return `${summaryCards([['EXPLANATIONS',report.warnings.length,'One per unique finding'],['LINE REFERENCES',new Set(report.warnings.map(w=>w.line)).size,'Source locations included'],['SUGGESTIONS',report.warnings.filter(w=>w.suggestion).length,'Suggested next actions']])}${panel('Explanation engine','What was found · where it occurs · why it matters · what to do',warningCards(report.warnings))}${renderBenchmark()}`}
function renderWarnings(){return `${summaryCards([['TOTAL FINDINGS',report.warnings.length,'Unique type + line pairs'],['WARNINGS',report.warnings.filter(w=>w.severity==='warning').length,'Review recommended'],['ERROR-LEVEL',report.warnings.filter(w=>w.severity==='error').length,'Unreachable code flags'],['INFO',report.warnings.filter(w=>w.severity==='info').length,'Constant-condition notes']])}<div class="stage-filter"><label for="warningFilter">Filter findings</label><select id="warningFilter" class="mini-select"><option value="all">All categories</option>${[...new Set(report.warnings.map(w=>w.type))].map(t=>`<option>${esc(t)}</option>`).join('')}</select><button id="exportBtn" class="btn btn-quiet">↓ Export report</button></div><div id="warningResults">${warningCards(report.warnings)}</div>${report.syntax_issues.length?panel('Structure diagnostics','Delimiter issues are separate from redundancy findings',report.syntax_issues.map(x=>`<p>Line ${x.line}: ${esc(x.message)}</p>`).join('')):''}`}
function sourceWithHighlights(src){const byLine={};report.warnings.forEach(w=>{byLine[w.line]=w.severity||'warning';if(w.related_line)byLine[w.related_line]='related'});return `<div class="source-lines">${src.split('\n').map((line,i)=>`<div class="source-line ${byLine[i+1]||''}"><span class="ln">${String(i+1).padStart(2,'0')}</span><code>${esc(line)||' '}</code><span class="line-label ${byLine[i+1]||''}">${byLine[i+1]?byLine[i+1].toUpperCase():''}</span></div>`).join('')}</div>`}
function renderRevised(){const fixes=report.applied_fixes||[];return `${summaryCards([['SUGGESTED EDITS',fixes.length,'Conservative single-line changes'],['STRUCTURE ISSUES',report.syntax_issues.length,'Edits pause on delimiter issues'],['REVIEW STATUS',fixes.length?'READY TO REVIEW':'NO SAFE EDITS','Nothing is applied to original automatically']])}${report.rewrite_note?`<div class="callout warning"><b>Rewrite note</b><p>${esc(report.rewrite_note)}</p></div>`:''}<div class="revised-layout">${panel('Original source','Read-only snapshot',`<div class="code-output">${esc(analysisSource)}</div>`)}${panel('Suggested revised source','Editable preview — review before using',`<textarea id="revisedEditor" class="code-output" spellcheck="false">${esc(report.revised_source)}</textarea><div class="code-actions"><button class="btn btn-primary" id="downloadRevised">↓ Download revised .cpp</button><button class="btn btn-quiet" id="copyRevised">Copy revised code</button><button class="btn btn-outline" id="useRevised">Use as new input</button></div>`)}</div>${panel('Applied suggestion log',`${fixes.length} suggested source edit(s)`,fixes.length?`<div class="fix-list">${fixes.map(f=>`<div class="fix-item"><span class="fix-check">✓</span><div><b>Line ${f.line}: ${esc(f.action)}</b><p>${esc(f.description)}</p></div></div>`).join('')}</div>`:'<div class="empty-state"><h4>No conservative edits were generated</h4><p>Either no supported safe fix was found, or structure issues prevented rewriting. Review the findings manually.</p></div>')}`}
function bindEditor(){
 const ta=$('#sourceCode'); if(!ta)return;
 const update=()=>{const n=linesOf(ta.value);const gutter=$('#editorGutter'),lc=$('#editorLineCount'),cc=$('#editorCharCount');if(gutter)gutter.innerHTML=Array.from({length:Math.max(1,n)},(_,i)=>i+1).join('<br>');if(lc)lc.textContent=`${ta.value?n:0} lines`;if(cc)cc.textContent=`${ta.value.length.toLocaleString()} characters`;sourceDraft=ta.value;};
 ta.addEventListener('input',update);ta.addEventListener('scroll',()=>{const g=$('#editorGutter');if(g)g.scrollTop=ta.scrollTop});
 ta.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();ta.setRangeText('    ',ta.selectionStart,ta.selectionEnd,'end');update()}});
 update();$('#uploadBtn')?.addEventListener('click',()=>$('#fileInput')?.click());
 $('#fileInput')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>200000){toast('Please choose a file under 200 KB.');return}try{ta.value=await f.text();update();toast(`Loaded ${f.name}`)}catch(err){showAnalysisError(`Could not read that file: ${err.message}`)}});
 $('#clearBtn')?.addEventListener('click',()=>{ta.value='';update();ta.focus()});
}
function renderStage(){const [title,desc]=stages[currentStage-1];$('#breadcrumbStage').textContent=`${String(currentStage).padStart(2,'0')} · ${title.toUpperCase()}`;$('#stageTitle').innerHTML=`${String(currentStage).padStart(2,'0')} <span>${esc(title)}</span>`;$('#stageDescription').textContent=desc;$('#progressLabel').textContent=`STAGE ${String(currentStage).padStart(2,'0')} OF 10`;$('#progressPercent').textContent=`${currentStage*10}%` ;$('#progressFill').style.width=`${currentStage*10}%`;$('#prevStage').disabled=currentStage===1;$('#nextStage').innerHTML=currentStage===10?'Back to source <span>↺</span>':'Next stage <span>→</span>';setStageState();$('#stepTrack').innerHTML=stages.map((s,i)=>`<button class="${i+1===currentStage?'active':''} ${report&&i+1<currentStage?'done':''}" data-track="${i+1}" title="${esc(s[0])}"><span>${String(i+1).padStart(2,'0')}</span><small class="track-label">${esc(s[0])}</small></button>`).join('');$('#stageContent').innerHTML=currentStage===1?renderSource():!report?`<div class="empty-state"><div class="empty-state-icon">${String(currentStage).padStart(2,'0')}</div><h4>Analyze a source program first</h4><p>Stage ${currentStage} uses the report generated by Stage 1. Return to Source program, enter code and choose Analyze source.</p><button class="btn btn-primary" id="goSource">← Go to source program</button></div>`:[null,renderSource,renderTokens,renderTree,renderSymbols,renderFlow,renderDataflow,renderDetector,renderExplanations,renderWarnings,renderRevised][currentStage]();bindEditor();$('#astExpandAll')?.addEventListener('click',()=>$$('#stageContent .ast-branch').forEach(d=>d.open=true));$('#astCollapseAll')?.addEventListener('click',()=>$$('#stageContent .ast-branch').forEach((d,i)=>{if(i>0)d.open=false}));$('#tokenSearch')?.addEventListener('input',e=>$$('[data-token]').forEach(t=>t.style.display=t.dataset.token.includes(e.target.value.toLowerCase())?'':'none'));$('#warningFilter')?.addEventListener('change',e=>{const ws=e.target.value==='all'?report.warnings:report.warnings.filter(w=>w.type===e.target.value);$('#warningResults').innerHTML=warningCards(ws)});$('#exportBtn')?.addEventListener('click',()=>download('codelens-report.json',JSON.stringify({summary:report.summary,warnings:report.warnings,syntax_issues:report.syntax_issues,scope_note:report.scope_note},null,2),'application/json'));$('#downloadRevised')?.addEventListener('click',()=>download('revised-source.cpp',$('#revisedEditor').value,'text/plain'));$('#copyRevised')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#revisedEditor').value);toast('Revised source copied')}catch{toast('Clipboard permission unavailable; select and copy the code manually')}});$('#useRevised')?.addEventListener('click',()=>{sourceDraft=$('#revisedEditor').value;report=null;analysisSource='';benchmark=null;updateMetrics();goStage(1);toast('Revised source loaded. Analyze it to refresh all stages.')});}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),800)}
function showAnalysisError(message){const box=$('#analysisError');if(box){box.textContent=message;box.hidden=false}toast(message);}
function clearAnalysisError(){const box=$('#analysisError');if(box){box.textContent='';box.hidden=true}}
async function analyze(){
 const ta=$('#sourceCode');if(!ta){goStage(1);toast('Review or edit the source, then click Analyze source.');return}if(!ta.value.trim()){showAnalysisError('Paste or upload C/C++ source code before analysis.');return}if(analyzeBusy)return;
 sourceDraft=ta.value;analysisSource=sourceDraft;benchmark=null;clearAnalysisError();analyzeBusy=true;
 const buttons=[$('#analyzeBtn'),$('#analyzeMain')].filter(Boolean);buttons.forEach(b=>{b.disabled=true;b.dataset.originalText=b.textContent;b.textContent='Analyzing source…'});
 try{
  const {data,ms}=await apiAnalyze(analysisSource);report=data;lastLatency=ms;updateMetrics();
  goStage(2);toast(`Analysis complete · ${report.warnings.length} finding(s)`);
  // Render the actual analysis immediately; benchmark scores are calculated in parallel afterwards.
  calculateBenchmark().catch(e=>{const n=$('#metricF1Note');if(n)n.textContent='Benchmark unavailable: '+e.message;console.error('Benchmark failed:',e)});
 }catch(e){showAnalysisError(`Analysis failed. ${e.message}. Confirm the matching Metrics 1.3.3 server is running at http://127.0.0.1:8023, then refresh this page.`)}
 finally{analyzeBusy=false;buttons.forEach(b=>{b.disabled=false;if(b.id==='analyzeBtn')b.innerHTML='<span>▶</span> Analyze source <kbd>⌘ ↵</kbd>';else b.textContent='▶ Analyze source'})}
}
function updateEngineStatus(online,message){const el=$('#engineStatusText');const wrap=$('.engine-status');if(el)el.textContent=message;if(wrap){wrap.classList.toggle('offline',!online);wrap.title=online?'Python analysis API responded':'Start server.py and open the localhost URL';}}
async function checkEngine(){updateEngineStatus(false,'CHECKING ENGINE…');try{const r=await fetchWithTimeout('/api/health',{},4000);if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();if(!data.ok)throw new Error('Health check returned ok=false');if(data.version!=='1.3.3')throw new Error(`Wrong backend version: ${data.version||'unversioned'} (expected 1.3.3). Stop the old server and restart this build.`);updateEngineStatus(true,'ENGINE CONNECTED · 1.3.3')}catch(e){updateEngineStatus(false,'ENGINE OFFLINE / VERSION MISMATCH');const wrap=$('.engine-status');if(wrap)wrap.title=`Local engine check failed: ${e.message}. Stop old server(s), run CODELENS_PORT=8023 python3 server.py, and open http://127.0.0.1:8023.`;const n=$('#metricF1Note');if(n)n.textContent='Restart the matching 1.3.3 Python server to enable analysis';console.error('CodeLens engine check failed:',e)}}
document.addEventListener('click',e=>{
 const track=e.target.closest('[data-track]');if(track){goStage(Number(track.dataset.track));return}
 const nav=e.target.closest('.stage-link');if(nav){goStage(Number(nav.dataset.step));return}
 if(e.target.closest('#analyzeBtn,#analyzeMain')){analyze();return}
 if(e.target.closest('#prevStage')){goStage(currentStage-1);return}
 if(e.target.closest('#nextStage')){goStage(currentStage===10?1:currentStage+1);return}
 if(e.target.closest('#goSource')){goStage(1);return}
 if(e.target.closest('#loadSample')){sourceDraft=demo;goStage(1);const ta=editor();if(ta){ta.value=demo;ta.dispatchEvent(new Event('input',{bubbles:true}))}toast('Demonstration source loaded');return}
});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();analyze()}});
checkEngine();

renderStage();
