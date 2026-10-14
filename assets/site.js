const theme=document.querySelector('#theme');
theme?.addEventListener('click',()=>{const value=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=value;try{localStorage.setItem('theme',value)}catch(e){}});
const input=document.querySelector('#search'),cards=[...document.querySelectorAll('.post-card')],buttons=[...document.querySelectorAll('[data-tag]')];let tag='';
function filter(){const q=(input?.value||'').trim().toLocaleLowerCase();let count=0;cards.forEach(card=>{const matches=(!tag||card.dataset.tags.split('|').includes(tag))&&(card.dataset.title+' '+card.dataset.tags).toLocaleLowerCase().includes(q);card.hidden=!matches;if(matches)count++});const empty=document.querySelector('#no-results');if(empty)empty.hidden=cards.length===0||count>0;}
input?.addEventListener('input',filter);buttons.forEach(button=>button.addEventListener('click',()=>{tag=button.dataset.tag;buttons.forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});filter()}));

// Add more approved quotations and background paths to these two lists.
const quotes=['本当の明日の空まで 続いていくから Shiny Days'];
const backgrounds=['/assets/backgrounds/summer-sky.jpg','/assets/backgrounds/river-evening.jpg'];
const quote=document.querySelector('#hero-quote');
if(quote){
  quote.textContent=quotes[Math.floor(Math.random()*quotes.length)];
  let previous='';try{previous=sessionStorage.getItem('last-background')||''}catch(e){}
  const choices=backgrounds.filter(path=>path!==previous);
  const selected=choices[Math.floor(Math.random()*choices.length)];
  const picture=new Image();picture.onload=()=>{document.body.style.setProperty('--scene',`url("${selected}")`);document.body.classList.add('scene-ready');try{sessionStorage.setItem('last-background',selected)}catch(e){}};
  picture.src=selected;
}
