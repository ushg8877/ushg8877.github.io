/* GitHub session and private poll capabilities live only in this page's memory. */
(() => {
  'use strict';
  const service='https://kamome-blog-voting.snowytulip34.chatgpt.site';
  let token='',login='',pending=null,generation=0;
  const mounted=new WeakSet(),cards=new Set();
  const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
  function button(text,action){const node=element('button',text);node.type='button';node.addEventListener('click',action);return node;}
  function reset(){
    generation++;token='';login='';
    if(pending){pending.popup?.close();pending.reject(Error('登录已取消。'));pending=null;}
    for(const card of cards)card.abort?.abort();cards.clear();
  }
  async function auth(){
    if(pending)throw Error('请先完成已打开的 GitHub 登录。');
    const nonce=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
    // Opening a blank window first keeps the private article URL out of Referer.
    const popup=window.open('about:blank','kamome-github-login','width=680,height=760');
    if(!popup)throw Error('浏览器阻止了登录窗口，请允许弹窗后重试。');
    const meta=popup.document.createElement('meta');meta.name='referrer';meta.content='no-referrer';popup.document.head.append(meta);
    const anchor=popup.document.createElement('a');anchor.href=service+'/auth/github/start?nonce='+nonce;anchor.referrerPolicy='no-referrer';popup.document.body.append(anchor);
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>finish(Error('登录超时，请重试。')),600000);
      const watch=setInterval(()=>{if(popup.closed)setTimeout(()=>{if(pending?.nonce===nonce)finish(Error('登录窗口已关闭。'));},500);},500);
      function finish(error){clearTimeout(timeout);clearInterval(watch);if(pending?.nonce===nonce)pending=null;error?reject(error):resolve();}
      pending={nonce,popup,reject:error=>{popup.close();finish(error);},resolve:()=>finish()};anchor.click();
    });
  }
  window.addEventListener('message',event=>{
    const data=event.data;
    if(!pending||event.origin!==service||event.source!==pending.popup||!data||data.type!=='kamome-poll-auth'||data.nonce!==pending.nonce)return;
    if(data.error){pending.reject(Error('GitHub 登录未完成，请重试。'));return;}
    if(!/^[a-f0-9]{64}$/.test(data.token)||typeof data.login!=='string')return;
    token=data.token;login=data.login;pending.resolve();
    for(const card of cards)if(card.root.isConnected)card.reload();
  });
  function mount(root){
    if(mounted.has(root))return;mounted.add(root);
    const id=root.dataset.pollId,key=root.dataset.pollKey||'';
    if(!/^[a-f0-9]{32}$/.test(id)||key&&!/^[a-f0-9]{64}$/.test(key))return;
    const card={root,abort:null,reload};cards.add(card);
    let poll=null,busy=false,sequence=0;
    const status=element('p','','poll-status');status.setAttribute('role','status');
    async function api(suffix='',method='GET',body){
      const headers={};if(token)headers.Authorization='Bearer '+token;if(key)headers['X-Poll-Key']=key;
      if(body)headers['Content-Type']='application/json';
      card.abort=new AbortController();const timer=setTimeout(()=>card.abort.abort(),20000);
      try{
        const response=await fetch(service+'/api/polls/'+id+suffix,{method,headers,body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:card.abort.signal});
        let result;try{result=await response.json();}catch{throw Error('投票服务暂时不可用，请稍后重试。');}
        if(!response.ok){const error=Error(result.error||'暂时无法完成操作。');error.status=response.status;throw error;}
        return result;
      }finally{clearTimeout(timer);}
    }
    function message(error){status.textContent=error.name==='AbortError'?'请求超时，请重试。':error.message;status.classList.add('poll-error');if(!status.isConnected)root.append(status);}
    async function reload(){
      if(busy)return;
      const current=++sequence,epoch=generation;busy=true;
      try{
        const value=await api();if(!root.isConnected||current!==sequence||epoch!==generation)return;
        poll=value;render();if(poll.submitted)await results(epoch,current);
      }catch(error){if(root.isConnected&&epoch===generation){root.replaceChildren(status,button('重试',reload));message(error);}}
      finally{busy=false;}
    }
    function render(){
      status.textContent='';status.classList.remove('poll-error');
      const heading=element('h3',poll.definition.title);
      root.replaceChildren(heading);
      if(poll.submitted){root.append(element('p','已提交 · '+(poll.user?.login||login),'poll-submitted'),status);return;}
      const form=element('form');
      for(const [index,q] of poll.definition.questions.entries()){
        const field=element('fieldset');field.append(element('legend',(index+1)+'. '+q.title+'（'+(q.multiple?'多选':'单选')+'）'));
        for(const option of q.options){const label=element('label','','poll-option'),input=document.createElement('input');input.type=q.multiple?'checkbox':'radio';input.name=q.id;input.value=option.id;input.disabled=!!poll.closed;label.append(input,element('span',option.label));field.append(label);}
        form.append(field);
      }
      const actions=element('div','','poll-actions'),submit=element('button','提交投票');submit.type='submit';
      const signIn=button(poll.user?'更换 GitHub 账号':'使用 GitHub 登录',async()=>{try{status.textContent='请在新窗口完成 GitHub 登录…';await auth();}catch(error){message(error);}});
      if(poll.closed){actions.append(element('p','投票已结束'));submit.disabled=true;}
      if(poll.user)actions.append(element('span','GitHub · '+poll.user.login),submit);
      actions.append(signIn);form.append(actions,status);root.append(form);
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(busy||poll.closed)return;
        const answers={};
        for(const q of poll.definition.questions){answers[q.id]=[...form.elements].filter(x=>x.name===q.id&&x.checked).map(x=>x.value);if(!answers[q.id].length){message(Error('请回答所有问题后再提交。'));return;}}
        if(!confirm('提交投票？'))return;
        busy=true;submit.disabled=true;signIn.disabled=true;status.textContent='正在提交…';const epoch=generation;
        try{
          await api('/vote','POST',{version:poll.version,answers});
          if(epoch!==generation||!root.isConnected)return;
          poll.submitted=true;render();await results(epoch,sequence);
        }catch(error){
          if(epoch===generation&&root.isConnected){
            if(error.status===409){busy=false;await reload();}else{message(error);submit.disabled=false;signIn.disabled=false;}
          }
        }finally{busy=false;}
      });
    }
    async function results(epoch,current){
      try{
        const value=await api('/results');if(epoch!==generation||current!==sequence||!root.isConnected)return;
        status.textContent='共 '+value.total+' 人参与。';status.classList.remove('poll-error');
        root.querySelector('.poll-results')?.remove();
        const body=element('div','','poll-results');
        for(const [index,q] of poll.definition.questions.entries()){
          body.append(element('h4',(index+1)+'. '+q.title+(q.multiple?'（多选）':'')));
          for(const option of q.options){
            const count=value.counts.find(x=>x.question===q.id&&x.option===option.id)?.votes||0,percentage=value.total?Math.round(1000*count/value.total)/10:0;
            const item=element('div','','poll-result'),row=element('div','','poll-result-label');row.append(element('span',option.label),element('span',count+' 票 · '+percentage+'%'));
            const meter=element('progress');meter.max=value.total||1;meter.value=count;meter.setAttribute('aria-label',option.label+'：'+count+' 票');item.append(row,meter);body.append(item);
          }
        }
        body.append(button('刷新结果',()=>results(generation,sequence)));root.append(body);
      }catch(error){if(root.isConnected&&epoch===generation){message(error);root.querySelector('.poll-result-retry')?.remove();const retry=button('重新加载结果',()=>results(generation,sequence));retry.className='poll-result-retry';root.append(retry);}}
    }
    reload();
  }
  function scan(){
    for(const card of cards)if(!card.root.isConnected){card.abort?.abort();cards.delete(card);}
    // Kramdown fallback for articles edited outside the local manager.
    for(const code of document.querySelectorAll('pre > code.language-poll, .language-poll > .highlight > pre > code')){
      const ref=code.textContent.trim().match(/^([a-f0-9]{32})(?::([a-f0-9]{64}))?$/);if(!ref)continue;
      const root=element('section','','blog-poll');root.dataset.pollId=ref[1];if(ref[2])root.dataset.pollKey=ref[2];code.closest('pre').replaceWith(root);
    }
    document.querySelectorAll('.blog-poll[data-poll-id]').forEach(mount);
  }
  let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;scan();});}).observe(document.querySelector('#main')||document.body,{childList:true,subtree:true});
  document.addEventListener('kamome-private-lock',reset);window.addEventListener('pagehide',reset);
  window.addEventListener('pageshow',event=>{if(event.persisted){reset();location.reload();}});
  scan();
})();
