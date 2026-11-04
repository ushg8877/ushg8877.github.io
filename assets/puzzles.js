/* Answer-derived encryption. No answer hash, answer, or content key is shipped. */
(() => {
  'use strict';
  const utf8=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const rounds=new Set([3000000,6000000,12000000]);
  const fields=(v,n)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===n.length&&n.every(k=>Object.hasOwn(v,k));
  function decode(text,size) {
    if(typeof text!=='string'||text.length>24000||!/^[A-Za-z0-9_-]+$/.test(text))throw Error('Invalid puzzle');
    const raw=Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
    if(size!==undefined&&raw.length!==size)throw Error('Invalid puzzle');return raw;
  }
  function normalize(answer) {
    if(typeof answer!=='string'||[...answer].length>256)throw Error('Invalid answer');
    const value=answer.normalize('NFKC').replace(/[\x09-\x0d \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu,'').replace(/[A-Z]/g,c=>c.toLowerCase());
    if(!value||utf8.encode(value).length>1024)throw Error('Invalid answer');return value;
  }
  function validate(value,id) {
    if(!fields(value,['version','id','kdf','rounds','salt','iv','wrapped_code','hint'])||value.version!==1||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id)||(id!==undefined&&id!==value.id)||value.kdf!=='PBKDF2-SHA256'||!rounds.has(value.rounds)||typeof value.hint!=='string'||utf8.encode(value.hint).length>8000)throw Error('Invalid puzzle');
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
    const cipher=decode(value.ciphertext);if(cipher.length<16||cipher.length>14000)throw Error('Invalid private puzzle');
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
      if(Number(response.headers.get('content-length'))>24000)throw Error('Puzzle too large');
      const raw=await response.text();if(raw.length>24000)throw Error('Puzzle too large');
      return openPrivate(path,JSON.parse(raw));
    } finally {clearTimeout(timer);}
  }
  function attach(dialog,input,status,loader) {
    const form=dialog.querySelector('form'),panel=document.createElement('section');panel.className='puzzle-hint';panel.hidden=true;
    const hint=document.createElement('p'),submit=document.createElement('button');submit.type='button';submit.textContent='验证';submit.addEventListener('click',()=>form.requestSubmit());panel.append(hint,submit);form.after(panel);
    let revision=0;
    function set(value) {
      if(value)validate(value);
      panel.hidden=!value;hint.textContent=value?.hint||'';hint.hidden=!value?.hint;
      dialog.classList.toggle('puzzle-mode',!!value);input.dataset.puzzle=String(!!value);input.type=value?'text':'password';input.maxLength=value?256:80;
      input.setAttribute('aria-label',value?'谜底':'访问码');input.placeholder=value?'输入谜底':'';input.autocapitalize=value?'off':'characters';
    }
    return {set,cancel(){revision++;},async refresh(){const token=++revision;try{const value=await loader();if(token===revision&&dialog.open)set(value);}catch{if(token===revision&&dialog.open){status.textContent='提示暂时无法加载，请稍后重试。';}}}};
  }
  if(typeof document==='undefined'){if(typeof module!=='undefined')module.exports={validate,normalize,unlock,openPrivate};return;}
  window.KamomePuzzle=Object.freeze({validate,unlock,loadPrivate,attach});
})();
