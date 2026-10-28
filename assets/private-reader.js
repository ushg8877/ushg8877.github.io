/* Generic private-article reader. No article URL, metadata, or key lives here. */
(() => {
  'use strict';
  const utf8 = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
  const maxBytes = 24 * 1024 * 1024;
  function normalizeCode(value) {
    const code = String(value).replace(/[\s-]/gu, '').toUpperCase();
    if (!/^[A-F0-9]{32}$/.test(code)) throw Error('Invalid code');
    return code;
  }
  function decode(value, size) {
    if (typeof value !== 'string' || value.length > maxBytes * 2 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('Invalid encoding');
    const binary = atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (size !== undefined && bytes.length !== size) throw Error('Invalid length');
    return bytes;
  }
  async function locator(code, subtle=globalThis.crypto.subtle) {
    const bytes = await subtle.digest('SHA-256', utf8.encode('kamome-private-locator:v1:' + normalizeCode(code)));
    return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  async function decrypt(envelope, code, subtle=globalThis.crypto.subtle) {
    if (!envelope || Array.isArray(envelope) || Object.keys(envelope).sort().join(',') !== 'ciphertext,iv,rounds,salt,version' || envelope.version !== 1 || envelope.rounds !== 600000) throw Error('Invalid envelope');
    code = normalizeCode(code);
    const salt = decode(envelope.salt,16), iv = decode(envelope.iv,12), ciphertext = decode(envelope.ciphertext);
    if (ciphertext.length < 16 || ciphertext.length > maxBytes+4112) throw Error('Invalid ciphertext');
    const material = await subtle.importKey('raw',utf8.encode(code),'PBKDF2',false,['deriveKey']);
    const key = await subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt},material,{name:'AES-GCM',length:256},false,['decrypt']);
    const plain = await subtle.decrypt({name:'AES-GCM',iv,additionalData:utf8.encode('kamome-private-post:v1:'+await locator(code,subtle)),tagLength:128},key,ciphertext);
    const payload = JSON.parse(decoder.decode(plain));
    if (payload?.version !== 1 || !/^\/posts\/[a-f0-9]{48}\/$/.test(payload.path || '') || !payload.languages?.zh || !Array.isArray(payload.tags)) throw Error('Invalid article');
    for (const [language, version] of Object.entries(payload.languages)) {
      if (!['zh','ja','en'].includes(language) || typeof version?.title !== 'string' || typeof version.html !== 'string') throw Error('Invalid version');
    }
    return payload;
  }
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = {normalizeCode,locator,decrypt};
    return;
  }
  const dialog = document.querySelector('#private-access-dialog');
  if (!dialog) return;
  const opener = document.querySelector('#private-access-open');
  const input = dialog.querySelector('input'), form = dialog.querySelector('form');
  const status = dialog.querySelector('[role="status"]'), verifying = dialog.querySelector('.sealed-verifying');
  const main = document.querySelector('#main'), missing = document.querySelector('#private-not-found');
  const base = new URL(dialog.dataset.base,location.href);
  if (base.origin !== location.origin || !opener || !main || !missing) return;
  let generation=0, busy=false, payload=null, controller=null, autoSubmit=null, mathLoading=null;
  let languageButtons=null, articleBody=null, titleNode=null, language='zh';
  const errorText='访问码不正确，或文章暂时无法打开。';

  function statusText(text,error=false) {
    status.textContent=text;input.setAttribute('aria-invalid',String(error));
  }
  function clearArticle() {
    if (!payload) return;
    // Detach all plaintext, images and in-flight render targets before releasing it.
    main.replaceChildren(missing.content.cloneNode(true));
    document.title='页面未找到 · Kamome\'s Blog';
    payload=null;articleBody=null;titleNode=null;languageButtons=null;
  }
  function lock() {
    generation++;controller?.abort();controller=null;clearTimeout(autoSubmit);
    document.dispatchEvent(new Event('kamome-private-lock'));
    clearArticle();busy=false;input.value='';input.disabled=false;verifying.hidden=true;
    opener.dataset.verified='false';opener.querySelector('span').textContent='验证访问码';
    statusText('');if(dialog.open)dialog.close();
  }
  opener.addEventListener('click',()=>{
    if(busy)return;
    if(payload){lock();return;}
    statusText('');dialog.showModal();input.focus();
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog)lock();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();lock();});
  dialog.addEventListener('close',()=>{input.value='';clearTimeout(autoSubmit);});
  input.addEventListener('input',()=>{
    clearTimeout(autoSubmit);statusText('');
    if(/^[A-Fa-f0-9]{32}$/.test(input.value.replace(/[\s-]/g,'')))autoSubmit=setTimeout(()=>{if(!busy&&dialog.open)form.requestSubmit();},180);
  });

  function fragment(html) {
    const template=document.createElement('template');template.innerHTML=html;
    const allowed=new Set(['P','BR','HR','STRONG','EM','DEL','S','B','I','U','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','SUP','SUB','A','SPAN','DIV','SECTION','IMG']);
    const classes=new Set(['math-inline','math-display','local-secret','local-secret-inline','local-secret-body','blog-poll']);
    function copy(source,target) {
      for(const child of source.childNodes) {
        if(child.nodeType===3){target.append(document.createTextNode(child.textContent));continue;}
        if(child.nodeType!==1||!allowed.has(child.tagName))continue;
        const clean=document.createElement(child.tagName.toLowerCase());
        for(const name of child.classList)if(classes.has(name))clean.classList.add(name);
        if(clean.classList.contains('blog-poll')&&/^[a-f0-9]{32}$/.test(child.getAttribute('data-poll-id')||'')){
          clean.dataset.pollId=child.getAttribute('data-poll-id');
          if(/^[a-f0-9]{64}$/.test(child.getAttribute('data-poll-key')||''))clean.dataset.pollKey=child.getAttribute('data-poll-key');
        }
        if(clean.classList.contains('local-secret')){clean.tabIndex=0;clean.setAttribute('aria-label','黑幕');}
        if(child.hasAttribute('data-tex')&&(clean.classList.contains('math-inline')||clean.classList.contains('math-display')))clean.dataset.tex=child.getAttribute('data-tex');
        if(child.tagName==='IMG') {
          const source=child.getAttribute('src')||'';
          if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)||source.length>12*1024*1024)continue;
          clean.src=source;clean.alt=child.getAttribute('alt')||'';clean.loading='lazy';clean.referrerPolicy='no-referrer';
        }
        if(child.tagName==='A') {
          const href=child.getAttribute('href')||'';
          try {
            const url=new URL(href,location.href);
            if(['http:','https:','mailto:'].includes(url.protocol)&&!url.username&&!url.password){clean.href=url.href;clean.rel='noopener noreferrer';clean.referrerPolicy='no-referrer';}
          }catch{}
        }
        if(child.tagName==='OL'&&/^-?\d{1,6}$/.test(child.getAttribute('start')||''))clean.setAttribute('start',child.getAttribute('start'));
        copy(child,clean);target.append(clean);
      }
    }
    const result=document.createDocumentFragment();copy(template.content,result);return result;
  }

  function loadMath() {
    if(window.katex)return Promise.resolve(window.katex);
    if(mathLoading)return mathLoading;
    mathLoading=new Promise((resolve,reject)=>{
      const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('assets/private-reader/katex/katex.min.css',base);document.head.append(style);
      const script=document.createElement('script');script.src=new URL('assets/private-reader/katex/katex.min.js',base);script.referrerPolicy='no-referrer';
      const timeout=setTimeout(()=>reject(Error('Math unavailable')),10000);
      script.onload=()=>{clearTimeout(timeout);window.katex?resolve(window.katex):reject(Error('Math unavailable'));};
      script.onerror=()=>{clearTimeout(timeout);reject(Error('Math unavailable'));};document.head.append(script);
    }).catch(error=>{mathLoading=null;throw error;});
    return mathLoading;
  }
  async function renderMath(body,token) {
    const nodes=[...body.querySelectorAll('[data-tex]')];if(!nodes.length)return;
    try {
      const math=await loadMath();
      for(let index=0;index<nodes.length;index++) {
        if(token!==generation||!body.isConnected||!payload)return;
        const node=nodes[index];
        math.render(node.dataset.tex,node,{displayMode:node.classList.contains('math-display'),throwOnError:false,trust:false,strict:'error',maxExpand:1000,maxSize:20});
        if(index%16===15)await new Promise(resolve=>setTimeout(resolve,0));
      }
    }catch { /* The original TeX remains readable if local resources fail. */ }
  }
  function showLanguage(next) {
    if(!payload?.languages[next])return;
    language=next;const version=payload.languages[next];
    titleNode.textContent=version.title;document.title=version.title+' · Kamome\'s Blog';
    articleBody.replaceChildren(fragment(version.html));articleBody.lang=next==='zh'?'zh-CN':next;
    for(const button of languageButtons.children)button.setAttribute('aria-pressed',String(button.dataset.language===next));
    renderMath(articleBody,generation);
  }
  function showArticle(value) {
    payload=value;
    const article=document.createElement('article');article.className='reading';
    const back=document.createElement('a');back.className='back';back.href=base.href;back.textContent='← 所有文章';back.rel='noreferrer';article.append(back);
    const header=document.createElement('header');header.className='post-header';
    const date=document.createElement('div');date.className='post-meta';date.textContent=String(value.date||'');header.append(date);
    titleNode=document.createElement('h1');titleNode.id='article-title';header.append(titleNode);
    languageButtons=document.createElement('div');languageButtons.className='article-languages';languageButtons.hidden=Object.keys(value.languages).length<2;
    for(const [code,label] of [['zh','中文'],['ja','日本語'],['en','English']]) {
      if(!value.languages[code])continue;
      const button=document.createElement('button');button.type='button';button.dataset.language=code;button.textContent=label;button.addEventListener('click',()=>showLanguage(code));languageButtons.append(button);
    }
    header.append(languageButtons);article.append(header);
    articleBody=document.createElement('div');articleBody.id='article-body';articleBody.className='prose';article.append(articleBody);
    main.replaceChildren(article);
    const policy=document.querySelector('meta[name="referrer"]')||document.createElement('meta');policy.name='referrer';policy.content='no-referrer';document.head.append(policy);
    showLanguage('zh');opener.dataset.verified='true';opener.querySelector('span').textContent='通过';main.focus();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();clearTimeout(autoSubmit);if(busy)return;
    const token=++generation,path=location.pathname;busy=true;input.disabled=true;verifying.hidden=false;
    statusText('正在验证并解密…');let code=input.value;input.value='';
    const abort=new AbortController();controller=abort;const timer=setTimeout(()=>abort.abort(),10000);
    try {
      code=normalizeCode(code);
      if(!/^\/posts\/[a-f0-9]{48}\/$/.test(path))throw Error('Unavailable');
      const id=await locator(code);if(token!==generation)return;
      const url=new URL('assets/private-posts/'+id+'.json',base);
      const response=await fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:abort.signal});
      if(!response.ok)throw Error('Unavailable');
      if(Number(response.headers.get('content-length'))>maxBytes*2)throw Error('Too large');
      const raw=await response.text();if(raw.length>maxBytes*2)throw Error('Too large');
      const value=await decrypt(JSON.parse(raw),code);code='';
      if(token!==generation)return;
      // Check the authenticated path before any plaintext reaches the page.
      // A code must never discover or redirect to an article from another URL.
      if(value.path!==path||location.pathname!==path)throw Error('Unavailable');
      dialog.close();showArticle(value);statusText('');
    }catch {
      if(token===generation)statusText(errorText,true);
    }finally {
      code='';clearTimeout(timer);
      if(token===generation){busy=false;input.disabled=false;verifying.hidden=true;controller=null;if(dialog.open)input.focus();}
    }
  });
  document.addEventListener('pointerup',event=>{
    if(event.pointerType==='touch'||event.pointerType==='pen')event.target.closest?.('.local-secret')?.classList.toggle('private-revealed');
  });
  window.addEventListener('pagehide',lock);
  window.addEventListener('pageshow',event=>{if(event.persisted)lock();});
  window.addEventListener('popstate',lock);
})();
