import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
const packageDir = fileURLToPath(new URL('../', import.meta.url));
const version = process.env.PI_TEST_HOST_DIR ? '' : execFileSync('pi', ['--version'], {encoding:'utf8'}).trim();
const root = process.env.PI_TEST_HOST_DIR || path.join(os.homedir(), '.pi/agent/install/releases', version, 'node_modules/@earendil-works/pi-coding-agent');
const imp = (p) => import(pathToFileURL(p).href);
const hostRequire = (await import('node:module')).createRequire(path.join(root,'package.json'));
const tui = await imp(hostRequire.resolve('@earendil-works/pi-tui'));
const tmp = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(),'claude-package-test-'));
const agentDir = path.join(tmp,'agent'); fs.mkdirSync(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;
const preferencesPath = path.join(agentDir,'claude-style.json');
const settingsPath = path.join(agentDir,'settings.json');
const globalSettings = JSON.stringify({theme:'light/light',unrelated:'keep'});
fs.writeFileSync(settingsPath,globalSettings);
const {loadExtensions} = await imp(path.join(root,'dist/core/extensions/loader.js'));
const themes = await imp(path.join(root,'dist/modes/interactive/theme/theme.js'));
const {validateThemeJson} = await imp(path.join(root,'dist/modes/interactive/theme/theme-json.js'));
const {ToolExecutionComponent} = await imp(path.join(root,'dist/modes/interactive/components/tool-execution.js'));
const {InteractiveMode} = await imp(path.join(root,'dist/modes/interactive/interactive-mode.js'));
themes.setThemeJsonValidator(validateThemeJson);
const light = themes.loadThemeFromPath(path.join(packageDir,'themes/light.json'),'truecolor');
const dark = themes.loadThemeFromPath(path.join(packageDir,'themes/dark.json'),'truecolor');
themes.setRegisteredThemes([light,dark]); themes.initTheme('light');
const nativeLight = themes.getThemeByName('light');
const nativeDark = themes.getThemeByName('dark');
let count = 0;
const test = async (name,run) => {await run(); assert.equal(fs.readFileSync(settingsPath,'utf8'),globalSettings); count++; console.log('PASS',name);};
const load = async (preferences) => {
 if (preferences === undefined) {if(fs.existsSync(preferencesPath)) fs.unlinkSync(preferencesPath);}
 else fs.writeFileSync(preferencesPath,JSON.stringify(preferences));
 const result = await loadExtensions([path.join(packageDir,'index.ts')],tmp);
 assert.deepEqual(result.errors,[]); assert.equal(result.extensions.length,1);
 assert.equal(result.extensions[0].tools.size,0,'display package must not replace execution tools');
 return result.extensions[0];
};
const emit = async (ext,type,ctx) => {for(const handler of ext.handlers.get(type) || []) await handler({type,reason:'reload'},ctx);};
const mock = (initial = nativeLight) => {
 let active=initial, reloads=0; const notifications=[];
 const ctx={hasUI:true,ui:{get theme(){return active;},getTheme:themes.getThemeByName,
  setTheme(theme){assert.equal(typeof theme,'object','must not persist a theme name'); active=theme; return {success:true};},
  notify(text){notifications.push(text);}},async reload(){reloads++;}};
 return {ctx,notifications,get active(){return active;},get reloads(){return reloads;},change(theme){active=theme;}};
};
try {
 let enabled;
 await test('default package loads one renderer and creates no preferences',async()=>{
  enabled=await load(); assert.equal(enabled.toolRenderers.length,1); assert.ok(!fs.existsSync(preferencesPath));
 });
 await test('root index entry displays package name rather than extensions',()=>{
  const mode=Object.create(InteractiveMode.prototype);
  const entry=path.join(tmp,'pi-claude-style','index.ts');
  const labels=mode.getCompactExtensionLabels([{path:entry,sourceInfo:{source:path.dirname(entry),scope:'user',baseDir:path.dirname(entry)}}]);
  assert.deepEqual(labels,['pi-claude-style']);
 });
 await test('light theme applies only for session and restores on shutdown',async()=>{
  const m=mock(); await emit(enabled,'session_start',m.ctx); assert.equal(m.active.name,'claude-style-light');
  await emit(enabled,'session_shutdown',m.ctx); assert.equal(m.active.name,'light');
 });
 await test('automatic dark and forced-light theme selection',async()=>{
  let ext=await load(); let m=mock(nativeDark); await emit(ext,'session_start',m.ctx); assert.equal(m.active.name,'claude-style-dark');
  await emit(ext,'session_shutdown',m.ctx); assert.equal(m.active.name,'dark');
  ext=await load({theme:'light'}); m=mock(nativeDark); await emit(ext,'session_start',m.ctx); assert.equal(m.active.name,'claude-style-light');
 });
 await test('theme none leaves user theme untouched',async()=>{
  const ext=await load({theme:'none'}); const m=mock(); await emit(ext,'session_start',m.ctx);
  assert.equal(m.active.name,'light'); assert.equal(ext.toolRenderers.length,1);
 });
 await test('disabled package leaves renderer resolution and theme untouched',async()=>{
  const ext=await load({enabled:false}); const m=mock(); assert.equal(ext.toolRenderers?.length ?? 0,0);
  await emit(ext,'session_start',m.ctx); assert.equal(m.active.name,'light');
 });
 await test('shutdown preserves a later theme change',async()=>{
  const ext=await load(); const m=mock(); await emit(ext,'session_start',m.ctx); m.change(nativeDark);
  await emit(ext,'session_shutdown',m.ctx); assert.equal(m.active.name,'dark');
 });
 await test('non-interactive mode does not touch UI',async()=>{
  const ext=await load(); await emit(ext,'session_start',{hasUI:false}); await emit(ext,'session_shutdown',{hasUI:false});
 });
 await test('off/on commands persist and reload, preserving unknown preference fields',async()=>{
  let ext=await load({enabled:true,theme:'auto',custom:'keep'}); const m=mock();
  await ext.commands.get('claude-style').handler('off',m.ctx); assert.equal(m.reloads,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(preferencesPath)),{enabled:false,theme:'auto',custom:'keep'});
  ext=await load(JSON.parse(fs.readFileSync(preferencesPath))); assert.equal(ext.toolRenderers?.length ?? 0,0);
  await ext.commands.get('claude-style').handler('on',m.ctx); assert.equal(m.reloads,2);
  ext=await load(JSON.parse(fs.readFileSync(preferencesPath))); assert.equal(ext.toolRenderers.length,1);
 });
 await test('status/invalid commands do not write or reload; theme mode command persists',async()=>{
  const ext=await load(); const m=mock(); const cmd=ext.commands.get('claude-style');
  await cmd.handler('status',m.ctx); await cmd.handler('bad-command',m.ctx);
  assert.equal(m.reloads,0); assert.ok(!fs.existsSync(preferencesPath));
  await cmd.handler('theme none',m.ctx); assert.equal(m.reloads,1);
  assert.equal(JSON.parse(fs.readFileSync(preferencesPath)).theme,'none');
 });
 await test('invalid preference schema produces an explicit load error',async()=>{
  fs.writeFileSync(preferencesPath,'{"enabled":"yes"}');
  const result=await loadExtensions([path.join(packageDir,'index.ts')],tmp);
  assert.equal(result.extensions.length,0); assert.ok(result.errors[0].error.includes('Invalid Claude Style preferences'));
 });
 enabled=await load(); const resolver=enabled.toolRenderers[0]; themes.setThemeInstance(light);
 function render(name,args,text,{width=80,expanded=false,isError=false,isPartial=false,details={}}={}) {
  const renderer=resolver(name,()=>undefined);
  const ctx={args,toolCallId:'test',invalidate(){},state:{},cwd:tmp,executionStarted:true,argsComplete:true,isPartial,expanded,showImages:false,isError};
  const result={content:Array.isArray(text)?text:[{type:'text',text}],details}; const snapshot=JSON.stringify(result);
  const call=renderer.renderCall(args,light,ctx).render(width);
  const body=renderer.renderResult(result,{expanded,isPartial},light,ctx).render(width);
  assert.equal(JSON.stringify(result),snapshot);
  for(const line of [...call,...body]) assert.ok(tui.visibleWidth(line)<=width);
  return {call:call.map(tui.stripTerminalSequences),body:body.map(tui.stripTerminalSequences),renderer};
 }
 const command=`cd ${tmp} && python3 -c "\nprint('full command')\n"`;
 await test('long call and output collapse into two rows',()=>{
  const r=render('bash',{command},'a\nb\nc'); assert.equal(r.call.length,1); assert.equal(r.body.length,1); assert.ok(!r.call[0].includes('cd '));
 });
 await test('expanded parameters and multiple text blocks remain accessible',()=>{
  const r=render('bash',{command,timeout:20},[{type:'text',text:'first'},{type:'text',text:'last'}],{expanded:true});
  assert.ok(r.call.join('\n').includes('full command')); assert.ok(r.call.join('\n').includes('timeout')); assert.ok(r.body.join('\n').includes('last'));
 });
 await test('read result count and relative file path',()=>{
  const r=render('read',{path:path.join(tmp,'file.txt')},'a\nb'); assert.ok(r.call[0].includes('Read(file.txt)')); assert.ok(r.body[0].includes('2 行文本'));
 });
 await test('error details are visible and expandable',()=>{
  const r=render('bash',{command:'exit 1'},'ERROR\nreason\ntrace\nextra',{isError:true}); assert.equal(r.body.length,4); assert.ok(r.body[0].includes('ERROR'));
 });
 await test('edit diff preview is bounded; full diff expands',()=>{
  const diff=Array.from({length:12},(_,i)=>`+${i+1} changed`).join('\n');
  assert.equal(render('edit',{path:'a.ts'},'ok',{details:{diff}}).body.length,8);
  assert.ok(render('edit',{path:'a.ts'},'ok',{details:{diff},expanded:true}).body.join('\n').includes('+12 changed'));
 });
 await test('streaming and empty result states',()=>{
  assert.ok(render('bash',{command:'sleep 1'},'',{isPartial:true}).body[0].includes('运行中'));
  assert.ok(render('bash',{command:'true'},'').body[0].includes('无文本输出'));
 });
 await test('unknown tool parameters use generic compact display',()=>{
  assert.ok(render('mcp__search',{query:'主题'},'found').call[0].includes('主题'));
 });
 await test('terminal control sequences are removed from untrusted content',()=>{
  const r=render('bash',{command:'echo \x1b[2Jhello'},'\x1b]0;unwanted\x07safe'); assert.ok(r.body[0].includes('safe')); assert.ok(!r.body[0].includes('unwanted'));
 });
 await test('native truncation warnings and output-file paths are not hidden',()=>{
  const r=render('bash',{command:'large'},'partial',{details:{truncation:{truncated:true},fullOutputPath:'/tmp/full.txt'}}); assert.ok(r.body[1].includes('/tmp/full.txt'));
 });
 await test('wide Unicode and errors fit widths 1 through 120',()=>{
  for(const width of [1,8,20,40,80,120]) {
   render('bash',{command:'中文😀'.repeat(80)},'结果😀'.repeat(100),{width});
   render('bash',{command:'fail'},'错误😀'.repeat(100)+'\ntrace',{width,isError:true});
   render('edit',{path:'中文.ts'},'ok',{width,details:{diff:'+1 '+'中文'.repeat(100)}});
  }
 });
 await test('real host component renders self shell, click-expands and collapses',()=>{
  const c=new ToolExecutionComponent('bash','test',{command},{showImages:false},resolver('bash',()=>undefined),{requestRender(){}},tmp);
  c.markExecutionStarted(); c.setArgsComplete(); c.updateResult({content:[{type:'text',text:'a\nb'}],details:{},isError:false},false);
  const rows=c.render(80); assert.equal(rows.length,3); assert.equal(c.getRenderShell(),'self'); assert.ok(!rows.join('\n').includes('Took'));
  assert.ok(!/\x1b\[(?:48|4[0-7])(?:;|m)/.test(rows.join('\n')));
  assert.equal(c.handleMouse({type:'click',button:'left',x:1,y:2,width:80,height:3})?.handled,true);
  assert.ok(c.render(80).length>rows.length); c.setExpanded(false); assert.equal(c.render(80).length,3);
 });
 console.log(`SUCCESS: ${count} tests passed; host Pi ${JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version}`);
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
