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
let captureUiActive=!1;
let restoringProgress=!1,viewRestoreGeneration=0;

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
function setCaptureRenderState(canvas,state,renderVersion){
  if(!canvas)return null;
  if(renderVersion===undefined){renderVersion=(canvas._captureRenderVersion||0)+1;canvas._captureRenderVersion=renderVersion}
  else if(canvas._captureRenderVersion!==renderVersion)return null;
  if(canvas.dataset)canvas.dataset.captureRenderState=state;
  const wrapper=canvas.closest?canvas.closest('.page-wrapper'):canvas.parentNode;
  if(wrapper&&wrapper.dataset)wrapper.dataset.captureRenderState=state;
  return renderVersion;
}
function markCaptureCanvasesIneligible(root){
  if(!root||!root.querySelectorAll)return;
  root.querySelectorAll('.page-wrapper canvas').forEach(canvas=>setCaptureRenderState(canvas,'idle'));
}
function beginCaptureUi(cleanup){
  if(document._captureUiCleanup&&document._captureUiCleanup!==cleanup)document._captureUiCleanup();
  const previousFocus=document.activeElement;
  captureUiActive=!0;document._captureUiCleanup=cleanup;
  return previousFocus;
}
function endCaptureUi(cleanup,previousFocus){
  if(document._captureUiCleanup===cleanup){document._captureUiCleanup=null;captureUiActive=!1}
  if(previousFocus&&typeof previousFocus.focus==='function'&&(!document.contains||document.contains(previousFocus)))previousFocus.focus();
}
function trapCaptureUiFocus(e,controls){
  if(e.key!=='Tab')return!1;
  const available=controls.filter(control=>control&&!control.disabled);
  if(!available.length)return!1;
  const current=available.indexOf(document.activeElement),step=e.shiftKey?-1:1;
  let next=current<0?(e.shiftKey?available.length-1:0):(current+step+available.length)%available.length;
  if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();available[next].focus();return!0;
}
function getVisibleCaptureSource(){
  const viewer=document.querySelector('#viewer-area');
  if(!viewer)return null;
  const viewerRect=viewer.getBoundingClientRect();
  const viewport={left:0,top:0,right:window.innerWidth,bottom:window.innerHeight};
  const limit={
    left:Math.max(viewerRect.left,viewport.left),
    top:Math.max(viewerRect.top,viewport.top),
    right:Math.min(viewerRect.right,viewport.right),
    bottom:Math.min(viewerRect.bottom,viewport.bottom)
  };
  let best=null;
  viewer.querySelectorAll('.page-wrapper canvas').forEach(canvas=>{
    const wrapper=canvas.closest?canvas.closest('.page-wrapper'):canvas.parentNode;
    if(!canvas.dataset||canvas.dataset.captureRenderState!=='complete'||(wrapper&&wrapper.dataset&&wrapper.dataset.captureRenderState!=='complete'))return;
    const canvasRect=canvas.getBoundingClientRect();
    const left=Math.max(canvasRect.left,limit.left),top=Math.max(canvasRect.top,limit.top),right=Math.min(canvasRect.right,limit.right),bottom=Math.min(canvasRect.bottom,limit.bottom);
    const width=Math.max(0,right-left),height=Math.max(0,bottom-top),area=width*height;
    if(area>0&&(!best||area>best.area))best={canvas,canvasRect,visibleBounds:{x:left,y:top,width,height},pageNumber:parseInt(wrapper&&wrapper.dataset?wrapper.dataset.page:'',10),area};
  });
  return best?{canvas:best.canvas,canvasRect:best.canvasRect,visibleBounds:best.visibleBounds,pageNumber:best.pageNumber,viewportSize:{width:Math.max(0,limit.right-limit.left),height:Math.max(0,limit.bottom-limit.top)}}:null;
}
function buildCanonicalCaptureSource(source){
  if(!pdfDoc||!source||!Number.isFinite(source.pageNumber))return Promise.reject(new Error('canonical capture source unavailable'));
  return pdfDoc.getPage(source.pageNumber).then(page=>{
    const viewport=page.getViewport({scale:1});
    const canonicalWindow=CoverCapture.computeCanonicalWindow(source.canvasRect,source.visibleBounds,{width:viewport.width,height:viewport.height},source.viewportSize);
    const viewCanvas=document.createElement('canvas');viewCanvas.width=Math.max(1,Math.round(canonicalWindow.width));viewCanvas.height=Math.max(1,Math.round(canonicalWindow.height));
    const viewContext=viewCanvas.getContext('2d');viewContext.fillStyle='#fff';if(viewContext.fillRect)viewContext.fillRect(0,0,viewCanvas.width,viewCanvas.height);
    const offsetX=canonicalWindow.x===0?0:-canonicalWindow.x,offsetY=canonicalWindow.y===0?0:-canonicalWindow.y;
    const renderTask=page.render({canvasContext:viewContext,viewport,transform:[1,0,0,1,offsetX,offsetY],background:'#fff'});
    return renderTask.promise.then(()=>{
      return {sourceKind:'canonical100',canvas:viewCanvas,canvasRect:{left:0,top:0,width:viewCanvas.width,height:viewCanvas.height},visibleBounds:{x:0,y:0,width:viewCanvas.width,height:viewCanvas.height},pageNumber:source.pageNumber,canonicalWindow};
    });
  });
}
function scoreCaptureCandidate(canvas,canvasRect,candidate,visibleBounds){
  try{
    const scaleX=canvas.width/canvasRect.width,scaleY=canvas.height/canvasRect.height;
    if(!Number.isFinite(scaleX)||!Number.isFinite(scaleY)||scaleX<=0||scaleY<=0)return-1000000;
    const sourceLeft=Math.max(0,Math.min(canvas.width,(candidate.x-canvasRect.left)*scaleX)),sourceTop=Math.max(0,Math.min(canvas.height,(candidate.y-canvasRect.top)*scaleY));
    const sourceRight=Math.max(sourceLeft,Math.min(canvas.width,(candidate.x+candidate.width-canvasRect.left)*scaleX)),sourceBottom=Math.max(sourceTop,Math.min(canvas.height,(candidate.y+candidate.height-canvasRect.top)*scaleY));
    const sourceWidth=sourceRight-sourceLeft,sourceHeight=sourceBottom-sourceTop;
    if(!(sourceWidth>0)||!(sourceHeight>0))return-1000000;
    const sampleWidth=Math.max(1,Math.min(24,Math.round(sourceWidth))),sampleHeight=Math.max(1,Math.min(24,Math.round(sourceHeight)));
    const sampleCanvas=document.createElement('canvas');sampleCanvas.width=sampleWidth;sampleCanvas.height=sampleHeight;
    const context=sampleCanvas.getContext('2d');context.drawImage(canvas,sourceLeft,sourceTop,sourceWidth,sourceHeight,0,0,sampleWidth,sampleHeight);
    const pixels=context.getImageData(0,0,sampleWidth,sampleHeight).data;
    let luminanceSum=0,luminanceSquaredSum=0,nonWhite=0,white=0,black=0,edgeSum=0,edgeCount=0;
    const luminances=[];
    for(let y=0;y<sampleHeight;y+=1)for(let x=0;x<sampleWidth;x+=1){
      const pixelIndex=(y*sampleWidth+x)*4,alpha=pixels[pixelIndex+3]/255;
      const pixel=[pixels[pixelIndex]*alpha+255*(1-alpha),pixels[pixelIndex+1]*alpha+255*(1-alpha),pixels[pixelIndex+2]*alpha+255*(1-alpha)];
      const luminance=(pixel[0]*.2126+pixel[1]*.7152+pixel[2]*.0722)/255;
      luminances.push(luminance);luminanceSum+=luminance;luminanceSquaredSum+=luminance*luminance;
      if(luminance<.96)nonWhite+=1;if(luminance>.98)white+=1;if(luminance<.02)black+=1;
    }
    for(let y=0;y<sampleHeight;y+=1)for(let x=0;x<sampleWidth;x+=1){
      const index=y*sampleWidth+x;
      if(x+1<sampleWidth){edgeSum+=Math.abs(luminances[index]-luminances[index+1]);edgeCount+=1}
      if(y+1<sampleHeight){edgeSum+=Math.abs(luminances[index]-luminances[index+sampleWidth]);edgeCount+=1}
    }
    const count=luminances.length,mean=luminanceSum/count,variance=Math.max(0,luminanceSquaredSum/count-mean*mean),nonWhiteCoverage=nonWhite/count,whiteCoverage=white/count,blackCoverage=black/count,edgeChange=edgeCount?edgeSum/edgeCount:0;
    let edgePenalty=0;
    if(visibleBounds&&candidate.width>0&&candidate.height>0){
      const edgeBand=Math.max(1,Math.min(candidate.width,candidate.height)*.08);
      const distances=[candidate.x-visibleBounds.x,candidate.y-visibleBounds.y,visibleBounds.x+visibleBounds.width-candidate.x-candidate.width,visibleBounds.y+visibleBounds.height-candidate.y-candidate.height];
      distances.forEach(distance=>{if(distance<edgeBand)edgePenalty+=(1-Math.max(0,distance)/edgeBand)*.04});
    }
    const score=nonWhiteCoverage*1.5+variance*5+edgeChange*4-Math.pow(whiteCoverage,8)*1.5-Math.pow(blackCoverage,2)*6-edgePenalty;
    return Number.isFinite(score)?score:-1000000;
  }catch(e){return-1000000}
}
function showCoverRecommendation(sid,capture){
  const ov=$('modal-overlay'),mc=$('modal-content');
  if(!ov||!mc||!capture||!capture.dataUrl)return;
  if(mc._coverRecommendationCleanup)mc._coverRecommendationCleanup();
  mc.innerHTML='<div class="cover-recommendation"><span class="cover-recommendation-label">系统推荐</span><img class="cover-recommendation-image" src="'+capture.dataUrl+'" alt="系统推荐封面预览"><div class="modal-actions cover-recommendation-actions"><button class="accent" id="cover-recommend-use">使用推荐</button><button id="cover-recommend-adjust">调整一下</button><button id="cover-recommend-cancel">取消</button></div></div>';
  mc.setAttribute('role','dialog');mc.setAttribute('aria-modal','true');mc.setAttribute('aria-label','推荐封面预览');
  ov.classList.add('show');
  const useBtn=Qs('#cover-recommend-use',mc),adjustBtn=Qs('#cover-recommend-adjust',mc),cancelBtn=Qs('#cover-recommend-cancel',mc);
  let closed=false,saving=false,previousFocus=null;
  function close(){
    if(closed)return;closed=true;
    ov.classList.remove('show');
    ov.removeEventListener('click',onOverlayClick);document.removeEventListener('keydown',onKeyDown,true);
    if(useBtn)useBtn.onclick=null;if(adjustBtn)adjustBtn.onclick=null;if(cancelBtn)cancelBtn.onclick=null;
    if(mc._coverRecommendationCleanup===close)mc._coverRecommendationCleanup=null;
    mc.removeAttribute('role');mc.removeAttribute('aria-modal');mc.removeAttribute('aria-label');
    mc.innerHTML='';
    endCaptureUi(close,previousFocus);
  }
  function onOverlayClick(e){if(e.target===ov)close()}
  function onKeyDown(e){if(trapCaptureUiFocus(e,[useBtn,adjustBtn,cancelBtn]))return;if(e.key==='Escape'){e.preventDefault();if(e.stopPropagation)e.stopPropagation();close()}}
  if(useBtn)useBtn.onclick=async function(){
    if(saving||closed)return;saving=true;useBtn.disabled=true;
    try{if(await setSeriesCover(sid,capture.dataUrl,{errorMessage:'封面保存失败，请重试'})===true)close()}
    catch(e){showToast('封面保存失败，请重试')}
    finally{saving=false;if(!closed)useBtn.disabled=false}
  };
  if(adjustBtn)adjustBtn.onclick=function(){close();startCoverAdjustment(sid,capture)};
  if(cancelBtn)cancelBtn.onclick=close;
  ov.addEventListener('click',onOverlayClick);document.addEventListener('keydown',onKeyDown,true);
  mc._coverRecommendationCleanup=close;previousFocus=beginCaptureUi(close);if(useBtn)useBtn.focus();
}
function cropCanvasToDataUrl(capture){
  const canvas=capture&&capture.canvas,canvasRect=capture&&capture.canvasRect,rect=capture&&capture.rect;
  if(!canvas||!canvasRect||!rect||!canvasRect.width||!canvasRect.height)return null;
  const scaleX=canvas.width/canvasRect.width,scaleY=canvas.height/canvasRect.height;
  if(!Number.isFinite(scaleX)||!Number.isFinite(scaleY)||scaleX<=0||scaleY<=0)return null;
  const left=Math.max(0,Math.min(canvas.width,(rect.x-canvasRect.left)*scaleX)),top=Math.max(0,Math.min(canvas.height,(rect.y-canvasRect.top)*scaleY));
  const right=Math.max(left,Math.min(canvas.width,(rect.x+rect.width-canvasRect.left)*scaleX)),bottom=Math.max(top,Math.min(canvas.height,(rect.y+rect.height-canvasRect.top)*scaleY));
  const width=right-left,height=bottom-top;
  if(!(width>0)||!(height>0))return null;
  const outputUnit=Math.max(1,Math.floor(Math.min(width/5,height/7)));
  const out=document.createElement('canvas');out.width=outputUnit*5;out.height=outputUnit*7;
  out.getContext('2d').drawImage(canvas,left,top,width,height,0,0,out.width,out.height);
  return out.toDataURL('image/jpeg',0.92);
}
function startCoverAdjustment(sid,capture){
  if(!capture||!capture.rect||!capture.originalRect||!capture.visibleBounds)return;
  if(document._coverAdjustmentCleanup)document._coverAdjustmentCleanup();
  const ratio=5/7,hasCanonicalStage=capture.sourceKind==='canonical100';
  const overlay=document.createElement('div'),tip=document.createElement('div'),rectEl=document.createElement('div'),actions=document.createElement('div');
  overlay.className='cover-adjustment-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','调整封面截图');
  tip.className='cover-adjustment-tip';tip.textContent='拖动或拉角调整 · 固定 5:7';
  rectEl.className='cover-adjustment-rect';
  actions.className='cover-adjustment-actions';
  const saveBtn=document.createElement('button'),restoreBtn=document.createElement('button'),cancelBtn=document.createElement('button');
  saveBtn.id='cover-adjustment-save';saveBtn.className='accent';saveBtn.textContent='保存为封面';
  restoreBtn.id='cover-adjustment-restore';restoreBtn.textContent='恢复推荐位置';
  cancelBtn.id='cover-adjustment-cancel';cancelBtn.textContent='取消';
  actions.appendChild(saveBtn);actions.appendChild(restoreBtn);actions.appendChild(cancelBtn);
  if(hasCanonicalStage){
    const sourceBounds={x:capture.visibleBounds.x,y:capture.visibleBounds.y,width:capture.visibleBounds.width,height:capture.visibleBounds.height};
    const stageScale=Math.min(1,Math.max(1,window.innerWidth-32)/sourceBounds.width,Math.max(1,window.innerHeight-152)/sourceBounds.height);
    const stageBounds={x:(window.innerWidth-sourceBounds.width*stageScale)/2,y:(window.innerHeight-sourceBounds.height*stageScale)/2,width:sourceBounds.width*stageScale,height:sourceBounds.height*stageScale};
    capture.rect=CoverCapture.mapRectBetweenBounds(capture.rect,sourceBounds,stageBounds);
    capture.originalRect=CoverCapture.mapRectBetweenBounds(capture.originalRect,sourceBounds,stageBounds);
    capture.canvasRect={left:stageBounds.x,top:stageBounds.y,width:stageBounds.width,height:stageBounds.height};
    capture.visibleBounds={x:stageBounds.x,y:stageBounds.y,width:stageBounds.width,height:stageBounds.height};
    const stage=document.createElement('canvas');stage.className='cover-adjustment-stage';stage.width=capture.canvas.width;stage.height=capture.canvas.height;
    stage.style.left=stageBounds.x+'px';stage.style.top=stageBounds.y+'px';stage.style.width=stageBounds.width+'px';stage.style.height=stageBounds.height+'px';
    const stageContext=stage.getContext('2d');stageContext.drawImage(capture.canvas,0,0);overlay.appendChild(stage);
    tip.textContent='100% 画面 · 拖动或拉角调整 · 固定 5:7';
  }
  overlay.appendChild(tip);overlay.appendChild(rectEl);overlay.appendChild(actions);document.body.appendChild(overlay);
  const bounds=capture.visibleBounds;
  const handles={};
  ['nw','ne','sw','se'].forEach(corner=>{const handle=document.createElement('button');handle.type='button';handle.className='cover-adjustment-handle cover-adjustment-handle-'+corner;handle.dataset.corner=corner;handle.setAttribute('aria-label','调整 '+corner+' 角');rectEl.appendChild(handle);handles[corner]=handle});
  let active=null,closed=false,saving=false,previousFocus=null;
  function copyRect(rect){return{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}
  const maxWidth=Math.min(bounds.width,bounds.height*ratio),preferredMinimumWidth=Math.min(80,maxWidth);
  const originalRequestedWidth=Number.isFinite(capture.originalRect.width)&&capture.originalRect.width>0?Math.min(maxWidth,capture.originalRect.width):preferredMinimumWidth;
  const adjustmentMinimumWidth=Math.min(preferredMinimumWidth,originalRequestedWidth);
  function minimumWidth(){return adjustmentMinimumWidth}
  function apply(rect){capture.rect=CoverCapture.clampRect(rect,bounds,ratio,minimumWidth());render()}
  function render(){const rect=capture.rect;rectEl.style.left=rect.x+'px';rectEl.style.top=rect.y+'px';rectEl.style.width=rect.width+'px';rectEl.style.height=rect.height+'px'}
  function stopActive(e){if(!active)return;if(e&&e.pointerId!==active.pointerId)return;const pointerId=active.pointerId,target=active.target;active=null;if(target&&target.releasePointerCapture)try{target.releasePointerCapture(pointerId)}catch(ignore){}}
  function onPointerMove(e){
    if(!active||e.pointerId!==active.pointerId)return;
    if(e.preventDefault)e.preventDefault();
    const dx=e.clientX-active.startX,dy=e.clientY-active.startY,start=active.rect;
    if(active.mode==='move'){apply({x:start.x+dx,y:start.y+dy,width:start.width,height:start.height});return}
    const west=active.corner.includes('w'),north=active.corner.includes('n'),sx=west?-1:1,sy=north?-1:1;
    const anchorX=west?start.x+start.width:start.x,anchorY=north?start.y+start.height:start.y;
    const directionX=sx,directionY=sy/ratio,pointerX=e.clientX-anchorX,pointerY=e.clientY-anchorY;
    const width=Math.max(0,(pointerX*directionX+pointerY*directionY)/(directionX*directionX+directionY*directionY));
    const x=west?anchorX-width:anchorX,y=north?anchorY-width/ratio:anchorY;
    apply({x,y,width});
  }
  function onPointerDown(e,mode,corner){
    if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();
    active={pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,rect:copyRect(capture.rect),mode,corner,target:e.currentTarget||e.target};
    if(active.target&&active.target.setPointerCapture)try{active.target.setPointerCapture(e.pointerId)}catch(ignore){}
  }
  function onKeyDown(e){
    if(trapCaptureUiFocus(e,[saveBtn,restoreBtn,cancelBtn]))return;
    if(e.key==='Escape'){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();cleanup();return}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||/^[adwsfb]$/i.test(e.key)){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation()}
  }
  function onWheel(e){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation()}
  function onViewportChange(){if(closed)return;cleanup();showToast('窗口尺寸已变化，请重新调整封面')}
  function cleanup(){
    if(closed)return;closed=true;stopActive();
    overlay.removeEventListener('pointerdown',onRectPointerDown);overlay.removeEventListener('pointermove',onPointerMove);overlay.removeEventListener('pointerup',onPointerEnd);overlay.removeEventListener('pointercancel',onPointerEnd);
    Object.keys(handles).forEach(corner=>handles[corner].removeEventListener('pointerdown',handleDown));
    document.removeEventListener('keydown',onKeyDown,true);document.removeEventListener('wheel',onWheel,wheelListenerOptions);
    if(hasCanonicalStage&&window.removeEventListener){window.removeEventListener('resize',onViewportChange);window.removeEventListener('orientationchange',onViewportChange)}
    saveBtn.onclick=null;restoreBtn.onclick=null;cancelBtn.onclick=null;
    if(overlay.parentNode)overlay.parentNode.removeChild(overlay);
    if(document._coverAdjustmentCleanup===cleanup)document._coverAdjustmentCleanup=null;
    endCaptureUi(cleanup,previousFocus);
  }
  function onRectPointerDown(e){if(e.target!==rectEl)return;onPointerDown(e,'move')}
  function handleDown(e){onPointerDown(e,'resize',e.currentTarget.dataset.corner)}
  function onPointerEnd(e){stopActive(e)}
  saveBtn.onclick=async function(){
    if(saving||closed)return;saving=true;
    let dataUrl=null;try{dataUrl=cropCanvasToDataUrl(capture)}catch(e){}
    if(!dataUrl){showToast('封面保存失败，请重试');saving=false;return}
    try{if(await setSeriesCover(sid,dataUrl,{errorMessage:'封面保存失败，请重试'}))cleanup()}finally{saving=false}
  };
  capture.originalRect=CoverCapture.clampRect(copyRect(capture.originalRect),bounds,ratio,minimumWidth());
  capture.rect=CoverCapture.clampRect(copyRect(capture.rect),bounds,ratio,minimumWidth());
  restoreBtn.onclick=function(){apply(copyRect(capture.originalRect))};cancelBtn.onclick=cleanup;
  overlay.addEventListener('pointerdown',onRectPointerDown);overlay.addEventListener('pointermove',onPointerMove);overlay.addEventListener('pointerup',onPointerEnd);overlay.addEventListener('pointercancel',onPointerEnd);
  Object.keys(handles).forEach(corner=>handles[corner].addEventListener('pointerdown',handleDown));
  const wheelListenerOptions={capture:true,passive:false};
  document.addEventListener('keydown',onKeyDown,true);document.addEventListener('wheel',onWheel,wheelListenerOptions);document._coverAdjustmentCleanup=cleanup;
  if(hasCanonicalStage&&window.addEventListener){window.addEventListener('resize',onViewportChange);window.addEventListener('orientationchange',onViewportChange)}
  previousFocus=beginCaptureUi(cleanup);apply(copyRect(capture.rect));saveBtn.focus();
}
function recommendVisibleCoverCrop(sourceOverride){
  const source=sourceOverride||getVisibleCaptureSource();
  if(!source)return null;
  const fallback=CoverCapture.fitRect(source.visibleBounds,5/7,0);
  let rect=fallback;
  try{
    let scoringFailed=false;
    let candidates=CoverCapture.buildCandidates(source.visibleBounds,5/7);
    if(source.sourceKind==='canonical100'){
      const epsilon=Math.max(1,fallback.width)*1e-9;
      candidates=candidates.filter(candidateRect=>Math.abs(candidateRect.width-fallback.width)<=epsilon&&Math.abs(candidateRect.height-fallback.height)<=epsilon);
      if(!candidates.length)candidates=[fallback];
    }
    const candidate=CoverCapture.chooseCandidate(candidates,candidateRect=>{
      const score=scoreCaptureCandidate(source.canvas,source.canvasRect,candidateRect,source.visibleBounds);
      if(score<=-1000000)scoringFailed=true;
      return score;
    });
    if(candidate&&!scoringFailed)rect=candidate;
  }catch(e){rect=fallback}
  rect={x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  let dataUrl=null;
  try{dataUrl=cropCanvasToDataUrl({canvas:source.canvas,canvasRect:source.canvasRect,rect});if(!dataUrl)throw new Error('capture preview unavailable')}catch(e){rect={x:fallback.x,y:fallback.y,width:fallback.width,height:fallback.height};try{dataUrl=cropCanvasToDataUrl({canvas:source.canvas,canvasRect:source.canvasRect,rect})}catch(ignore){}}
  return {sourceKind:source.sourceKind,canvas:source.canvas,canvasRect:source.canvasRect,visibleBounds:{x:source.visibleBounds.x,y:source.visibleBounds.y,width:source.visibleBounds.width,height:source.visibleBounds.height},rect,originalRect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},dataUrl};
}
function startCoverCapture(sid){
  try{
    const modalOverlay=$('modal-overlay'),modalContent=$('modal-content');
    const captureBtn=modalContent?Qs('#set-cover-capture',modalContent):null,setupCancelBtn=modalContent?Qs('#modal-cancel',modalContent):null;
    if(captureBtn&&captureBtn._capturePreparing)return;
    if(captureBtn){captureBtn._capturePreparing=!0;captureBtn.disabled=!0;captureBtn.textContent='正在生成 100% 画面…'}
    const setupCleanup=modalContent&&modalContent._modalCleanup;
    let cancelled=!1,preparationClosed=!1,previousFocus=null;
    function releasePreparation(restoreSetupCleanup){
      if(preparationClosed)return;preparationClosed=!0;
      if(document.removeEventListener)document.removeEventListener('keydown',onPreparationKeyDown,!0);
      if(modalOverlay&&modalOverlay.removeEventListener)modalOverlay.removeEventListener('click',onPreparationBackdrop,!0);
      if(setupCancelBtn&&setupCancelBtn.removeEventListener)setupCancelBtn.removeEventListener('click',onPreparationCancel,!0);
      if(modalContent&&modalContent._modalCleanup===cancelPreparation)modalContent._modalCleanup=restoreSetupCleanup?setupCleanup:null;
      if(captureBtn){captureBtn._capturePreparing=!1;captureBtn.disabled=!1;captureBtn.textContent='当前画面截图'}
      endCaptureUi(cancelPreparation,previousFocus);
    }
    function cancelPreparation(){
      if(cancelled)return;cancelled=!0;
      if(setupCleanup)setupCleanup();else if(modalOverlay&&modalOverlay.classList)modalOverlay.classList.remove('show');
      releasePreparation(!1);
    }
    function onPreparationKeyDown(e){if(e.key==='Escape'){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();cancelPreparation()}}
    function onPreparationBackdrop(e){if(e.target===modalOverlay){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();cancelPreparation()}}
    function onPreparationCancel(e){if(e.preventDefault)e.preventDefault();if(e.stopPropagation)e.stopPropagation();cancelPreparation()}
    if(modalContent&&setupCleanup)modalContent._modalCleanup=cancelPreparation;
    if(document.addEventListener)document.addEventListener('keydown',onPreparationKeyDown,!0);
    if(modalOverlay&&modalOverlay.addEventListener)modalOverlay.addEventListener('click',onPreparationBackdrop,!0);
    if(setupCancelBtn&&setupCancelBtn.addEventListener)setupCancelBtn.addEventListener('click',onPreparationCancel,!0);
    previousFocus=beginCaptureUi(cancelPreparation);
    showToast('正在生成 100% 截图画面…');
    const stillOpen=()=>!modalOverlay||!modalOverlay.classList||!modalOverlay.classList.contains||modalOverlay.classList.contains('show');
    const stillCurrent=()=>!captureBtn||!modalContent||!modalContent.contains||modalContent.contains(captureBtn);
    const analyze=async function(){
      try{
        const visibleSource=getVisibleCaptureSource();
        if(!visibleSource)throw new Error('current page is not ready');
        const canonicalSource=await buildCanonicalCaptureSource(visibleSource);
        if(cancelled||!stillOpen()||!stillCurrent())return;
        const capture=recommendVisibleCoverCrop(canonicalSource);
        if(!capture||!capture.dataUrl)throw new Error('canonical recommendation unavailable');
        if(setupCleanup)setupCleanup();
        releasePreparation(!1);
        showCoverRecommendation(sid,capture);
      }catch(e){if(!cancelled&&stillOpen()&&stillCurrent()){console.warn('canonical capture fail',e);showToast('100% 画面生成失败，请重试')}}
      finally{if(!preparationClosed)releasePreparation(!cancelled&&stillOpen()&&stillCurrent())}
    };
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(analyze);else setTimeout(analyze,0);
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
async function setSeriesCover(sid,dataUrl,options){
  try{
    if(!dataUrl)return false;
    await db.saveCover(sid,dataUrl);covers[sid]=dataUrl;
    if(!currentSeries)renderBookshelf();
    showToast(options&&options.successMessage||'封面已设置');
    return true;
  }catch(e){showToast(options&&options.errorMessage||'设置失败');return false}
}
function showAddModal(){showModal('add-choose')}
function showModal(type,data){
  const ov=$('modal-overlay'),mc=$('modal-content');let title='',body='',actions='';
  if(mc._modalCleanup)mc._modalCleanup();
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
  let modalClosed=false;
  function closeModal(){if(modalClosed)return;modalClosed=true;ov.classList.remove('show');ov.removeEventListener('click',onOverlayClick);if(cancelBtn)cancelBtn.onclick=null;if(confirmBtn)confirmBtn.onclick=null;if(mc._modalCleanup===closeModal)mc._modalCleanup=null}
  if(cancelBtn)cancelBtn.onclick=closeModal;const resetCoverBtn=Qs('#modal-reset-cover',mc);if(resetCoverBtn)resetCoverBtn.onclick=async function(){closeModal();showToast('正在重新生成封面…');await autoPickCover(data.sid,null,null);showToast('封面已恢复默认')};const makeTextBtn=Qs('#cover-make-text',mc);if(makeTextBtn)makeTextBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');if(d){setSeriesCover(data.sid,d);closeModal();}};const uploadCoverBtn=Qs('#cover-upload',mc);if(uploadCoverBtn)uploadCoverBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}};const skipCoverBtn=Qs('#modal-skip-cover',mc);if(skipCoverBtn)skipCoverBtn.onclick=function(){closeModal();showToast('使用默认封面');autoPickCover(data.sid,null,null)};const selTextBtn=Qs('#cover-sel-text',mc);if(selTextBtn)selTextBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');if(d){setSeriesCover(data.sid,d);closeModal();}};const selUploadBtn=Qs('#cover-sel-upload',mc);if(selUploadBtn)selUploadBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}};
  function onOverlayClick(e){if(e.target===ov)closeModal()}ov.addEventListener('click',onOverlayClick);mc._modalCleanup=closeModal;
  if(type==='add-choose'){if(!confirmBtn)return;confirmBtn.onclick=async function(){let r=Qs('input[name="addType"]:checked',mc),isNew=!r||r.value==='new';closeModal();try{let files;if(_pendingFiles&&_pendingFiles.length){files=_pendingFiles;_pendingFiles=null}else{if(hasFolderPicker&&_pendingFilesMode!=='input')files=await pickFolder();else files=await pickFilesViaInput()}if(!files||!files.length)return;if(isNew){_pendingFiles=files;_pendingFilesMode='drop';showModal('add-name')}else{let sel=Qs('#modal-existing-select',mc);if(!sel){showToast('没有可用的系列');return}let sid=sel.value;if(sid)await importFilesToSeries(sid,files);else showToast('没有可用的系列')}}catch(e){console.error(e);showToast('操作失败')}}}
  else if(type==='add-name'){if(!confirmBtn)return;confirmBtn.onclick=async function(){let ni=$('modal-name');if(!ni){closeModal();return}let name=ni.value.trim();if(!name){showToast('请输入名称');return}closeModal();let files=_pendingFiles;_pendingFiles=null;if(files)await createSeries(name,files);else showToast('未找到文件，请重新选择')};setTimeout(()=>{let inp=$('modal-name');if(inp){inp.focus();inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&confirmBtn)confirmBtn.click()})}},100)}
  else if(type==='delete-confirm'){if(!confirmBtn)return;confirmBtn.onclick=function(){let dc=Qs('#modal-delete-cache',mc),shouldDelete=dc?dc.checked:!0;closeModal();let idx=bookshelf.findIndex(s=>s.seriesId===data.id);if(idx>=0){let s=bookshelf[idx];if(currentSeries===data.id)closeReader();bookshelf.splice(idx,1);renderBookshelf();delete covers[data.id];showToast('已删除「'+s.name+'」');// Background async cleanup
(async()=>{if(shouldDelete){try{await db.deleteSeriesPDFs(data.id)}catch(e){}try{await db.deleteCover(data.id)}catch(e){}}try{await db.deleteSeries(data.id)}catch(e){}})()}}}
  else if(type==='cache-mgr'){setTimeout(()=>{mc.querySelectorAll('.cache-clear-btn').forEach(btn=>{btn.addEventListener('click',async function(){let sid=this.dataset.sid,s=findSeries(sid),name=s?s.name:sid;try{await db.deleteSeriesPDFs(sid);await db.deleteCover(sid);delete covers[sid];showToast('已清除「'+name+'」的缓存');renderBookshelf()}catch(e){showToast('清除失败')}let stats=await db.getCacheStats(),si=await db.getStorageEstimate();closeModal();showModal('cache-mgr',{stats,storageInfo:si})})})},100)}
  else if(type==='settings'){const saveBtn=Qs('#modal-save-settings',mc);if(saveBtn)saveBtn.onclick=async function(){let z=$('setting-zoom').value,d=$('setting-direction').value,dp=$('setting-dual').value==='1',sb=$('setting-sidebar').value==='1',t=$('setting-theme').value,wa=$('setting-webtoon').value==='1',zoomChanged=settings.zoom!==z,viewState=zoomChanged?captureReaderViewState():null;Object.assign(settings,{zoom:z,direction:d,dualPage:dp,sidebarOpen:sb,theme:t,webtoonAuto:wa});fitWidth=z==='fit';if(!fitWidth)zoom=parseFloat(z);$('zoom-select').value=z;if(zoomChanged)reRenderAll(viewState);document.documentElement.setAttribute('data-theme',t);await db.saveSetting('zoom',z);await db.saveSetting('direction',d);await db.saveSetting('dualPage',dp);await db.saveSetting('sidebarOpen',sb);await db.saveSetting('theme',t);await db.saveSetting('webtoonAuto',wa);closeModal();showToast('设置已保存')};if(cancelBtn)cancelBtn.onclick=closeModal}
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
function openSeries(id){let s=findSeries(id);if(!s)return;currentSeries=id;chapters=s.chapters;currentChIdx=-1;currentPage=1;isWebtoon=!1;webtoonScrollPct=0;restoringProgress=!1;renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;renderedPages.clear();prefetchQueue=[];prefetching=!1;chapterLoadToken++;(function fadeOpen(){let bs=$('bookshelf'),rd=$('reader');bs.style.transition='opacity .2s ease';bs.style.opacity='0';setTimeout(function(){bs.classList.add('hidden');bs.style.opacity='';rd.classList.remove('hidden');rd.style.opacity='0';void rd.offsetWidth;rd.style.transition='opacity .2s ease';rd.style.opacity='1'},200)})();$('ch-info').textContent=s.name+' — 共 '+chapters.length+' 章';$('ch-count').textContent=chapters.length+' 章';$('page-info').textContent='- / -';$('page-container').innerHTML='';renderChapterList();if(chapters.length>0){let si=0;if(s.lastChNum){let f=chapters.findIndex(c=>c.chapterNum===s.lastChNum);if(f>=0)si=f}const restoreState=s.lastPage&&chapters[si]&&s.lastChNum===chapters[si].chapterNum?{page:s.lastPage,pageProgress:s.lastPageProgress}:null;loadChapter(si,restoreState)}}

function closeReader(){// Fire-and-forget: UI first, save in background
  let s=null;if(currentSeries){s=findSeries(currentSeries);if(s&&currentChIdx>=0&&currentChIdx<chapters.length){s.lastChNum=chapters[currentChIdx].chapterNum;s.lastPage=isWebtoon?getScrollProgress():currentPage;if(!isWebtoon){let ratio=getNormalPageProgress();if(ratio!==null)s.lastPageProgress=ratio}if(chapters[currentChIdx].status==='reading')chapters[currentChIdx].status='read'}}
  chapterLoadToken++;markCaptureCanvasesIneligible($('page-container'));renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;currentSeries=null;chapters=[];currentChIdx=-1;isWebtoon=!1;renderedPages.clear();
  (function fadeClose(){let rd=$('reader'),bs=$('bookshelf');rd.style.transition='opacity .2s ease';rd.style.opacity='0';setTimeout(function(){rd.classList.add('hidden');rd.style.opacity='';$('page-container').innerHTML='';bs.classList.remove('hidden');bs.style.opacity='0';void bs.offsetWidth;bs.style.transition='opacity .2s ease';bs.style.opacity='1';renderBookshelf()},200)})();
  if(s)saveSeriesBg(s);
}

function renderChapterList(){const cl=$('chapter-list');cl.innerHTML=chapters.map((c,i)=>{let lab=c.chapterNum!==Infinity?'第'+String(c.chapterNum)+'话':'?',dot='<span class="ch-dot dot-'+c.status+'"></span>',wTag=c.isWebtoon?'<span class="ch-type">条漫</span>':'',cls=c.status==='read'?'chapter-item read-item':'chapter-item';return '<div class="'+cls+'" data-idx="'+i+'">'+dot+'<span class="ch-num">'+lab+'</span><span class="ch-name">'+c.name+'</span>'+wTag+'</div>'}).join('');$('ch-count').textContent=chapters.length+' 章';cl.querySelectorAll('.chapter-item').forEach(e=>e.addEventListener('click',function(){loadChapter(parseInt(this.dataset.idx))}))}
function highlightChapter(i){const cl=$('chapter-list');cl.querySelectorAll('.chapter-item').forEach(e=>e.classList.remove('active'));let e=cl.querySelector('[data-idx="'+i+'"]');if(e){e.classList.add('active');e.scrollIntoView({block:'nearest',behavior:'smooth'})}}
function setChapterStatus(i,status){let c=chapters[i];if(c)c.status=status;let el=$('chapter-list').querySelector('[data-idx="'+i+'"] .ch-dot');if(el)el.className='ch-dot dot-'+status}

// Webtoon detection
function detectWebtoon(){if(!pdfDoc||!settings.webtoonAuto)return!1;try{for(let p=1;p<=Math.min(pdfDoc.numPages,3);p++){let pg=pdfDoc.getPage(p);if(pg){let vp=pg.getViewport({scale:1});if(vp.height/vp.width>3)return!0}}}catch(e){console.warn('webtoon detect fail',e)}return!1}
function getScrollProgress(){let va=$('viewer-area'),pc=$('page-container');if(!va||!pc)return 0;let top=va.scrollTop,maxH=Math.max(pc.scrollHeight-va.clientHeight,1);return Math.round(top/maxH*100)}
function restoreTokenIsCurrent(token){if(token&&typeof token==='object')return token.chapter===chapterLoadToken&&token.view===viewRestoreGeneration;return token===chapterLoadToken}
function restoreWebtoonScroll(pct,token){return new Promise(resolve=>{let started=Date.now();function apply(){let va=$('viewer-area'),pc=$('page-container');if(token!==undefined&&!restoreTokenIsCurrent(token)){resolve(!1);return}if(!va||!pc){resolve(!1);return}let maxH=pc.scrollHeight-va.clientHeight;if(maxH>0||Date.now()-started>=2000){va.scrollTop=Math.max(maxH,1)*pct/100;resolve(!0);return}setTimeout(apply,16)}apply()})}
function getNormalPageAtAnchor(){if(isWebtoon)return currentPage;let va=$('viewer-area'),pc=$('page-container');if(!va||!pc)return currentPage;let cr=va.getBoundingClientRect(),my=cr.top+cr.height*.3,ws=pc.querySelectorAll('.page-wrapper'),bp=currentPage,bd=Infinity;for(let w of ws){let r=w.getBoundingClientRect();if(!(r.height>0))continue;let d=Math.abs(r.top-my);if(d<bd){bd=d;bp=parseInt(w.dataset.page)}}return bp}
function getNormalPageProgressAt(page){if(!window.ReadingProgress||isWebtoon)return null;let va=$('viewer-area'),w=$('page-container').querySelector('[data-page="'+page+'"]');if(!va||!w)return null;return window.ReadingProgress.pageRatioAtAnchor(va.getBoundingClientRect(),w.getBoundingClientRect())}
function getNormalPageProgress(){return getNormalPageProgressAt(currentPage)}
function captureReaderViewState(){if(!pdfDoc)return null;if(isWebtoon)return{isWebtoon:!0,scrollProgress:getScrollProgress()};let page=getNormalPageAtAnchor();return{isWebtoon:!1,page:page,pageProgress:getNormalPageProgressAt(page)}}
async function restoreNormalPageProgress(state,token){if(!state||isWebtoon||!pdfDoc)return!1;let page=Math.max(1,Math.min(pdfDoc.numPages,parseInt(state.page,10)||1));for(let p=1;p<=page;p++){if(!restoreTokenIsCurrent(token))return!1;await renderPage(p)}if(!restoreTokenIsCurrent(token))return!1;let va=$('viewer-area'),w=$('page-container').querySelector('[data-page="'+page+'"]');if(!va||!w)return!1;currentPage=page;$('page-slider').value=page;updatePageInfo();if(page===pdfDoc.numPages)setChapterStatus(currentChIdx,'read');let ratio=window.ReadingProgress.normalizePageRatio(state.pageProgress);if(ratio===null)w.scrollIntoView({behavior:'auto',block:'start'});else{let vr=va.getBoundingClientRect();vr={top:vr.top,height:vr.height,scrollTop:va.scrollTop};let target=window.ReadingProgress.scrollTopForPageRatio(vr,w.getBoundingClientRect(),ratio),maxTop=Math.max(0,va.scrollHeight-va.clientHeight);if(target!==null)va.scrollTop=Math.max(0,Math.min(maxTop,target))}return!0}

async function loadChapter(i,restoreState){
  if(i<0||i>=chapters.length)return;if(currentChIdx>=0&&currentChIdx<chapters.length&&currentChIdx!==i&&chapters[currentChIdx].status==='reading')setChapterStatus(currentChIdx,'read');
  markCaptureCanvasesIneligible($('page-container'));renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;renderedPages.clear();isWebtoon=!1;webtoonScrollPct=0;
  const myToken=++chapterLoadToken;restoringProgress=!1;currentChIdx=i;let c=chapters[i];setChapterStatus(i,'reading');
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
  for(let p=1;p<=c.pages;p++){let w=document.createElement('div');w.className='page-wrapper';w.dataset.page=p;w.dataset.captureRenderState='idle';let cv=document.createElement('canvas');cv.dataset.captureRenderState='idle';w.appendChild(cv);let l=document.createElement('div');l.className='page-label';l.textContent=isWebtoon?'':(p+' / '+c.pages);pc.appendChild(w);pc.appendChild(l)}
  $('viewer-area').scrollTop=0;
  if(restoreState&&!isWebtoon){
    restoringProgress=!0;
    try{await restoreNormalPageProgress(restoreState,myToken)}finally{if(myToken===chapterLoadToken)restoringProgress=!1}
  }else if(restoreState&&isWebtoon){
    restoringProgress=!0;
    renderVisiblePages();
    try{await restoreWebtoonScroll(restoreState.page,myToken)}finally{if(myToken===chapterLoadToken)restoringProgress=!1}
  }
  if(myToken!==chapterLoadToken)return;
  renderVisiblePages();
  if(!restoreState||isWebtoon)saveProgress();
  prefetchNextSafe(i);
}

function prefetchNextSafe(idx){let n1=idx+1,n2=idx+2;if(n1<chapters.length&&chapters[n1].cached&&!chapters[n1].loaded&&!prefetchQueue.includes(n1))prefetchQueue.push(n1);if(n2<chapters.length&&chapters[n2].cached&&!chapters[n2].loaded&&!prefetchQueue.includes(n2))prefetchQueue.push(n2);if(!prefetching)drainPrefetchSafe()}
async function drainPrefetchSafe(){prefetching=!0;while(prefetchQueue.length>0){let i=prefetchQueue.shift();if(i>=chapters.length)continue;let c=chapters[i];if(c.loaded||!c.cached)continue;if(Math.abs(i-currentChIdx)>5)continue;try{let ab=await db.loadPDF(currentSeries,c.chapterNum),doc=await pdfjsLib.getDocument({data:ab}).promise;c.pages=doc.numPages;doc.destroy()}catch(e){console.warn('Prefetch fail:',c.name)}}prefetching=!1}

async function renderPage(pn){
  if(!pdfDoc||renderedPages.has(pn))return;
  const w=$('page-container').querySelector('[data-page="'+pn+'"]');if(!w)return;
  const cv=w.querySelector('canvas');if(!cv)return;
  const renderVersion=setCaptureRenderState(cv,'rendering');renderedPages.add(pn);
  try{
    const pg=await pdfDoc.getPage(pn);if(cv._captureRenderVersion!==renderVersion)return;
    const vp=pg.getViewport({scale:zoom});let task;
    if(fitWidth){let cw=$('viewer-area').clientWidth-40,sc=cw/vp.width,fvp=pg.getViewport({scale:sc});cv.width=fvp.width;cv.height=fvp.height;task=pg.render({canvasContext:cv.getContext('2d'),viewport:fvp})}
    else{cv.width=vp.width;cv.height=vp.height;task=pg.render({canvasContext:cv.getContext('2d'),viewport:vp})}
    renderTasks.push(task);await task.promise;
    if(setCaptureRenderState(cv,'complete',renderVersion)!==null)w.style.width=cv.style.width||cv.width+'px';
  }catch(e){
    if(setCaptureRenderState(cv,'idle',renderVersion)!==null)renderedPages.delete(pn);
    throw e;
  }
}
function renderVisiblePages(){if(!pdfDoc)return;let cr=$('viewer-area').getBoundingClientRect(),ws=$('page-container').querySelectorAll('.page-wrapper'),tr=[];for(let w of ws){let r=w.getBoundingClientRect();if(r.bottom>=cr.top-400&&r.top<=cr.bottom+400){let p=parseInt(w.dataset.page);if(!renderedPages.has(p))tr.push(p)}}for(let i=0;i<tr.length;i+=3)tr.slice(i,i+3).forEach(p=>renderPage(p))}
function reRenderAll(viewState){markCaptureCanvasesIneligible($('page-container'));renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];renderedPages.clear();if(!viewState||!pdfDoc){renderVisiblePages();return}const viewToken=++viewRestoreGeneration,token={chapter:chapterLoadToken,view:viewToken};restoringProgress=!0;let pending;if(viewState.isWebtoon){renderVisiblePages();pending=restoreWebtoonScroll(viewState.scrollProgress,token)}else pending=restoreNormalPageProgress(viewState,token);Promise.resolve(pending).catch(e=>console.warn('restore zoom anchor failed',e)).finally(()=>{if(token.chapter!==chapterLoadToken||token.view!==viewRestoreGeneration)return;restoringProgress=!1;renderVisiblePages()})}

function goToPage(n,options){if(!pdfDoc||isWebtoon)return;options=options||{};n=Math.max(1,Math.min(pdfDoc.numPages,n));currentPage=n;$('page-slider').value=n;updatePageInfo();let w=$('page-container').querySelector('[data-page="'+n+'"]');if(w)w.scrollIntoView({behavior:options.behavior||'smooth',block:'start'});if(n===pdfDoc.numPages)setChapterStatus(currentChIdx,'read');if(!options.suppressSave)saveProgress(0)}
function nextPage(){if(!pdfDoc)return;if(isWebtoon){scrollWebtoon(.5);return}if(currentPage<pdfDoc.numPages)goToPage(currentPage+1);else nextChapter()}
function prevPage(){if(!pdfDoc)return;if(isWebtoon){scrollWebtoon(-.5);return}if(currentPage>1)goToPage(currentPage-1);else prevChapter()}
function scrollWebtoon(dir){let va=$('viewer-area'),h=va.clientHeight*.7;va.scrollBy({top:dir*h,behavior:'smooth'})}
async function nextChapter(){if(currentChIdx+1<chapters.length){setChapterStatus(currentChIdx,'read');await loadChapter(currentChIdx+1);showToast('▶ 第'+chapters[currentChIdx].chapterNum+'话')}else showToast('已经是最后一章了')}
async function prevChapter(){if(currentChIdx>0){setChapterStatus(currentChIdx,'read');await loadChapter(currentChIdx-1);if(!isWebtoon)goToPage(chapters[currentChIdx].pages||1);showToast('◀ 第'+chapters[currentChIdx].chapterNum+'话')}else showToast('已经是第一章了')}
function updateNavButtons(){$('btn-prev-ch').disabled=currentChIdx<=0;$('btn-next-ch').disabled=currentChIdx>=chapters.length-1}
function updatePageInfo(){if(!pdfDoc){$('page-info').textContent='- / -';return}if(isWebtoon){$('page-info').textContent='滚动 '+getScrollProgress()+'%'}else{$('page-info').textContent=currentPage+' / '+pdfDoc.numPages}}
async function saveProgress(pageProgressOverride){if(currentChIdx<0||!currentSeries||restoringProgress)return;let s=findSeries(currentSeries);if(s){s.lastChNum=chapters[currentChIdx].chapterNum;s.lastPage=isWebtoon?getScrollProgress():currentPage;if(!isWebtoon){let ratio=pageProgressOverride===undefined?getNormalPageProgress():window.ReadingProgress.normalizePageRatio(pageProgressOverride);if(ratio!==null)s.lastPageProgress=ratio}saveSeriesBg(s)}}

// ===== Event Bindings =====
$('viewer-area').addEventListener('scroll',()=>{if(scrollTimer)clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(!pdfDoc)return;if(!isWebtoon){let cr=$('viewer-area').getBoundingClientRect(),my=cr.top+cr.height*.3,ws=$('page-container').querySelectorAll('.page-wrapper'),bp=currentPage,bd=Infinity;for(let w of ws){let r=w.getBoundingClientRect();if(!(r.height>0))continue;let d=Math.abs(r.top-my);if(d<bd){bd=d;bp=parseInt(w.dataset.page)}}if(bp!==currentPage){currentPage=bp;$('page-slider').value=currentPage;updatePageInfo()}saveProgress()}else{updatePageInfo();saveProgress();if(getScrollProgress()>=99&&currentChIdx<chapters.length){chapters[currentChIdx].status='read'}}renderVisiblePages()},150)});
$('page-slider').addEventListener('input',function(){goToPage(parseInt(this.value))});
$('zoom-select').addEventListener('change',function(){let viewState=captureReaderViewState(),v=this.value;fitWidth=v==='fit';if(!fitWidth)zoom=parseFloat(v);reRenderAll(viewState);settings.zoom=v;db.saveSetting('zoom',v)});
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

function handleReaderKeyDown(e){if(captureUiActive)return;if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;switch(e.key){
  case'ArrowRight':case'd':e.preventDefault();nextPage();break;case'ArrowLeft':case'a':e.preventDefault();prevPage();break;
  case'ArrowDown':case's':e.preventDefault();nextChapter();break;case'ArrowUp':case'w':e.preventDefault();prevChapter();break;
  case'f':e.preventDefault();let viewState=captureReaderViewState();$('zoom-select').value='fit';fitWidth=!0;reRenderAll(viewState);break;
  case'b':e.preventDefault();$('sidebar').classList.toggle('hidden');break;case'Escape':e.preventDefault();closeReader();break}}
document.addEventListener('keydown',handleReaderKeyDown);

function preventAndStop(e){e.preventDefault();e.stopPropagation()}
document.addEventListener('dragover',function(e){preventAndStop(e);$('drop-overlay').classList.add('show')});
document.addEventListener('dragenter',function(e){preventAndStop(e);$('drop-overlay').classList.add('show')});
document.addEventListener('dragleave',function(e){preventAndStop(e);$('drop-overlay').classList.remove('show')});
document.addEventListener('drop',function(e){preventAndStop(e);$('drop-overlay').classList.remove('show');if(e.dataTransfer)dropHandler(e.dataTransfer)});

async function dropHandler(dt){try{let pdfs=[];if(dt.files&&dt.files.length>0){let fp=Array.from(dt.files).filter(f=>f&&f.name&&f.name.toLowerCase().endsWith('.pdf'));if(fp.length>0)pdfs=fp}if(pdfs.length===0&&dt.items&&dt.items.length>0){if(window.location.protocol==='file:'&&dt.items.length>0){let hasDir=!1;for(let it of Array.from(dt.items)){if(it&&it.kind==='file'){let en=null;try{en=it.webkitGetAsEntry?it.webkitGetAsEntry():null}catch(e){}if(en&&en.isDirectory){hasDir=!0;break}}}if(hasDir){showToast('检测到文件夹拖入。请使用「启动阅读器.bat」以 http://localhost 方式打开，或点击按钮选择文件夹');return}}let fs=[],es=[];for(let it of Array.from(dt.items)){if(!it||it.kind!=='file')continue;let en=null;try{en=it.webkitGetAsEntry?it.webkitGetAsEntry():null}catch(e){}if(en)es.push(en);else{try{let f=it.getAsFile();if(f)fs.push(f)}catch(e){}}}let allFiles=[...fs];for(let e of es){try{await collectFiles(e,allFiles)}catch(e){}}pdfs=allFiles.filter(f=>f&&f.name&&f.name.toLowerCase().endsWith('.pdf'))}if(!pdfs.length){showToast('未找到PDF文件');return}showToast('已接收 '+pdfs.length+' 个 PDF 文件');_pendingFiles=pdfs;_pendingFilesMode='drop';if(currentSeries){await importFilesToSeries(currentSeries,pdfs)}else{showModal('add-choose')}}catch(err){console.error('Drop handler error:',err);showToast('拖拽处理失败')}}
async function collectFiles(entry,out){if(!entry)return;if(entry.isFile){out.push(await new Promise((r,rj)=>entry.file(r,rj)))}else if(entry.isDirectory){let rd=entry.createReader(),batch;do{batch=await new Promise((r,rj)=>rd.readEntries(r,rj));for(let e of batch)await collectFiles(e,out)}while(batch.length>0)}}

function showToast(m){let t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._timeout);t._timeout=setTimeout(function(){t.classList.remove('show')},2000)}
window.addEventListener('resize',function(){if(fitWidth)reRenderAll(captureReaderViewState());const g=Qs('bs-grid');if(g&&g.dataset.count)applyRackSizing(parseInt(g.dataset.count||'0',10))});
document.addEventListener('contextmenu',function(e){let card=e.target.closest('.rack-book');if(!card)return;e.preventDefault();let sid=card.dataset.id,s=findSeries(sid);if(s)showModal('delete-confirm',{id:sid,name:s.name})});
initApp().then(()=>console.log('📚 v10 — interactive rack + import cover select'));
