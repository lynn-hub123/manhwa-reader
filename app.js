'use strict';

let bookshelf=[],currentSeries=null,chapters=[],currentChIdx=-1,currentPage=1;
let pdfDoc=null,renderTasks=[],zoom=1.5,fitWidth=!1;
let renderedPages=new Set,scrollTimer=null;
let prefetchQueue=[],prefetching=!1;
let chapterLoadToken=0,hasFolderPicker=!1;
let _pendingFiles=null,_pendingFilesMode='drop';
let covers={};
let settings={zoom:'1.5',direction:'scroll',dualPage:!1,sidebarOpen:!0,theme:'night',webtoonAuto:!0};
let searchQuery='',sortMode='recent';
let isWebtoon=!1,webtoonScrollPct=0;let rackPage=0;

function $(id){return document.getElementById(id)}
function Qs(sel,el){return el?el.querySelector(sel):document.querySelector(sel)}

async function initApp(){
  if(typeof indexedDB==='undefined'){$('bookshelf').style.display='none';$('browser-warning').classList.add('show');return}
  $('browser-warning').style.display='none';
  hasFolderPicker=typeof window.showDirectoryPicker==='function';
  if(hasFolderPicker){try{$('bs-add-folder').style.display='';$('bs-add-btn').style.display='none';$('btn-add-folder-reader').style.display=''}catch(e){}let h=$('drag-hint');if(h){h.className='';h.textContent='💡 也可以将 PDF 文件或文件夹拖入窗口'}}
  else{try{$('bs-add-folder').style.display='none';$('bs-add-btn').style.display='none';$('btn-add-folder-reader').style.display='none'}catch(e){}let h=$('drag-hint');if(h){h.className='prominent';h.textContent='💡 点击「选择文件」或直接将 PDF / 文件夹拖入此窗口'}}
  try{const s=await db.getSettings();if(Object.keys(s).length>0)Object.assign(settings,s)}catch(e){}
  fitWidth=settings.zoom==='fit';if(!fitWidth)zoom=parseFloat(settings.zoom)||1;
  $('zoom-select').value=settings.zoom;
  if(settings.sidebarOpen===!1)$('sidebar').classList.add('hidden');
  // Apply theme
  try{document.documentElement.setAttribute('data-theme',settings.theme||'night')}catch(e){}
  // Migrate
  const raw=localStorage.getItem('manhwa-bookshelf');if(raw){try{await db.migrateFromLocalStorage();showToast('已迁移旧数据')}catch(e){}}
  const oldP=localStorage.getItem('manhwa-reader-progress');if(oldP)localStorage.removeItem('manhwa-reader-progress');
  bookshelf=(await db.loadBookshelf()).map(s=>db.normalizeSeries(s));
  try{const ac=await db.loadAllCovers();covers={};ac.forEach(c=>{covers[c.seriesId]=c.dataUrl})}catch(e){}
  console.log('Loaded '+bookshelf.length+' series, theme='+settings.theme+', webtoonAuto='+settings.webtoonAuto);
  renderBookshelf();
}


function spineColor(name){
  let hash=0;
  for(let i=0;i<name.length;i++){hash=name.charCodeAt(i)+((hash<<5)-hash);hash=hash&hash}
  const hue=Math.abs(hash%360);
  return 'hsl('+hue+',42%,42%)';
}

function renderBookshelf(){
  const grid=$('bs-grid'),total=$('bs-total');total.textContent=bookshelf.length+' 部';
  if(!bookshelf.length){grid.innerHTML='<div class="bs-empty"><div class="empty-icon"></div><h2>书架空空</h2><p>选择 PDF 文件或文件夹开始导入</p></div>';$('rack-pager').style.display='none';return}
  let sorted=[...bookshelf];
  if(sortMode==='name')sorted.sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh'));
  else if(sortMode==='created')sorted.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  else sorted.sort((a,b)=>(b.lastChNum||0)-(a.lastChNum||0));
  if(searchQuery)sorted=sorted.filter(s=>s.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const PAGE_SIZE=12;
  const pageCount=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE));
  if(rackPage>=pageCount)rackPage=pageCount-1;
  const pageBooks=sorted.slice(rackPage*PAGE_SIZE,rackPage*PAGE_SIZE+PAGE_SIZE);
  grid.dataset.count=pageBooks.length;
  applyRackSizing(pageBooks.length);
  let html='';
  pageBooks.forEach((s,i)=>{
    const chCount=s.chapters.length,readCnt=s.chapters.filter(c=>c.status==='read').length;
    let pct=0;
    if(s.lastChNum&&chCount>0){let ci=s.chapters.findIndex(c=>c.chapterNum===s.lastChNum);pct=ci>=0?Math.round((ci+1)/chCount*100):0}
    const coverHTML=covers[s.seriesId]?'<img src="'+covers[s.seriesId]+'" alt="">':'<div class="cover-fallback">'+s.name.charAt(0)+'</div>';
    const sel=currentSeries===s.seriesId?' selected':'';
    const bg=spineColor(s.name||s.seriesId);
    html+='<div class="rack-book'+sel+'" data-id="'+s.seriesId+'" data-idx="'+i+'" style="--spine-bg:'+bg+'"><div class="rack-spine"><span class="rack-spine-title">'+s.name+'</span><div class="rack-progress"><div class="rack-progress-fill" style="width:'+pct+'%"></div></div></div><div class="rack-cover-pull">'+coverHTML+'</div><button class="rack-menu-btn" data-menu-sid="'+s.seriesId+'" title="菜单">⋯</button><button class="change-cover-btn" data-cover-sid="'+s.seriesId+'">换封面</button></div>'
  });
  html+='<div class="rack-add" id="bs-add-card"><div class="add-icon">＋</div><div class="add-label">添加</div></div>';
  grid.innerHTML=html;
  grid.querySelectorAll('.rack-book[data-id]').forEach(card=>{card.addEventListener('click',function(e){if(e.target.closest('.change-cover-btn')||e.target.closest('.rack-menu-btn'))return;openSeries(this.dataset.id)})});
  grid.querySelectorAll('.change-cover-btn').forEach(btn=>{btn.addEventListener('click',function(e){e.stopPropagation();showModal('cover-pick',{sid:this.dataset.coverSid})})});
  grid.querySelectorAll('.rack-menu-btn').forEach(btn=>{btn.addEventListener('click',function(e){e.stopPropagation();showModal('rack-menu',{sid:this.dataset.menuSid})})});
  let addCard=grid.querySelector('#bs-add-card');if(addCard)addCard.addEventListener('click',()=>showAddModal());
  const pager=$('rack-pager');
  if(pager){if(pageCount<=1){pager.style.display='none';pager.innerHTML=''}else{pager.style.display='flex';pager.innerHTML='<button id="rack-prev">‹</button><span>'+(rackPage+1)+' / '+pageCount+'</span><button id="rack-next">›</button>';const pv=Qs('#rack-prev',pager),nx=Qs('#rack-next',pager);if(pv)pv.onclick=()=>{if(rackPage>0){rackPage--;renderBookshelf()}};if(nx)nx.onclick=()=>{if(rackPage<pageCount-1){rackPage++;renderBookshelf()}}}}
}
function findSeries(id){return bookshelf.find(s=>s.seriesId===id)}
async function saveSeriesBg(s){try{await db.saveSeries(s)}catch(e){console.error('saveSeries failed',e)}}


function applyRackSizing(n){
  const grid=$('bs-grid');if(!grid||!n)return;
  const availW=Math.max(320,grid.clientWidth-80);
  const addW=Math.max(90,Math.min(130,Math.round(availW*0.09)));
  const gap=n>=8?3:n>=5?4:6;
  const spineW=Math.max(40,Math.min(64,Math.round((availW-addW-gap*(n))/n)));
  const coverW=Math.round(spineW*3.2);
  grid.style.setProperty('--rack-spine-w',spineW+'px');
  grid.style.setProperty('--rack-cover-w',coverW+'px');
  grid.style.setProperty('--rack-spine-gap',gap+'px');
  grid.style.setProperty('--rack-add-w',addW+'px');
}
function showCoverSelectDuringImport(sid,files,chapterNum){
  // Default text cover already applied in createSeries. Show lightweight choice: upload or finish.
  showModal('cover-select',{sid:sid});
}
function makeTextCover(name){
  try{
    const W=600,H=840;
    const cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const ctx=cv.getContext('2d');
    const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#7FA08A';
    // soft gradient
    const g=ctx.createLinearGradient(0,0,W,H);
    g.addColorStop(0,accent);g.addColorStop(0.45,'#f4efe8');g.addColorStop(1,accent);
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    // subtle paper grain
    ctx.globalAlpha=.04;ctx.fillStyle='#fff';
    for(let i=0;i<120;i++){ctx.fillRect(Math.random()*W,Math.random()*H,2,2)}
    ctx.globalAlpha=1;
    // frame line
    ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=4;
    ctx.strokeRect(28,28,W-56,H-56);
    // decorative seal
    ctx.globalAlpha=.25;ctx.strokeStyle='#fff';ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(W*.5,H*.3,110,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.arc(W*.5,H*.3,86,0,Math.PI*2);ctx.stroke();
    ctx.globalAlpha=1;
    // title
    const chars=String(name||'未命名').replace(/\s+/g,'').slice(0,8);
    const twoCols=chars.length>4;
    const colLen=twoCols?Math.ceil(chars.length/2):chars.length;
    const colH=H*.5;
    const spacing=Math.min(132,Math.floor(colH/colLen));
    const fontSize=Math.max(118,Math.min(205,Math.round(spacing*1.55)));
    const colGap=Math.max(120,Math.round(fontSize*.85));
    const leftX=W/2-(twoCols?colGap/2:0);
    const rightX=W/2+(twoCols?colGap/2:0);
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=18;ctx.shadowOffsetY=6;
    ctx.strokeStyle='rgba(0,0,0,.4)';ctx.lineWidth=5;
    ctx.fillStyle='#fff';
    ctx.font='bold '+fontSize+'px "Ma Shan Zheng","Zhi Mang Xing","STXingkai","KaiTi","STKaiti","Microsoft YaHei",serif';
    function drawCol(colChars,x,off){const sy=H*.34-(colChars.length-1)*spacing/2+off;colChars.forEach((ch,i)=>{const y=sy+i*spacing;const rot=(Math.random()*0.05-0.025)+((i%2===0)?-0.02:0.02);ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.strokeText(ch,0,0);ctx.fillText(ch,0,0);ctx.restore()})}
    drawCol(chars.slice(0,colLen),leftX,0);
    if(twoCols)drawCol(chars.slice(colLen),rightX,spacing*0.06);
    ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    // small subtitle
    ctx.font='26px "Microsoft YaHei",sans-serif';ctx.fillStyle='rgba(255,255,255,.9)';
    ctx.fillText('· MANHWA ·',W/2,H*.82);
    return cv.toDataURL('image/jpeg',0.92);
  }catch(e){console.warn('text cover fail',e);return null}
}
function captureCurrentPageAsCover(){
  try{
    const cv=Qs('#page-container .page-wrapper canvas');
    if(!cv)return null;
    const out=document.createElement('canvas');out.width=cv.width;out.height=cv.height;
    out.getContext('2d').drawImage(cv,0,0);
    return out.toDataURL('image/jpeg',0.92);
  }catch(e){return null}
}
function startCoverCapture(sid){
  try{
    closeModal();
    const ov=document.createElement('div');ov.className='capture-overlay';
    const rect=document.createElement('div');rect.className='capture-rect';ov.appendChild(rect);
    const tip=document.createElement('div');tip.className='capture-tip';tip.textContent='拖拽选择封面区域';
    document.body.appendChild(ov);document.body.appendChild(tip);
    let sx=0,sy=0,drawing=false;
    const onMove=(e)=>{if(!drawing)return;const x=e.clientX,y=e.clientY;const x0=Math.min(sx,x),y0=Math.min(sy,y),w=Math.abs(x-sx),h=Math.abs(y-sy);Object.assign(rect.style,{left:x0+'px',top:y0+'px',width:w+'px',height:h+'px'})};
    const onUp=(e)=>{if(!drawing)return;drawing=false;const x=e.clientX,y=e.clientY;const x0=Math.min(sx,x),y0=Math.min(sy,y),w=Math.abs(x-sx),h=Math.abs(y-sy);document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);ov.remove();tip.remove();if(w<12||h<12){showToast('选择区域太小');return}const va=$('viewer-area');if(!va){showToast('阅读区不可用');return}const centerX=x0+w/2,centerY=y0+h/2;let best=null,bestArea=0;va.querySelectorAll('.page-wrapper canvas').forEach(cv=>{const r=cv.getBoundingClientRect();const ix=Math.max(r.left,x0),iy=Math.max(r.top,y0),ix2=Math.min(r.right,x0+w),iy2=Math.min(r.bottom,y0+h);const area=Math.max(0,ix2-ix)*Math.max(0,iy2-iy);if(area>bestArea){bestArea=area;best={cv,r,area}}});if(!best){showToast('未找到画面区域');return}const scaleX=best.cv.width/best.r.width,scaleY=best.cv.height/best.r.height;const cropX=Math.max(0,(x0-best.r.left)*scaleX),cropY=Math.max(0,(y0-best.r.top)*scaleY),cropW=Math.min(best.cv.width-cropX,w*scaleX),cropH=Math.min(best.cv.height-cropY,h*scaleY);if(cropW<6||cropH<6){showToast('选择区域太小');return}const out=document.createElement('canvas');out.width=Math.round(cropW);out.height=Math.round(cropH);out.getContext('2d').drawImage(best.cv,cropX,cropY,cropW,cropH,0,0,cropW,cropH);setSeriesCover(sid,out.toDataURL('image/jpeg',.92))};
    ov.addEventListener('mousedown',function(e){drawing=true;sx=e.clientX;sy=e.clientY;Object.assign(rect.style,{left:sx+'px',top:sy+'px',width:'0px',height:'0px'});document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);e.preventDefault()});
  }catch(e){console.warn('capture fail',e);showToast('截图失败')}
}
async function pickImageCover(sid){
  return new Promise(resolve=>{
    const inp=$('hidden-cover-input'),ni=inp.cloneNode(!0);
    inp.parentNode.replaceChild(ni,inp);ni.id='hidden-cover-input';
    ni.onchange=async function(){
      const f=ni.files&&ni.files[0];
      if(!f){resolve(null);return}
      try{
        const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f)});
        resolve(dataUrl);
      }catch(e){resolve(null)}
    };
    ni.oncancel=()=>resolve(null);
    ni.click();
  });
}
async function setSeriesCover(sid,dataUrl){
  try{
    if(!dataUrl)return;
    await db.saveCover(sid,dataUrl);covers[sid]=dataUrl;
    if(!currentSeries)renderBookshelf();
    showToast('封面已设置');
  }catch(e){showToast('设置失败')}
}
function showAddModal(){showModal('add-choose')}
function showModal(type,data){
  const ov=$('modal-overlay'),mc=$('modal-content');let title='',body='',actions='';
  if(type==='add-choose'){
    title='添加漫画';
    let radioHTML='<div class="radio-row"><label><input type="radio" name="addType" value="new" checked> 创建新系列</label>';
    if(bookshelf.length>0)radioHTML+='<label><input type="radio" name="addType" value="existing"> 追加到已有系列</label>';
    radioHTML+='</div>';
    let selectHTML='';
    if(bookshelf.length>0)selectHTML='<div id="existing-select-wrap" style="display:none;margin-top:8px"><label style="display:block;font-size:13px;color:var(--text2);margin-bottom:4px">选择系列</label><select id="modal-existing-select">'+bookshelf.map(s=>'<option value="'+s.seriesId+'">'+s.name+'</option>').join('')+'</select></div>';
    let stagedHTML='';
    if(_pendingFiles&&_pendingFiles.length)stagedHTML='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text2)">已拖入 <b>'+_pendingFiles.length+'</b> 个 PDF 文件</div>';
    else stagedHTML='<p style="font-size:12px;color:var(--text3)">尚未选择文件。</p>';
    body='<p>选择 PDF 文件或文件夹，内容将缓存到本地数据库。</p>'+stagedHTML+radioHTML+selectHTML;
    actions='<button id="modal-cancel">取消</button><button class="accent" id="modal-confirm">确定</button>';
    setTimeout(()=>{const radios=mc.querySelectorAll('input[name="addType"]');const wrap=Qs('#existing-select-wrap',mc);if(wrap)radios.forEach(r=>r.addEventListener('change',()=>{wrap.style.display=(r.checked&&r.value==='existing')?'block':'none'}))},80)
  }else if(type==='add-name'){title='新系列名称';body='<p>给这部漫画起个名字吧：</p><input type="text" id="modal-name" placeholder="例如：剑尊归来" autofocus>';actions='<button id="modal-cancel">取消</button><button class="accent" id="modal-confirm">确认创建</button>'}
  else if(type==='delete-confirm'){title='删除系列';body='<p>确定要删除「<b>'+data.name+'</b>」吗？<br><span style="color:var(--text3)">可选择是否同时清除缓存文件。</span></p><div class="radio-row"><label><input type="checkbox" id="modal-delete-cache" checked> 同时清除缓存的 PDF 文件</label></div>';actions='<button id="modal-cancel">取消</button><button class="danger" id="modal-confirm">确认删除</button>'}
  else if(type==='cache-mgr'){title='💾 缓存管理';let listHTML='<p style="font-size:12px;color:var(--text3)">各系列已缓存的 PDF 占用空间：</p><div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">';if(Object.keys(data.stats).length===0)listHTML+='<p style="color:var(--text3);text-align:center">暂无缓存</p>';else{for(const[sid,st]of Object.entries(data.stats)){let s=findSeries(sid),name=s?s.name:sid,sz=st.size>1048576?(st.size/1048576).toFixed(1)+' MB':(st.size/1024).toFixed(0)+' KB';listHTML+='<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface2);border-radius:6px"><span>'+name+' <span style="color:var(--text3);font-size:11px">'+st.count+'章</span></span><span style="display:flex;align-items:center;gap:10px"><span style="color:var(--text2);font-size:12px">'+sz+'</span><button class="cache-clear-btn" data-sid="'+sid+'" style="font-size:11px;padding:4px 10px">清除</button></span></div>'}}if(data.storageInfo){let si=data.storageInfo,u=si.usage>1048576?(si.usage/1048576).toFixed(1)+' MB':(si.usage/1024).toFixed(0)+' KB',q=si.quota>1073741824?(si.quota/1073741824).toFixed(1)+' GB':(si.quota/1048576).toFixed(0)+' MB';listHTML+='<p style="font-size:11px;color:var(--text3);margin-top:8px">总计已用 '+u+' / 可用 '+q+'（'+si.pct+'%）</p>'}listHTML+='</div>';body=listHTML;actions='<button id="modal-cancel">关闭</button>'}
  else if(type==='settings'){
    let untHtml=settings.webtoonAuto?' selected':'',umHtml=settings.webtoonAuto?'':' selected';
    title='⚙️ 阅读设置';
    body='<div class="settings-form"><label>默认缩放<select id="setting-zoom"><option value="fit" '+(settings.zoom==='fit'?'selected':'')+'>适应宽度</option><option value="0.75" '+(settings.zoom==='0.75'?'selected':'')+'>75%</option><option value="1" '+(settings.zoom==='1'?'selected':'')+'>100%</option><option value="1.25" '+(settings.zoom==='1.25'?'selected':'')+'>125%</option><option value="1.5" '+(settings.zoom==='1.5'?'selected':'')+'>150%</option></select></label><label>翻页方向<select id="setting-direction"><option value="scroll" '+(settings.direction==='scroll'?'selected':'')+'>上下滚动</option><option value="flip" '+(settings.direction==='flip'?'selected':'')+'>左右翻页</option></select></label><label>双页模式<select id="setting-dual"><option value="0" '+(!settings.dualPage?'selected':'')+'>单页</option><option value="1" '+(settings.dualPage?'selected':'')+'>双页（暂未实现）</option></select></label><label>侧边栏默认展开<select id="setting-sidebar"><option value="1" '+((settings.sidebarOpen!==!1)?'selected':'')+'>展开</option><option value="0" '+((settings.sidebarOpen===!1)?'selected':'')+'>收起</option></select></label><label>主题<select id="setting-theme"><option value="night" '+(settings.theme==='night'?'selected':'')+'>🌙 夜书店</option><option value="day" '+(settings.theme==='day'?'selected':'')+'>☀️ 日书店</option></select></label><label>条漫自动识别<select id="setting-webtoon"><option value="1"'+untHtml+'>开启</option><option value="0"'+umHtml+'>关闭（普通分页）</option></select></label></div>';
    actions='<button id="modal-cancel">关闭</button><button class="accent" id="modal-save-settings">保存</button>'
  }
    else if(type==='cover-pick'){title='🖼 更换封面';body='<p>选择一张作为封面：</p><div class="cover-pick-grid" id="cover-pick-grid"><p style="color:var(--text3);font-size:12px">正在加载缩略图…</p></div>';actions='<button id="cover-make-text">文字封面</button><button id="cover-upload">上传</button><button id="modal-reset-cover">恢复默认</button><button id="modal-cancel">取消</button>';
    setTimeout(async function(){const grid=Qs('#cover-pick-grid',mc);if(!grid)return;try{const cands=await loadCoverCandidates(data.sid);if(!cands.length){grid.innerHTML='<p style="color:var(--text3);font-size:12px">无法加载缩略图</p>';return}grid.innerHTML=cands.map(c=>'<div class="cover-opt" data-url="'+c.dataUrl+'"><img src="'+c.dataUrl+'"><span>第'+c.page+'页</span></div>').join('');grid.querySelectorAll('.cover-opt').forEach(el=>el.addEventListener('click',async function(){const url=this.dataset.url;try{await db.saveCover(data.sid,url);covers[data.sid]=url;showToast('封面已更新');renderBookshelf()}catch(e){showToast('设置失败')}}))}catch(e){grid.innerHTML='<p style="color:var(--text3);font-size:12px">加载失败</p>'}},120)}
  else if(type==='cover-select'){title='封面';const s=findSeries(data&&data.sid);const preview=covers[data&&data.sid]||(s?makeTextCover(s.name):null);body='<p>默认已生成文字封面，也可上传图片。</p><div style="text-align:center;margin:10px 0">'+(preview?'<img src="'+preview+'" style="width:150px;height:210px;object-fit:cover;border-radius:8px;box-shadow:var(--shadow)">':'<span style="color:var(--text3)">无预览</span>')+'</div>';actions='<button id="cover-sel-upload">上传图片</button><button id="modal-skip-cover">完成</button>';
    setTimeout(()=>{const uBtn=Qs('#cover-sel-upload',mc);if(uBtn)uBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}}},80)}
else if(type==='rack-menu'){title='操作';body='<div style="display:flex;flex-direction:column;gap:8px;margin:8px 0"><button id="rack-menu-cover" style="text-align:left">换封面</button><button id="rack-menu-delete" class="danger" style="text-align:left">删除</button></div>';actions='<button id="modal-cancel">取消</button>';
    setTimeout(()=>{const coverBtn=Qs('#rack-menu-cover',mc),delBtn=Qs('#rack-menu-delete',mc);if(coverBtn)coverBtn.onclick=function(){closeModal();showModal('cover-pick',{sid:data.sid})};if(delBtn)delBtn.onclick=function(){let s=findSeries(data.sid);closeModal();if(s)showModal('delete-confirm',{id:data.sid,name:s.name})}},80)}
  else if(type==='set-cover'){title='设封面';body='<p>选择一种方式设置封面：</p><div style="display:flex;flex-direction:column;gap:8px;margin:8px 0"><button id="set-cover-capture">当前画面截图</button><button id="set-cover-upload">上传本地图片</button><button id="set-cover-text">生成文字封面</button><button id="set-cover-cands">从候选页选择</button></div>';actions='<button id="modal-cancel">取消</button>';
    setTimeout(()=>{const cBtn=Qs('#set-cover-capture',mc),uBtn=Qs('#set-cover-upload',mc),tBtn=Qs('#set-cover-text',mc),cdBtn=Qs('#set-cover-cands',mc);if(cBtn)cBtn.onclick=function(){startCoverCapture(data.sid)};if(uBtn)uBtn.onclick=async function(){closeModal();const d=await pickImageCover(data.sid);if(d)setSeriesCover(data.sid,d)};if(tBtn)tBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');closeModal();if(d)setSeriesCover(data.sid,d)};if(cdBtn)cdBtn.onclick=function(){closeModal();showModal('cover-pick',{sid:data.sid})}},80)}
mc.innerHTML='<h3>'+title+'</h3>'+body+'<div class="modal-actions">'+actions+'</div>';ov.classList.add('show');
  const cancelBtn=Qs('#modal-cancel',mc),confirmBtn=Qs('#modal-confirm',mc);
  function closeModal(){ov.classList.remove('show');if(cancelBtn)cancelBtn.onclick=null;if(confirmBtn)confirmBtn.onclick=null}
  if(cancelBtn)cancelBtn.onclick=closeModal;const resetCoverBtn=Qs('#modal-reset-cover',mc);if(resetCoverBtn)resetCoverBtn.onclick=async function(){closeModal();showToast('正在重新生成封面…');await autoPickCover(data.sid,null,null);showToast('封面已恢复默认')};const makeTextBtn=Qs('#cover-make-text',mc);if(makeTextBtn)makeTextBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');if(d){setSeriesCover(data.sid,d);closeModal();}};const uploadCoverBtn=Qs('#cover-upload',mc);if(uploadCoverBtn)uploadCoverBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}};const skipCoverBtn=Qs('#modal-skip-cover',mc);if(skipCoverBtn)skipCoverBtn.onclick=function(){closeModal();showToast('使用默认封面');autoPickCover(data.sid,null,null)};const selTextBtn=Qs('#cover-sel-text',mc);if(selTextBtn)selTextBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');if(d){setSeriesCover(data.sid,d);closeModal();}};const selUploadBtn=Qs('#cover-sel-upload',mc);if(selUploadBtn)selUploadBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}};
  function onOverlayClick(e){if(e.target===ov){closeModal();ov.removeEventListener('click',onOverlayClick)}}ov.addEventListener('click',onOverlayClick);
  if(type==='add-choose'){if(!confirmBtn)return;confirmBtn.onclick=async function(){let r=Qs('input[name="addType"]:checked',mc),isNew=!r||r.value==='new';closeModal();try{let files;if(_pendingFiles&&_pendingFiles.length){files=_pendingFiles;_pendingFiles=null}else{if(hasFolderPicker&&_pendingFilesMode!=='input')files=await pickFolder();else files=await pickFilesViaInput()}if(!files||!files.length)return;if(isNew){_pendingFiles=files;_pendingFilesMode='drop';showModal('add-name')}else{let sel=Qs('#modal-existing-select',mc);if(!sel){showToast('没有可用的系列');return}let sid=sel.value;if(sid)await importFilesToSeries(sid,files);else showToast('没有可用的系列')}}catch(e){console.error(e);showToast('操作失败')}}}
  else if(type==='add-name'){if(!confirmBtn)return;confirmBtn.onclick=async function(){let ni=$('modal-name');if(!ni){closeModal();return}let name=ni.value.trim();if(!name){showToast('请输入名称');return}closeModal();let files=_pendingFiles;_pendingFiles=null;if(files)await createSeries(name,files);else showToast('未找到文件，请重新选择')};setTimeout(()=>{let inp=$('modal-name');if(inp){inp.focus();inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&confirmBtn)confirmBtn.click()})}},100)}
  else if(type==='delete-confirm'){if(!confirmBtn)return;confirmBtn.onclick=function(){let dc=Qs('#modal-delete-cache',mc),shouldDelete=dc?dc.checked:!0;closeModal();let idx=bookshelf.findIndex(s=>s.seriesId===data.id);if(idx>=0){let s=bookshelf[idx];if(currentSeries===data.id)closeReader();bookshelf.splice(idx,1);renderBookshelf();delete covers[data.id];showToast('已删除「'+s.name+'」');// Background async cleanup
(async()=>{if(shouldDelete){try{await db.deleteSeriesPDFs(data.id)}catch(e){}try{await db.deleteCover(data.id)}catch(e){}}try{await db.deleteSeries(data.id)}catch(e){}})()}}}
  else if(type==='cache-mgr'){setTimeout(()=>{mc.querySelectorAll('.cache-clear-btn').forEach(btn=>{btn.addEventListener('click',async function(){let sid=this.dataset.sid,s=findSeries(sid),name=s?s.name:sid;try{await db.deleteSeriesPDFs(sid);await db.deleteCover(sid);delete covers[sid];showToast('已清除「'+name+'」的缓存');renderBookshelf()}catch(e){showToast('清除失败')}let stats=await db.getCacheStats(),si=await db.getStorageEstimate();closeModal();showModal('cache-mgr',{stats,storageInfo:si})})})},100)}
  else if(type==='settings'){const saveBtn=Qs('#modal-save-settings',mc);if(saveBtn)saveBtn.onclick=async function(){let z=$('setting-zoom').value,d=$('setting-direction').value,dp=$('setting-dual').value==='1',sb=$('setting-sidebar').value==='1',t=$('setting-theme').value,wa=$('setting-webtoon').value==='1';Object.assign(settings,{zoom:z,direction:d,dualPage:dp,sidebarOpen:sb,theme:t,webtoonAuto:wa});fitWidth=z==='fit';if(!fitWidth)zoom=parseFloat(z);$('zoom-select').value=z;document.documentElement.setAttribute('data-theme',t);await db.saveSetting('zoom',z);await db.saveSetting('direction',d);await db.saveSetting('dualPage',dp);await db.saveSetting('sidebarOpen',sb);await db.saveSetting('theme',t);await db.saveSetting('webtoonAuto',wa);closeModal();showToast('设置已保存')};if(cancelBtn)cancelBtn.onclick=closeModal}
}

async function pickFolder(){try{if(!window.showDirectoryPicker)return await pickFilesViaInput();let dh=await window.showDirectoryPicker(),fs=[];for await(let e of dh.values()){if(e.kind==='file')fs.push(await e.getFile())}let pdfs=fs.filter(f=>f.name.toLowerCase().endsWith('.pdf'));if(!pdfs.length){showToast('文件夹中没有PDF文件');return null}return pdfs}catch(e){if(e.name!=='AbortError')showToast('操作取消');return null}}
async function pickFilesViaInput(){return new Promise(resolve=>{let inp=$('hidden-file-input'),ni=inp.cloneNode(!0);inp.parentNode.replaceChild(ni,inp);ni.id='hidden-file-input';ni.accept='';ni.addEventListener('change',function(){let fs=Array.from(this.files),pdfs=fs.filter(f=>f.name.toLowerCase().endsWith('.pdf'));if(!pdfs.length){showToast('未选中PDF文件');resolve(null);return}resolve(pdfs)});ni.addEventListener('cancel',()=>resolve(null));ni.click()})}
function extractChapterNumber(f){let n=f.replace(/\.pdf$/i,'');for(let p of[/第\s*(\d+)\s*[话章节]/g,/[Cc]h(?:apter)?[.\s_-]*(\d+)/g,/^(\d+)[\s_.-]/g,/[[(（](\d+)[\])）]/g,/(\d+)$/g]){let m=[...n.matchAll(p)];if(m.length)return parseInt(m[m.length-1][1])}let m=n.match(/(\d+)/g);return m?parseInt(m[m.length-1]):Infinity}

async function createSeries(name,files){if(!files||!files.length)return;let sid='s'+Date.now()+'_'+Math.random().toString(36).slice(2,6),chs=files.map(f=>({name:f.name.replace(/\.pdf$/i,''),chapterNum:extractChapterNumber(f.name),pages:null,cached:!1,loaded:!1,status:'unread',isWebtoon:!1}));chs.sort((a,b)=>a.chapterNum-b.chapterNum);let s={seriesId:sid,name,chapters:chs,lastChNum:null,lastPage:null,createdAt:new Date().toISOString()};bookshelf.push(s);await db.saveSeries(s);renderBookshelf();if(!covers[sid]){try{if(document.fonts&&document.fonts.load)await document.fonts.load('bold 120px "Ma Shan Zheng"',name)}catch(e){}const tc=makeTextCover(name);if(tc){try{await db.saveCover(sid,tc);covers[sid]=tc}catch(e){}}}showCoverSelectDuringImport(sid,files,chs.length?chs[0].chapterNum:null);await cachePDFs(sid,files,chs);s=findSeries(sid);if(s){s.chapters.forEach(c=>{c.cached=!0;c.loaded=!1});await db.saveSeries(s)}openSeries(sid)}

async function importFilesToSeries(sid,files){let s=findSeries(sid);if(!s)return;let en=new Set(s.chapters.map(c=>c.name)),vf=files.filter(f=>f.name.toLowerCase().endsWith('.pdf')),nc=vf.filter(f=>!en.has(f.name.replace(/\.pdf$/i,''))).map(f=>({name:f.name.replace(/\.pdf$/i,''),chapterNum:extractChapterNumber(f.name),pages:null,cached:!1,loaded:!1,status:'unread',isWebtoon:!1}));if(!nc.length){showToast('没有新的PDF文件');return}s.chapters.push(...nc);s.chapters.sort((a,b)=>a.chapterNum-b.chapterNum);await db.saveSeries(s);if(currentSeries===sid){chapters=s.chapters;renderChapterList();prefetchNextSafe(currentChIdx)}renderBookshelf();let fm=[];for(let f of vf){let fn=f.name.replace(/\.pdf$/i,''),ch=s.chapters.find(c=>c.name===fn);if(ch)fm.push({file:f,ch:ch})}await cachePDFs(sid,fm.map(x=>x.file),fm.map(x=>x.ch));s=findSeries(sid);if(s){fm.forEach(({ch})=>{let c=s.chapters.find(sc=>sc.chapterNum===ch.chapterNum&&sc.name===ch.name);if(c){c.cached=!0;c.loaded=!1}});await db.saveSeries(s);if(currentSeries===sid){chapters=s.chapters;renderChapterList()}}showToast('已追加 '+nc.length+' 章')}

async function cachePDFs(sid,files,chs){if(!files.length)return;showProgress(0,files.length);for(let i=0;i<files.length;i++){try{let ab=await files[i].arrayBuffer(),cn=i<chs.length?chs[i].chapterNum:i+1;await db.savePDF(sid,cn,ab)}catch(e){console.warn('Cache fail:',files[i].name,e)}showProgress(i+1,files.length)}setTimeout(()=>hideProgress(),800)}
function showProgress(done,total){let p=$('import-progress');if(!p){p=document.createElement('div');p.id='import-progress';p.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);padding:12px 24px;border-radius:12px;z-index:1500;display:flex;align-items:center;gap:12px;box-shadow:0 4px 24px rgba(0,0,0,0.1)';p.innerHTML='<span id="import-progress-text" style="color:var(--text);font-size:13px"></span><div style="width:120px;height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div id="import-progress-bar" style="height:100%;background:var(--accent);border-radius:2px;width:0%;transition:width .2s"></div></div>';document.body.appendChild(p)}Qs('#import-progress-text',p).textContent='正在导入 '+done+'/'+total;Qs('#import-progress-bar',p).style.width=(done/total*100)+'%'}
function hideProgress(){let p=$('import-progress');if(p){Qs('#import-progress-text',p).textContent='导入完成 ✓';setTimeout(()=>{if(p.parentNode)p.parentNode.removeChild(p)},1500)}}

async function generateCover(sid,file){try{let ab=await file.arrayBuffer(),doc=await pdfjsLib.getDocument({data:ab}).promise,page=await doc.getPage(1),vp=page.getViewport({scale:.4}),cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;let dataUrl=cv.toDataURL('image/jpeg',.7);await db.saveCover(sid,dataUrl);covers[sid]=dataUrl;doc.destroy();if(!currentSeries)renderBookshelf()}catch(e){console.warn('Cover fail:',e)}}


async function autoPickCover(sid,files,chapterNum){
  try{
    let file=null;
    if(files&&files.length){if(chapterNum!=null)file=files.find(f=>f.name&&extractChapterNumber(f.name)===chapterNum)||files[0];else file=files[0]}
    let ab=null;
    if(file){try{ab=await file.arrayBuffer()}catch(e){}}
    if(!ab){try{ab=await db.loadPDF(sid,chapterNum||1)}catch(e){}}if(!ab&&!chapterNum){try{const s=findSeries(sid);const ch=[...(s&&s.chapters||[])].filter(c=>c.cached).sort((a,b)=>a.chapterNum-b.chapterNum)[0];if(ch)ab=await db.loadPDF(sid,ch.chapterNum)}catch(e){}}
    if(!ab){console.warn('autoPickCover: no data for',sid);return}
    const doc=await pdfjsLib.getDocument({data:ab}).promise;
    const maxP=doc.numPages;
    let best={score:-1,page:1,dataUrl:null};
    for(let p=1;p<=maxP;p++){
      try{
        const pg=await doc.getPage(p);
        const vp=pg.getViewport({scale:.25});
        const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
        await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        const dataUrl=cv.toDataURL('image/jpeg',.7);
        const score=scoreCover(cv,vp);
        if(score>best.score)best={score,page:p,dataUrl};
      }catch(e){}
    }
    if(!best.dataUrl){
      const pg=await doc.getPage(1);const vp=pg.getViewport({scale:.4});
      const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
      await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
      best={score:0,page:1,dataUrl:cv.toDataURL('image/jpeg',.7)};
    }
    await db.saveCover(sid,best.dataUrl);covers[sid]=best.dataUrl;
    doc.destroy();
    if(!currentSeries)renderBookshelf();
    console.log('auto cover',sid,'page',best.page,'score',Math.round(best.score*100)/100);
  }catch(e){console.warn('autoPickCover fail',e);try{await generateCover(sid,files&&files[0])}catch(e2){}}
}

function scoreCover(cv,vp){
  try{
    const ctx=cv.getContext('2d'),w=cv.width,h=cv.height;
    const img=ctx.getImageData(0,0,w,h).data;
    let nonWhite=0,sumLum=0,sumLum2=0;const colors=new Set();
    // Panel line detection: scan horizontal/vertical strips for continuous dark segments
    let panelLines=0;
    const hStrips=Math.floor(h/6),vStrips=Math.floor(w/6);
    for(let sy=0;sy<h;sy+=6){
      let darkRun=0;
      for(let x=0;x<w;x++){const i=(sy*w+x)*4,lum=.299*img[i]+.587*img[i+1]+.114*img[i+2];if(lum<80){darkRun++;if(darkRun>w*.6)panelLines++}else darkRun=0}
    }
    for(let sx=0;sx<w;sx+=6){
      let darkRun=0;
      for(let y=0;y<h;y++){const i=(y*w+sx)*4,lum=.299*img[i]+.587*img[i+1]+.114*img[i+2];if(lum<80){darkRun++;if(darkRun>h*.5)panelLines++}else darkRun=0}
    }
    const lineDensity=Math.min(1,panelLines/Math.max((hStrips+vStrips),1));
    // Color + coverage
    const step=6;
    for(let y=0;y<h;y+=step){for(let x=0;x<w;x+=step){
      const i=(y*w+x)*4,r=img[i],g=img[i+1],b=img[i+2];
      const lum=.299*r+.587*g+.114*b;sumLum+=lum;sumLum2+=lum*lum;
      if(lum<240||r<240||g<240||b<240)nonWhite++;
      colors.add(Math.floor(r/24)+','+Math.floor(g/24)+','+Math.floor(b/24));
    }}
    const n=Math.ceil(w/step)*Math.ceil(h/step);
    const coverage=nonWhite/n,avg=sumLum/n,variance=sumLum2/n-avg*avg;
    const colorRich=Math.min(1,colors.size/36);
    // Center vs edge contrast
    const cw=Math.floor(w*.4),chh=Math.floor(h*.4),cx=Math.floor(w*.3),cy=Math.floor(h*.3);
    let centerLum=0,edgeLum=0,cs=0,es=0;
    for(let y=cy;y<cy+chh;y+=8){for(let x=cx;x<cx+cw;x+=8){const i=(y*w+x)*4;centerLum+=.299*img[i]+.587*img[i+1]+.114*img[i+2];cs++}}
    for(let y=0;y<h;y+=8){for(let x=0;x<w;x+=8){if(x>=cx&&x<cx+cw&&y>=cy&&y<cy+chh)continue;const i=(y*w+x)*4;edgeLum+=.299*img[i]+.587*img[i+1]+.114*img[i+2];es++}}
    if(cs>0)centerLum/=cs;if(es>0)edgeLum/=es;
    const centerContrast=Math.min(1,Math.abs(centerLum-edgeLum)/100);
    // Covers have LOW panel line density. Score = (1-lines) * coverage * center
    return Math.max(0,(1-lineDensity)*coverage*centerContrast*10-lineDensity*2);
  }catch(e){return 0}
}

async function loadCoverCandidates(sid){
  const s=findSeries(sid);if(!s||!s.chapters.length)return[];
  const ch=[...s.chapters].filter(c=>c.cached).sort((a,b)=>a.chapterNum-b.chapterNum)[0]||s.chapters[0];
  let ab;try{ab=await db.loadPDF(sid,ch.chapterNum)}catch(e){return[]}
  if(!ab)return[];
  try{
    const doc=await pdfjsLib.getDocument({data:ab}).promise;
    const maxP=doc.numPages,cands=[];
    for(let p=1;p<=maxP;p++){
      try{
        const pg=await doc.getPage(p),vp=pg.getViewport({scale:.25});
        const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
        await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        cands.push({page:p,dataUrl:cv.toDataURL('image/jpeg',.7),score:scoreCover(cv,vp)});
      }catch(e){}
    }
    doc.destroy();
    cands.sort((a,b)=>b.score-a.score);
    return cands.slice(0,12);
  }catch(e){return[]}
}
function openSeries(id){let s=findSeries(id);if(!s)return;currentSeries=id;chapters=s.chapters;currentChIdx=-1;currentPage=1;isWebtoon=!1;webtoonScrollPct=0;renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;renderedPages.clear();prefetchQueue=[];prefetching=!1;chapterLoadToken++;(function fadeOpen(){let bs=$('bookshelf'),rd=$('reader');bs.style.transition='opacity .2s ease';bs.style.opacity='0';setTimeout(function(){bs.classList.add('hidden');bs.style.opacity='';rd.classList.remove('hidden');rd.style.opacity='0';void rd.offsetWidth;rd.style.transition='opacity .2s ease';rd.style.opacity='1'},200)})();$('ch-info').textContent=s.name+' — 共 '+chapters.length+' 章';$('ch-count').textContent=chapters.length+' 章';$('page-info').textContent='- / -';$('page-container').innerHTML='';renderChapterList();if(chapters.length>0){let si=0;if(s.lastChNum){let f=chapters.findIndex(c=>c.chapterNum===s.lastChNum);if(f>=0)si=f}loadChapter(si);if(s.lastPage&&chapters[si]&&s.lastChNum===chapters[si].chapterNum)setTimeout(()=>{if(!isWebtoon)goToPage(s.lastPage);else restoreWebtoonScroll(s.lastPage)},500)}}

function closeReader(){// Fire-and-forget: UI first, save in background
  let s=null;if(currentSeries){s=findSeries(currentSeries);if(s&&currentChIdx>=0&&currentChIdx<chapters.length){s.lastChNum=chapters[currentChIdx].chapterNum;s.lastPage=isWebtoon?getScrollProgress():currentPage;if(chapters[currentChIdx].status==='reading')chapters[currentChIdx].status='read'}}
  chapterLoadToken++;renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;currentSeries=null;chapters=[];currentChIdx=-1;isWebtoon=!1;renderedPages.clear();
  (function fadeClose(){let rd=$('reader'),bs=$('bookshelf');rd.style.transition='opacity .2s ease';rd.style.opacity='0';setTimeout(function(){rd.classList.add('hidden');rd.style.opacity='';$('page-container').innerHTML='';bs.classList.remove('hidden');bs.style.opacity='0';void bs.offsetWidth;bs.style.transition='opacity .2s ease';bs.style.opacity='1';renderBookshelf()},200)})();
  if(s)saveSeriesBg(s);
}

function renderChapterList(){const cl=$('chapter-list');cl.innerHTML=chapters.map((c,i)=>{let lab=c.chapterNum!==Infinity?'第'+String(c.chapterNum)+'话':'?',dot='<span class="ch-dot dot-'+c.status+'"></span>',wTag=c.isWebtoon?'<span class="ch-type">条漫</span>':'',cls=c.status==='read'?'chapter-item read-item':'chapter-item';return '<div class="'+cls+'" data-idx="'+i+'">'+dot+'<span class="ch-num">'+lab+'</span><span class="ch-name">'+c.name+'</span>'+wTag+'</div>'}).join('');$('ch-count').textContent=chapters.length+' 章';cl.querySelectorAll('.chapter-item').forEach(e=>e.addEventListener('click',function(){loadChapter(parseInt(this.dataset.idx))}))}
function highlightChapter(i){const cl=$('chapter-list');cl.querySelectorAll('.chapter-item').forEach(e=>e.classList.remove('active'));let e=cl.querySelector('[data-idx="'+i+'"]');if(e){e.classList.add('active');e.scrollIntoView({block:'nearest',behavior:'smooth'})}}
function setChapterStatus(i,status){let c=chapters[i];if(c)c.status=status;let el=$('chapter-list').querySelector('[data-idx="'+i+'"] .ch-dot');if(el)el.className='ch-dot dot-'+status}

// Webtoon detection
function detectWebtoon(){if(!pdfDoc||!settings.webtoonAuto)return!1;try{for(let p=1;p<=Math.min(pdfDoc.numPages,3);p++){let pg=pdfDoc.getPage(p);if(pg){let vp=pg.getViewport({scale:1});if(vp.height/vp.width>3)return!0}}}catch(e){console.warn('webtoon detect fail',e)}return!1}
function getScrollProgress(){let va=$('viewer-area'),pc=$('page-container');if(!va||!pc)return 0;let top=va.scrollTop,maxH=Math.max(pc.scrollHeight-va.clientHeight,1);return Math.round(top/maxH*100)}
function restoreWebtoonScroll(pct){setTimeout(()=>{let va=$('viewer-area'),pc=$('page-container');if(va&&pc){let maxH=Math.max(pc.scrollHeight-va.clientHeight,1);va.scrollTop=maxH*pct/100}},200)}

async function loadChapter(i){
  if(i<0||i>=chapters.length)return;if(currentChIdx>=0&&currentChIdx<chapters.length&&currentChIdx!==i&&chapters[currentChIdx].status==='reading')setChapterStatus(currentChIdx,'read');
  renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;renderedPages.clear();isWebtoon=!1;webtoonScrollPct=0;
  const myToken=++chapterLoadToken;currentChIdx=i;let c=chapters[i];setChapterStatus(i,'reading');
  $('ch-info').textContent=(currentSeries?(findSeries(currentSeries)?.name+' — '):'')+'第'+c.chapterNum+'话 · '+c.name;highlightChapter(i);updateNavButtons();
  $('loading').classList.add('show');$('load-text').textContent='正在加载 第'+c.chapterNum+'话...';
  $('chapter-list').style.pointerEvents='none';$('page-slider').disabled=!0;
  try{let ab;if(c.cached){ab=await db.loadPDF(currentSeries,c.chapterNum)}else{let exists=!1;try{exists=await db.pdfExists(currentSeries,c.chapterNum)}catch(e){}if(exists){try{ab=await db.loadPDF(currentSeries,c.chapterNum);c.cached=!0}catch(e){}}if(!ab){$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';showToast('该章节未缓存，请重新导入');return}}
  if(myToken!==chapterLoadToken){$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';return}
  pdfDoc=await pdfjsLib.getDocument({data:ab}).promise;if(myToken!==chapterLoadToken){try{pdfDoc.destroy()}catch(e){}pdfDoc=null;$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';return}
  c.pages=pdfDoc.numPages;
  // Detect webtoon
  isWebtoon=detectWebtoon();c.isWebtoon=isWebtoon;
  }catch(e){$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';showToast('加载失败');console.error(e);return}
  $('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';$('page-slider').disabled=!1;
  currentPage=1;if(!isWebtoon){$('page-slider').max=c.pages;$('page-slider').value=1;updatePageInfo()}else{$('page-slider').style.display='none';updatePageInfo()}let pc=$('page-container');pc.innerHTML='';
  for(let p=1;p<=c.pages;p++){let w=document.createElement('div');w.className='page-wrapper';w.dataset.page=p;let cv=document.createElement('canvas');w.appendChild(cv);let l=document.createElement('div');l.className='page-label';l.textContent=isWebtoon?'':(p+' / '+c.pages);pc.appendChild(w);pc.appendChild(l)}
  $('viewer-area').scrollTop=0;renderVisiblePages();saveProgress();prefetchNextSafe(i);
}

function prefetchNextSafe(idx){let n1=idx+1,n2=idx+2;if(n1<chapters.length&&chapters[n1].cached&&!chapters[n1].loaded&&!prefetchQueue.includes(n1))prefetchQueue.push(n1);if(n2<chapters.length&&chapters[n2].cached&&!chapters[n2].loaded&&!prefetchQueue.includes(n2))prefetchQueue.push(n2);if(!prefetching)drainPrefetchSafe()}
async function drainPrefetchSafe(){prefetching=!0;while(prefetchQueue.length>0){let i=prefetchQueue.shift();if(i>=chapters.length)continue;let c=chapters[i];if(c.loaded||!c.cached)continue;if(Math.abs(i-currentChIdx)>5)continue;try{let ab=await db.loadPDF(currentSeries,c.chapterNum),doc=await pdfjsLib.getDocument({data:ab}).promise;c.pages=doc.numPages;doc.destroy()}catch(e){console.warn('Prefetch fail:',c.name)}}prefetching=!1}

async function renderPage(pn){if(!pdfDoc||renderedPages.has(pn))return;renderedPages.add(pn);let pg=await pdfDoc.getPage(pn),w=$('page-container').querySelector('[data-page="'+pn+'"]');if(!w)return;let cv=w.querySelector('canvas'),vp=pg.getViewport({scale:zoom});if(fitWidth){let cw=$('viewer-area').clientWidth-40,sc=cw/vp.width,fvp=pg.getViewport({scale:sc});cv.width=fvp.width;cv.height=fvp.height;let t=pg.render({canvasContext:cv.getContext('2d'),viewport:fvp});renderTasks.push(t);await t.promise}else{cv.width=vp.width;cv.height=vp.height;let t=pg.render({canvasContext:cv.getContext('2d'),viewport:vp});renderTasks.push(t);await t.promise}w.style.width=cv.style.width||cv.width+'px'}
function renderVisiblePages(){if(!pdfDoc)return;let cr=$('viewer-area').getBoundingClientRect(),ws=$('page-container').querySelectorAll('.page-wrapper'),tr=[];for(let w of ws){let r=w.getBoundingClientRect();if(r.bottom>=cr.top-400&&r.top<=cr.bottom+400){let p=parseInt(w.dataset.page);if(!renderedPages.has(p))tr.push(p)}}for(let i=0;i<tr.length;i+=3)tr.slice(i,i+3).forEach(p=>renderPage(p))}
function reRenderAll(){renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];renderedPages.clear();renderVisiblePages()}

function goToPage(n){if(!pdfDoc||isWebtoon)return;n=Math.max(1,Math.min(pdfDoc.numPages,n));currentPage=n;$('page-slider').value=n;updatePageInfo();let w=$('page-container').querySelector('[data-page="'+n+'"]');if(w)w.scrollIntoView({behavior:'smooth',block:'start'});if(n===pdfDoc.numPages)setChapterStatus(currentChIdx,'read');saveProgress()}
function nextPage(){if(!pdfDoc)return;if(isWebtoon){scrollWebtoon(.5);return}if(currentPage<pdfDoc.numPages)goToPage(currentPage+1);else nextChapter()}
function prevPage(){if(!pdfDoc)return;if(isWebtoon){scrollWebtoon(-.5);return}if(currentPage>1)goToPage(currentPage-1);else prevChapter()}
function scrollWebtoon(dir){let va=$('viewer-area'),h=va.clientHeight*.7;va.scrollBy({top:dir*h,behavior:'smooth'})}
async function nextChapter(){if(currentChIdx+1<chapters.length){setChapterStatus(currentChIdx,'read');await loadChapter(currentChIdx+1);showToast('▶ 第'+chapters[currentChIdx].chapterNum+'话')}else showToast('已经是最后一章了')}
async function prevChapter(){if(currentChIdx>0){setChapterStatus(currentChIdx,'read');await loadChapter(currentChIdx-1);if(!isWebtoon)goToPage(chapters[currentChIdx].pages||1);showToast('◀ 第'+chapters[currentChIdx].chapterNum+'话')}else showToast('已经是第一章了')}
function updateNavButtons(){$('btn-prev-ch').disabled=currentChIdx<=0;$('btn-next-ch').disabled=currentChIdx>=chapters.length-1}
function updatePageInfo(){if(!pdfDoc){$('page-info').textContent='- / -';return}if(isWebtoon){$('page-info').textContent='滚动 '+getScrollProgress()+'%'}else{$('page-info').textContent=currentPage+' / '+pdfDoc.numPages}}
async function saveProgress(){if(currentChIdx<0||!currentSeries)return;let s=findSeries(currentSeries);if(s){s.lastChNum=chapters[currentChIdx].chapterNum;s.lastPage=isWebtoon?getScrollProgress():currentPage;saveSeriesBg(s)}}

// ===== Event Bindings =====
$('viewer-area').addEventListener('scroll',()=>{if(scrollTimer)clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(!pdfDoc)return;if(!isWebtoon){let cr=$('viewer-area').getBoundingClientRect(),my=cr.top+cr.height*.3,ws=$('page-container').querySelectorAll('.page-wrapper'),bp=currentPage,bd=Infinity;for(let w of ws){let r=w.getBoundingClientRect(),d=Math.abs(r.top-my);if(d<bd){bd=d;bp=parseInt(w.dataset.page)}}if(bp!==currentPage){currentPage=bp;$('page-slider').value=currentPage;updatePageInfo();saveProgress()}}else{updatePageInfo();saveProgress();if(getScrollProgress()>=99&&currentChIdx<chapters.length){chapters[currentChIdx].status='read'}}renderVisiblePages()},150)});
$('page-slider').addEventListener('input',function(){goToPage(parseInt(this.value))});
$('zoom-select').addEventListener('change',function(){let v=this.value;fitWidth=v==='fit';if(!fitWidth)zoom=parseFloat(v);reRenderAll();settings.zoom=v;db.saveSetting('zoom',v)});
$('btn-back').addEventListener('click',closeReader);
$('btn-toggle-sidebar').addEventListener('click',function(){$('sidebar').classList.toggle('hidden')});
$('btn-prev-pg').addEventListener('click',prevPage);$('btn-next-pg').addEventListener('click',nextPage);
$('btn-prev-ch').addEventListener('click',prevChapter);$('btn-next-ch').addEventListener('click',nextChapter);
$('btn-cache-mgr').addEventListener('click',async function(){let stats=await db.getCacheStats(),si=await db.getStorageEstimate();showModal('cache-mgr',{stats,storageInfo:si})});$('bs-settings-btn').addEventListener('click',function(){showModal('settings')});
$('btn-settings').addEventListener('click',function(){showModal('settings')});const setCoverBtn=$('btn-set-cover');if(setCoverBtn)setCoverBtn.addEventListener('click',function(){if(!currentSeries)return;showModal('set-cover',{sid:currentSeries})});
$('bs-search').addEventListener('input',function(){searchQuery=this.value;renderBookshelf()});
$('bs-sort').addEventListener('change',function(){sortMode=this.value;renderBookshelf()});
$('bs-add-folder').addEventListener('click',function(){_pendingFilesMode='folder';showAddModal()});
$('bs-add-files').addEventListener('click',async function(){
  _pendingFilesMode='input';
  const files=await pickFilesViaInput();
  if(files&&files.length){
    _pendingFiles=files;
    showAddModal();
  }
});
$('bs-add-btn').addEventListener('click',function(){_pendingFilesMode='input';showAddModal()});
$('btn-add-files-reader').addEventListener('click',async function(){if(!currentSeries)return;let files=await pickFilesViaInput();if(files&&files.length)await importFilesToSeries(currentSeries,files)});
$('btn-add-folder-reader').addEventListener('click',async function(){if(!currentSeries)return;let files=await pickFolder();if(files&&files.length)await importFilesToSeries(currentSeries,files)});

let sidebarResizing=!1,sX=0,sW=0;const sidebarEl=$('sidebar'),resizerEl=$('sidebar-resizer');
resizerEl.addEventListener('mousedown',function(e){sidebarResizing=!0;sX=e.clientX;sW=sidebarEl.offsetWidth;document.body.style.cursor='col-resize';document.body.style.userSelect='none';e.preventDefault()});
document.addEventListener('mousemove',function(e){if(!sidebarResizing)return;let w=Math.max(180,Math.min(480,sW+(e.clientX-sX)));sidebarEl.style.width=w+'px';sidebarEl.style.minWidth=w+'px';sidebarEl.style.maxWidth=w+'px'});
document.addEventListener('mouseup',function(){if(!sidebarResizing)return;sidebarResizing=!1;document.body.style.cursor='';document.body.style.userSelect=''});

document.addEventListener('keydown',function(e){if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;switch(e.key){
  case'ArrowRight':case'd':e.preventDefault();nextPage();break;case'ArrowLeft':case'a':e.preventDefault();prevPage();break;
  case'ArrowDown':case's':e.preventDefault();nextChapter();break;case'ArrowUp':case'w':e.preventDefault();prevChapter();break;
  case'f':e.preventDefault();$('zoom-select').value='fit';fitWidth=!0;reRenderAll();break;
  case'b':e.preventDefault();$('sidebar').classList.toggle('hidden');break;case'Escape':e.preventDefault();closeReader();break}});

function preventAndStop(e){e.preventDefault();e.stopPropagation()}
document.addEventListener('dragover',function(e){preventAndStop(e);$('drop-overlay').classList.add('show')});
document.addEventListener('dragenter',function(e){preventAndStop(e);$('drop-overlay').classList.add('show')});
document.addEventListener('dragleave',function(e){preventAndStop(e);$('drop-overlay').classList.remove('show')});
document.addEventListener('drop',function(e){preventAndStop(e);$('drop-overlay').classList.remove('show');if(e.dataTransfer)dropHandler(e.dataTransfer)});

async function dropHandler(dt){try{let pdfs=[];if(dt.files&&dt.files.length>0){let fp=Array.from(dt.files).filter(f=>f&&f.name&&f.name.toLowerCase().endsWith('.pdf'));if(fp.length>0)pdfs=fp}if(pdfs.length===0&&dt.items&&dt.items.length>0){if(window.location.protocol==='file:'&&dt.items.length>0){let hasDir=!1;for(let it of Array.from(dt.items)){if(it&&it.kind==='file'){let en=null;try{en=it.webkitGetAsEntry?it.webkitGetAsEntry():null}catch(e){}if(en&&en.isDirectory){hasDir=!0;break}}}if(hasDir){showToast('检测到文件夹拖入。请使用「启动阅读器.bat」以 http://localhost 方式打开，或点击按钮选择文件夹');return}}let fs=[],es=[];for(let it of Array.from(dt.items)){if(!it||it.kind!=='file')continue;let en=null;try{en=it.webkitGetAsEntry?it.webkitGetAsEntry():null}catch(e){}if(en)es.push(en);else{try{let f=it.getAsFile();if(f)fs.push(f)}catch(e){}}}let allFiles=[...fs];for(let e of es){try{await collectFiles(e,allFiles)}catch(e){}}pdfs=allFiles.filter(f=>f&&f.name&&f.name.toLowerCase().endsWith('.pdf'))}if(!pdfs.length){showToast('未找到PDF文件');return}showToast('已接收 '+pdfs.length+' 个 PDF 文件');_pendingFiles=pdfs;_pendingFilesMode='drop';if(currentSeries){await importFilesToSeries(currentSeries,pdfs)}else{showModal('add-choose')}}catch(err){console.error('Drop handler error:',err);showToast('拖拽处理失败')}}
async function collectFiles(entry,out){if(!entry)return;if(entry.isFile){out.push(await new Promise((r,rj)=>entry.file(r,rj)))}else if(entry.isDirectory){let rd=entry.createReader(),batch;do{batch=await new Promise((r,rj)=>rd.readEntries(r,rj));for(let e of batch)await collectFiles(e,out)}while(batch.length>0)}}

function showToast(m){let t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._timeout);t._timeout=setTimeout(function(){t.classList.remove('show')},2000)}
window.addEventListener('resize',function(){if(fitWidth)reRenderAll();const g=Qs('bs-grid');if(g&&g.dataset.count)applyRackSizing(parseInt(g.dataset.count||'0',10))});
document.addEventListener('contextmenu',function(e){let card=e.target.closest('.rack-book');if(!card)return;e.preventDefault();let sid=card.dataset.id,s=findSeries(sid);if(s)showModal('delete-confirm',{id:sid,name:s.name})});
initApp().then(()=>console.log('📚 v10 — interactive rack + import cover select'));
