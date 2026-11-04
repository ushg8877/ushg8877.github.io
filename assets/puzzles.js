/* puzzle-rich:v2 — answer encryption and bounded, inert rich hints. */
(() => {
  'use strict';
  const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const rounds=new Set([3000000,6000000,12000000]);
  const fields=(v,n)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===n.length&&n.every(k=>Object.hasOwn(v,k));
  function decode(text,size,maxLength=24000) {
    if(typeof text!=='string'||text.length>maxLength||!/^[A-Za-z0-9_-]+$/.test(text))throw Error('Invalid puzzle');
    const raw=Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
    if(size!==undefined&&raw.length!==size)throw Error('Invalid puzzle');return raw;
  }
  function normalize(answer) {
    if(typeof answer!=='string'||[...answer].length>256)throw Error('Invalid answer');
    const value=answer.normalize('NFKC').replace(/[\x09-\x0d \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu,'').replace(/[A-Z]/g,c=>c.toLowerCase());
    if(!value||utf8.encode(value).length>1024)throw Error('Invalid answer');return value;
  }
  function validate(value,id) {
    const keys=['version','id','kdf','rounds','salt','iv','wrapped_code','hint'];if(value?.version===2)keys.push('html','assets');
    if(!fields(value,keys)||![1,2].includes(value.version)||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id)||(id!==undefined&&id!==value.id)||value.kdf!=='PBKDF2-SHA256'||!rounds.has(value.rounds)||typeof value.hint!=='string'||utf8.encode(value.hint).length>(value.version===2?32000:8000))throw Error('Invalid puzzle');
    if(value.version===2){validateAssets(value.assets);if(typeof value.html!=='string'||utf8.encode(value.html).length>128000)throw Error('Invalid hint');}
    decode(value.salt,16);decode(value.iv,12);decode(value.wrapped_code,48);return value;
  }
  let deriving=false;
  async function unlock(value,answer,id) {
    validate(value,id);answer=normalize(answer);
    if(deriving)throw Error('Puzzle calculation already running');deriving=true;
    try {
      const material=await crypto.subtle.importKey('raw',utf8.encode(answer),'PBKDF2',false,['deriveKey']);answer='';
      const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:value.rounds,salt:decode(value.salt,16)},material,{name:'AES-GCM',length:256},false,['decrypt']);
      const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv,12),additionalData:utf8.encode('kamome-puzzle:v1:'+value.id)},key,decode(value.wrapped_code,48)));
      try {const code=decoder.decode(raw);if(!/^[A-F0-9]{32}$/.test(code))throw Error('Invalid code');return code;} finally {raw.fill(0);}
    } finally {deriving=false;}
  }
  async function hash(text) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
  async function openPrivate(path,value) {
    if(!/^\/posts\/[a-f0-9]{48}\/$/.test(path)||!fields(value,['version','iv','ciphertext'])||value.version!==1)throw Error('Invalid private puzzle');
    const cipher=decode(value.ciphertext,undefined,400000);if(cipher.length<16||cipher.length>262160)throw Error('Invalid private puzzle');
    const raw=await crypto.subtle.digest('SHA-256',utf8.encode('kamome-private-puzzle-key:v1:'+path));
    const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
    return validate(JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(value.iv,12),additionalData:utf8.encode('kamome-private-puzzle:v1:'+path)},key,cipher))));
  }
  async function loadPrivate(path,base) {
    if(!/^\/posts\/[a-f0-9]{48}\/$/.test(path))return null;
    const id=await hash('kamome-private-puzzle-locator:v1:'+path),url=new URL('assets/puzzles/private/'+id+'.json',base);
    if(url.origin!==location.origin)throw Error('Invalid puzzle origin');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      if(response.status===404)return null;if(!response.ok)throw Error('Puzzle unavailable');
      if(Number(response.headers.get('content-length'))>400000)throw Error('Puzzle too large');
      const raw=await response.text();if(raw.length>400000)throw Error('Puzzle too large');
      return openPrivate(path,JSON.parse(raw));
    } finally {clearTimeout(timer);}
  }
  function validateAssets(items) {
    if(!Array.isArray(items)||items.length>20)throw Error('Invalid attachments');let total=0;const seen=new Set();
    for(const item of items){
      if(!fields(item,['id','kind','name','bytes','key','iv','sha256'])||typeof item.id!=='string'||!/^[a-f0-9]{32}$/.test(item.id)||seen.has(item.id)||!['image','file'].includes(item.kind)||typeof item.name!=='string'||!item.name||[...item.name].length>160||/[/\\:\p{C}]/u.test(item.name)||['.','..'].includes(item.name)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>20*1024*1024||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid attachment');
      if(item.kind==='image'&&(item.bytes<33||item.bytes>8*1024*1024))throw Error('Invalid image');
      decode(item.key,32);decode(item.iv,12);seen.add(item.id);total+=item.bytes;
    }
    if(total>32*1024*1024)throw Error('Attachments too large');return items;
  }
  async function decryptAsset(item,cipher) {
    validateAssets([item]);if(cipher.byteLength!==item.bytes+16)throw Error('Invalid attachment size');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',cipher))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==item.sha256)throw Error('Invalid attachment digest');
    const key=await crypto.subtle.importKey('raw',decode(item.key,32),'AES-GCM',false,['decrypt']);
    const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(item.iv,12),additionalData:utf8.encode('kamome-puzzle-asset:v1:'+item.id)},key,cipher));
    if(item.kind==='image'){
      if(raw.length<33||[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].some((v,i)=>raw[i]!==v))throw Error('Invalid image');
      const size=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),w=size.getUint32(16),h=size.getUint32(20);
      if(!w||!h||w>8192||h>8192||w*h>16000000)throw Error('Image too large');
    }
    return raw;
  }
  const assetBase=typeof document==='undefined'?null:new URL('./',document.currentScript.src);
  let mathLoading=null;
  async function math() {
    if(window.katex)return window.katex;
    if(!mathLoading)mathLoading=new Promise((resolve,reject)=>{
      const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('private-reader/katex/katex.min.css',assetBase);css.referrerPolicy='no-referrer';document.head.append(css);
      const script=document.createElement('script');script.src=new URL('private-reader/katex/katex.min.js',assetBase);script.referrerPolicy='no-referrer';
      const timer=setTimeout(()=>reject(Error('Math unavailable')),10000);
      script.onload=()=>{clearTimeout(timer);window.katex?resolve(window.katex):reject(Error('Math unavailable'));};script.onerror=()=>{clearTimeout(timer);reject(Error('Math unavailable'));};document.head.append(script);
    }).catch(error=>{mathLoading=null;throw error;});
    return mathLoading;
  }
  function richFragment(value) {
    const template=document.createElement('template');template.innerHTML=value.html;
    const allowed=new Set(['P','BR','HR','STRONG','EM','DEL','S','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TR','TD','TH','SUP','SUB','A','SPAN','DIV','IMG']);
    const assets=new Map(value.assets.map(a=>[a.id,a]));let count=0;
    function copy(source,target,depth=0){
      if(depth>40)throw Error('Hint nesting too deep');
      for(const node of source.childNodes){
        if(++count>12000)throw Error('Hint too complex');
        if(node.nodeType===3){target.append(document.createTextNode(node.textContent));continue;}
        if(node.nodeType!==1||!allowed.has(node.tagName))continue;
        const out=document.createElement(node.tagName.toLowerCase());
        if(['SPAN','DIV'].includes(node.tagName)&&['math-inline','math-display'].some(c=>node.classList.contains(c))&&node.hasAttribute('data-tex')){
          if(node.getAttribute('data-tex').length>8000)throw Error('Formula too large');
          out.className=node.classList.contains('math-display')?'math-display':'math-inline';out.dataset.tex=node.getAttribute('data-tex');
        }
        const asset=assets.get(node.getAttribute('data-puzzle-asset'));
        if(node.tagName==='IMG'){
          if(!asset||asset.kind!=='image')continue;out.dataset.puzzleAsset=asset.id;out.alt=node.getAttribute('alt')||'';out.referrerPolicy='no-referrer';
        }
        if(node.tagName==='A'){
          if(asset){out.dataset.puzzleAsset=asset.id;out.href='#';out.className='puzzle-download';}
          else{try{const href=node.getAttribute('href'),url=new URL(href);if(['https:','http:','mailto:'].includes(url.protocol)&&!url.username&&!url.password){out.href=url.href;out.rel='noopener noreferrer';out.referrerPolicy='no-referrer';}}catch{}}
        }
        if(node.tagName==='OL'&&/^-?\d{1,6}$/.test(node.getAttribute('start')||''))out.setAttribute('start',node.getAttribute('start'));
        if(['TD','TH'].includes(node.tagName)){const align=node.style.textAlign;if(['left','right','center'].includes(align))out.style.textAlign=align;}
        copy(node,out,depth+1);target.append(out);
      }
    }
    const result=document.createDocumentFragment();copy(template.content,result);return result;
  }
  function attach(dialog,input,status,loader) {
    const form=dialog.querySelector('form'),panel=document.createElement('section');panel.className='puzzle-hint';panel.hidden=true;
    const hint=document.createElement('div'),submit=document.createElement('button');submit.type='button';submit.textContent='验证';submit.className='puzzle-verify';submit.addEventListener('click',()=>form.requestSubmit());panel.append(hint,submit);form.after(panel);
    let revision=0,renderRevision=0,last='';const urls=new Set(),controllers=new Set();
    function dispose(){renderRevision++;for(const controller of controllers)controller.abort();controllers.clear();for(const url of urls)URL.revokeObjectURL(url);urls.clear();hint.replaceChildren();last='';}
    async function assetBytes(item){
      const url=new URL('puzzles/media/'+item.id+'.bin',assetBase);if(url.origin!==location.origin)throw Error('Invalid origin');
      const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),30000);
      try{
        const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:controller.signal});
        if(!response.ok||Number(response.headers.get('content-length'))>item.bytes+16)throw Error('Attachment unavailable');
        const reader=response.body.getReader(),chunks=[];let length=0;
        while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>item.bytes+16){await reader.cancel();throw Error('Too large');}chunks.push(value);}
        const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
        return await decryptAsset(item,bytes);
      }finally{clearTimeout(timer);controllers.delete(controller);}
    }
    function hydrate(value,token){
      const alive=()=>renderRevision===token&&dialog.open;const items=new Map(value.assets.map(a=>[a.id,a]));
      (async()=>{for(const node of hint.querySelectorAll('img[data-puzzle-asset]')){
        if(!alive())return;
        try{const bytes=await assetBytes(items.get(node.dataset.puzzleAsset));if(!alive()){bytes.fill(0);return;}const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));bytes.fill(0);urls.add(url);node.src=url;}
        catch{if(alive())node.replaceWith(document.createTextNode('图片暂时无法加载'));}
      }})();
      for(const node of hint.querySelectorAll('a[data-puzzle-asset]')){let downloading=false;node.addEventListener('click',async event=>{
        event.preventDefault();if(downloading||!alive())return;downloading=true;node.setAttribute('aria-busy','true');status.textContent='正在准备附件…';
        try{const item=items.get(node.dataset.puzzleAsset),bytes=await assetBytes(item);if(!alive()){bytes.fill(0);return;}
          const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));bytes.fill(0);urls.add(url);
          const download=document.createElement('a');download.href=url;download.download=item.name;download.hidden=true;dialog.append(download);download.click();download.remove();status.textContent='';
        }catch{if(alive())status.textContent='附件暂时无法下载，请重试。';}finally{downloading=false;node.removeAttribute('aria-busy');}
      });}
      const formulas=[...hint.querySelectorAll('[data-tex]')];
      if(formulas.length){(async()=>{try{if(formulas.length>128)throw Error('Too many formulas');const katex=await math();for(const node of formulas){if(!alive())return;katex.render(node.dataset.tex,node,{displayMode:node.classList.contains('math-display'),throwOnError:false,macros:{'\\d':'\\mathrm{d}'},trust:false,strict:'error',maxExpand:1000,maxSize:20});}}catch{if(alive())status.textContent='公式暂时无法排版。';}})();}
    }
    function set(value) {
      if(value)validate(value);
      const signature=JSON.stringify(value);
      if(signature!==last){dispose();last=signature;hint.className=value?.version===2?'puzzle-rich':'puzzle-plain';
        if(value?.version===2){hint.append(richFragment(value));hydrate(value,renderRevision);}else if(value){const p=document.createElement('p');p.textContent=value.hint;hint.append(p);}}
      panel.hidden=!value;hint.hidden=!value?.hint;
      dialog.classList.toggle('puzzle-mode',!!value);input.dataset.puzzle=String(!!value);input.type=value?'text':'password';input.maxLength=value?256:80;
      input.setAttribute('aria-label',value?'谜底':'访问码');input.placeholder=value?'输入谜底':'';input.autocapitalize=value?'off':'characters';
    }
    return {set,cancel(){revision++;dispose();panel.hidden=true;},async refresh(){const token=++revision;try{const value=await loader();if(token===revision&&dialog.open)set(value);}catch{if(token===revision&&dialog.open){status.textContent='提示暂时无法加载，请稍后重试。';}}}};
  }
  if(typeof document==='undefined'){if(typeof module!=='undefined')module.exports={validate,normalize,unlock,openPrivate,validateAssets,decryptAsset};return;}
  window.KamomePuzzle=Object.freeze({validate,unlock,loadPrivate,attach});
})();
