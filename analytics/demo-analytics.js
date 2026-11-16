/* Public, consented demo measurements. No document or session data is read. */
(() => {
  const w = window, d = document, KEY = 'superdoc_cookie_preferences';
  const routes = {'/':'gallery','/custom-word-editor/':'custom-word-editor','/collab/':'agentic-collaboration','/builder/':'template-builder-api-v2','/docrag/':'docrag','/version-history/':'version-history'};
  const path = w.location.pathname.replace(/\/*$/, '/'), example = routes[path];
  const actions = new Set(['exposed','option_exposed','selected','load_started','ready','load_failed','explored','edit_observed','review_action','field_edited','ai_started','ai_succeeded','ai_failed','export_requested','export_completed','export_failed','task_started','task_succeeded','task_failed','source_clicked','docs_clicked','build_opened','build_copied','citation_opened']);
  const capabilities = new Set(['none','document','review','fields','ai','collaboration','version_history','answer']);
  const FRAME_ORIGIN='https://www.superdoc.dev';
  const seen = new Set(); let loaded = false, granted = false, exposureTimer, frame=null, frameReady=false, initialized=false, blocked=false; const pending=[]; let origin='builtin_example'; let reobserve=()=>{};
  const privateSignal = () => w.navigator.globalPrivacyControl === true || w.superdocAnalyticsOptOut === true || [w.navigator.doNotTrack,w.doNotTrack].some(v=>['1','yes'].includes(String(v).toLowerCase()));
  const cleanUrl=url=>!url.hash&&[...new URLSearchParams(url.search)].every(([k,v])=>k==='demo_entry'&&['homepage','gallery'].includes(v));
  const bootAllowed=w.location.hostname==='demos.superdoc.dev'&&!!example&&cleanUrl(w.location);
  const initialEntry=new URLSearchParams(w.location.search).get('demo_entry');
  const publicSurface=()=>bootAllowed&&!blocked&&w.location.pathname.replace(/\/*$/, '/')===path&&!w.location.hash;
  function post(type,payload){frame?.contentWindow?.postMessage({channel:'superdoc-demo-analytics-v1',type,...(payload?{payload}:{})},FRAME_ORIGIN);}
  function stop(){granted=false;clearTimeout(exposureTimer);pending.length=0;post('disable');frame?.remove();frame=null;frameReady=false;loaded=false;}
  const preference = () => {try{const c=JSON.parse(w.localStorage.getItem(KEY)),age=Date.now()-c.savedAt;return c.version===1&&age>=0&&age<180*86400000&&typeof c.analytics==='boolean'?c:null;}catch{return null;}};
  function emit(action, capability='none', target=example) {
    if (!granted || privateSignal() || !publicSurface() || !actions.has(action) || !capabilities.has(capability) || !Object.values(routes).includes(target)) return false;
    const key=[target,action,capability].join(':'); if(seen.has(key))return false;
    const payload={page:example,example_id:target,document_origin:origin,entry:initialEntry==='homepage'?'homepage':initialEntry==='gallery'?'selection':'direct_link',action,capability};
    if(frameReady)post('event',payload);else if(pending.length<100)pending.push(payload);else return false;
    seen.add(key);return true;
  }
  function apply(c) {
    granted=!!c?.analytics&&!privateSignal()&&!!publicSurface();
    if(!granted){stop();return;}
    if(loaded)return;loaded=true;
    frame=d.createElement('iframe');frame.hidden=true;frame.title='Optional demo analytics';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.src=FRAME_ORIGIN+'/demo-analytics-frame.html';d.body.append(frame);
    emit('load_started'); reobserve(); if(d.visibilityState==='visible')exposureTimer=setTimeout(()=>{if(d.visibilityState==='visible')emit('exposed');},1000);
  }
  // A single per-origin settings surface; never inherit another person's consent.
  function settings(force=false){
    if(!publicSurface())return;
    if(!force&&preference())return;
    if(d.getElementById('superdoc-demo-consent'))return;
    const panel=d.createElement('section');panel.id='superdoc-demo-consent';panel.setAttribute('aria-label','Optional demo analytics');
    panel.style.cssText='position:fixed;bottom:12px;right:12px;max-width:min(360px,calc(100vw - 24px));padding:16px;background:white;color:#242424;border:1px solid #ccc;border-radius:12px;z-index:99999;font:14px/1.5 system-ui;box-shadow:0 4px 24px #0002';
    const text=d.createElement('p');text.textContent='Help us improve these demos with optional usage analytics. Document contents, prompts and filenames are excluded.';panel.append(text);
    for(const [label,value] of [['Allow analytics',true],['Decline',false]]){const b=d.createElement('button');b.textContent=label;b.style.cssText='padding:8px;margin:4px';b.onclick=()=>{const choice={version:1,savedAt:Date.now(),analytics:value&&!privateSignal(),identification:false};try{w.localStorage.setItem(KEY,JSON.stringify(choice));}catch{}panel.remove();apply(choice);};panel.append(b);}
    const privacy=d.createElement('a');privacy.href='https://superdocportal.dev/privacy';privacy.textContent='Privacy policy';panel.append(privacy);d.body.append(panel);
  }
  function start(){
    if(!publicSurface())return;
    initialized=true;apply(preference());settings();
    const b=d.createElement('button');b.textContent='Privacy settings';b.style.cssText='position:fixed;left:8px;bottom:8px;z-index:9998;font:12px system-ui;padding:5px';b.onclick=()=>settings(true);d.body.append(b);
    d.addEventListener('click',e=>{
      if(!e.isTrusted)return;const a=e.target.closest?.('a');
      if(a){try{const url=new URL(a.href,w.location.href),target=routes[url.pathname.replace(/\/*$/, '/')];if(url.origin===w.location.origin&&target&&target!=='gallery'){emit('selected','none',target);if(!url.search&&!url.hash){url.searchParams.set('demo_entry','gallery');a.href=url.href;}}else if(url.hostname==='github.com'||url.hostname==='docs.superdoc.dev'){const card=a.closest('.demo-card'),live=card?.querySelector('.card-main-link');let id=example;try{if(live)id=routes[new URL(live.href).pathname.replace(/\/*$/, '/')];}catch{}emit(url.hostname==='github.com'?'source_clicked':'docs_clicked','none',id);}}catch{}}
      const button=e.target.closest?.('button');if(button){if(button.hasAttribute('data-build-dialog')||button.textContent.trim()==='Build this')emit('build_opened','none',button.getAttribute('data-build-dialog')?.replace(/^build-/, '')||example);}
    });
    d.addEventListener('visibilitychange',()=>{clearTimeout(exposureTimer);if(d.visibilityState==='visible')exposureTimer=setTimeout(()=>emit('exposed'),1000);});
    d.addEventListener('change',e=>{if(e.isTrusted&&e.target?.type==='file')origin='visitor_file';});
    d.addEventListener('input',e=>{if(e.isTrusted&&e.target.closest?.('[contenteditable="true"],[data-editor-host="v2"][role="textbox"]'))emit('edit_observed','document');});
    if(example==='gallery'&&w.IntersectionObserver){const timers=new Map();const observer=new IntersectionObserver(entries=>{for(const item of entries){clearTimeout(timers.get(item.target));if(item.isIntersecting&&item.intersectionRatio>=.5)timers.set(item.target,setTimeout(()=>{if(d.visibilityState==='visible'){const a=item.target.querySelector('a[href]');try{emit('option_exposed','none',routes[new URL(a.href).pathname.replace(/\/*$/, '/')]);}catch{}}},1000));}},{threshold:[0,.5]});reobserve=()=>{observer.disconnect();d.querySelectorAll('.demo-card').forEach(el=>observer.observe(el));};reobserve();d.addEventListener('visibilitychange',()=>{if(d.visibilityState!=='visible'){for(const t of timers.values())clearTimeout(t);}else reobserve();});}
  }
  // Generated demo-room setup happens before start. Incoming private links
  // never opt in. Later private navigation stops measurements without changing
  // application navigation or sending the new URL to the vendor frame.
  for(const method of ['pushState','replaceState']){
    const original=w.history?.[method]?.bind(w.history);if(!original)continue;
    w.history[method]=function(state,title,url){
      if(initialized&&url){const next=new URL(url,w.location.href);if(next.origin!==w.location.origin||next.pathname.replace(/\/*$/, '/')!==path||!cleanUrl(next)){blocked=true;stop();}}
      return original(state,title,url);
    };
  }
  w.addEventListener('hashchange',()=>{if(w.location.hash){blocked=true;stop();}});
  w.addEventListener('message',event=>{
    if(event.origin!==FRAME_ORIGIN||event.source!==frame?.contentWindow||event.data?.channel!=='superdoc-demo-analytics-v1'||event.data.type!=='ready'||!granted)return;
    frameReady=true;post('enable');for(const payload of pending.splice(0))post('event',payload);
  });
  w.addEventListener('superdoc:demo',e=>{try{emit(e.detail?.action,e.detail?.capability,e.detail?.example||example);}catch{}});
  w.addEventListener('storage',e=>{if(e.key===KEY||e.key===null)apply(preference());});
  w.addEventListener('pageshow',e=>{if(e.persisted)apply(preference());});
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
