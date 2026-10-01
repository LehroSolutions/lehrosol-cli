export const MARKETPLACE_CATALOG=Object.freeze([
{id:'grok',type:'adapter',name:'xAI Grok',source:'builtin',license:'provider-terms',setup:'lehrosol models use --profile grok-4.5 --apiKey <XAI_API_KEY>',capabilities:['tools','reasoning','code']},
{id:'ollama',type:'adapter',name:'Ollama local models',source:'builtin',license:'MIT',setup:'lehrosol models use --profile ollama-qwen-coder',capabilities:['local','tools','offline']},
{id:'opencode',type:'adapter',name:'OpenCode CLI',source:'builtin',license:'MIT',setup:'lehrosol config set --adapter opencode --bin opencode',capabilities:['cli','tools','mcp']},
{id:'qwen',type:'adapter',name:'Qwen Code',source:'builtin',license:'Apache-2.0',setup:'npm install -g @qwen-code/qwen-code@latest',capabilities:['cli','code']},
{id:'vscode',type:'extension',name:'LehroSol VS Code Companion',source:'bundled',license:'Apache-2.0',setup:'lehrosol ide install --editor vscode',capabilities:['tasks','terminal','mcp']},
{id:'homebrew',type:'distribution',name:'Homebrew Formula Generator',source:'bundled',license:'Apache-2.0',setup:'lehrosol release formula --url <tarball-url>',capabilities:['macos','linux']}
]);
export function listCatalog({type}={}){return MARKETPLACE_CATALOG.filter(i=>!type||i.type===type).map(i=>({...i,capabilities:[...i.capabilities]}));}
export function getCatalogItem(id){const item=MARKETPLACE_CATALOG.find(i=>i.id===String(id||'').trim().toLowerCase());return item?{...item,capabilities:[...item.capabilities]}:null;}
