'use strict';

let bookshelf=[],currentSeries=null,chapters=[],currentChIdx=-1,currentPage=1;
let pdfDoc=null,renderTasks=[],zoom=1.5,fitWidth=!1;
let renderedPages=new Set,scrollTimer=null;
let prefetchQueue=[],prefetching=!1;
let chapterLoadToken=0,hasFolderPicker=!1;
let _pendingFiles=null,_pendingFilesMode='drop',_importBusy=!1;
let sessionPDFCache=new Map(); // 导入后的会话内直读缓存：绕开 IndexedDB 读取环节，iOS Safari 兼容
function pdfHeaderOk(ab){try{if(!ab||ab.byteLength<10)return !1;if(String.fromCharCode.apply(null,new Uint8Array(ab.slice(0,5)))!=='%PDF-')return !1;return String.fromCharCode.apply(null,new Uint8Array(ab.slice(Math.max(0,ab.byteLength-2048)))).indexOf('%%EOF')!==-1}catch(e){return !1}}
let covers={};
let settings={zoom:/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)?'fit':'1.5',direction:'scroll',dualPage:!1,sidebarOpen:!0,theme:'night',webtoonAuto:!0,groups:[]};
let searchQuery='',sortMode='recent';
const UNGROUPED_GROUP_ID='__ungrouped__';
let activeGroupId=null;
let isWebtoon=!1,webtoonScrollPct=0;let rackPage=0;
let rackHoverIndex=-1,rackHoverPending=null,rackHoverTimer=null,rackHoverToken=0,rackHoverBound=!1,rackOverlay=null;
let rackMotionFrame=0,rackMotionLast=0,rackMotionSpeed=1;
let captureUiActive=!1;
let restoringProgress=!1,viewRestoreGeneration=0;
let pendingZoomValue=null,zoomChangeRun=null;

function $(id){return document.getElementById(id)}
function Qs(sel,el){return el?el.querySelector(sel):document.querySelector(sel)}

async function initApp(){
  if(window.location.protocol==='file:'){
    try{
      const localServer=await fetch('http://localhost:8765/',{cache:'no-store'});
      if(localServer.ok){window.location.replace('http://localhost:8765/');return}
    }catch(e){}
  }
  if(window.ManhwaPWA)ManhwaPWA.init();
  if(typeof indexedDB==='undefined'){$('bookshelf').style.display='none';$('browser-warning').classList.add('show');return}
  $('browser-warning').style.display='none';
  hasFolderPicker=typeof window.showDirectoryPicker==='function'&&!/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if(hasFolderPicker){try{$('bs-add-btn').style.display='';$('btn-add-folder-reader').style.display=''}catch(e){}let h=$('drag-hint');if(h){h.className='';h.textContent='也可以将 PDF 文件或文件夹拖入窗口'}}
  else{try{$('bs-add-btn').style.display='';$('btn-add-folder-reader').style.display='none'}catch(e){}let h=$('drag-hint');if(h){h.className='prominent';h.textContent='点击「添加漫画」或直接将 PDF 文件拖入此窗口'}}
  try{const s=await db.getSettings();if(Object.keys(s).length>0)Object.assign(settings,s)}catch(e){}
  if(!Array.isArray(settings.groups))settings.groups=[];
  settings.groups=settings.groups.filter(g=>g&&g.id&&String(g.name||'').trim()).map(g=>({id:String(g.id),name:String(g.name).trim(),createdAt:g.createdAt||new Date().toISOString()}));
  fitWidth=settings.zoom==='fit';if(!fitWidth)zoom=parseFloat(settings.zoom)||1;
  $('zoom-select').value=settings.zoom;
  if(settings.sidebarOpen===!1||window.matchMedia&&window.matchMedia('(max-width:780px)').matches)$('sidebar').classList.add('hidden');
  // Apply theme
  try{document.documentElement.setAttribute('data-theme',settings.theme||'night')}catch(e){}
  // Migrate
  const raw=localStorage.getItem('manhwa-bookshelf');if(raw){try{await db.migrateFromLocalStorage();showToast('已迁移旧数据')}catch(e){}}
  const oldP=localStorage.getItem('manhwa-reader-progress');if(oldP)localStorage.removeItem('manhwa-reader-progress');
  bookshelf=(await db.loadBookshelf()).map(s=>db.normalizeSeries(s));
  const staleGroupSeries=bookshelf.filter(s=>s.groupId&&!getGroupById(s.groupId));
  if(staleGroupSeries.length){staleGroupSeries.forEach(s=>{s.groupId=null});await Promise.all(staleGroupSeries.map(s=>db.saveSeries(s).catch(()=>{})))}
  try{const ac=await db.loadAllCovers();covers={};ac.forEach(c=>{covers[c.seriesId]=c.dataUrl})}catch(e){}
  await Promise.all(bookshelf.filter(s=>!covers[s.seriesId]).map(s=>persistTextCover(s.seriesId,s.name,{refresh:false})));
  console.log('Loaded '+bookshelf.length+' series, theme='+settings.theme+', webtoonAuto='+settings.webtoonAuto);
  renderBookshelf();
  refreshLegacyTextCovers();
}

function getGroupById(id){return settings.groups.find(g=>g.id===id)||null}
function getActiveGroupLabel(){
  if(activeGroupId===UNGROUPED_GROUP_ID)return '未分组';
  const group=getGroupById(activeGroupId);
  return group?group.name:'全部漫画';
}
function seriesInActiveGroup(series){
  if(activeGroupId===UNGROUPED_GROUP_ID)return !series.groupId;
  if(activeGroupId)return series.groupId===activeGroupId;
  return true;
}
function escapeHTML(value){return String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
let groupRailBound=false;
let groupRailObserver=null;
let groupRailMutationObserver=null;
let groupRailMeasureFrame=0;
function measureGroupRailContentWidth(bar){
  if(!bar||!bar.children.length)return 0;
  const styles=getComputedStyle(bar);
  const horizontalPadding=(parseFloat(styles.paddingLeft)||0)+(parseFloat(styles.paddingRight)||0);
  const compactPadding=Math.min(4,horizontalPadding);
  const childRects=[...bar.children].map(child=>child.getBoundingClientRect()).filter(rect=>rect.width>0);
  const childSpan=childRects.length?Math.max(...childRects.map(rect=>rect.right))-Math.min(...childRects.map(rect=>rect.left)):0;
  const scrollContent=Math.max(0,bar.scrollWidth-horizontalPadding+compactPadding);
  return Math.max(Math.ceil(childSpan+compactPadding),Math.ceil(scrollContent));
}
function scheduleGroupRailMeasurement(){
  if(groupRailMeasureFrame)return;
  const frame=callback=>typeof window!=='undefined'&&typeof window.requestAnimationFrame==='function'?window.requestAnimationFrame(callback):setTimeout(callback,0);
  groupRailMeasureFrame=frame(()=>{
    groupRailMeasureFrame=frame(()=>{
      groupRailMeasureFrame=0;
      updateGroupRail();
    });
  });
}
function updateGroupRail(){
  const rail=$('bs-group-rail'),bar=$('bs-groups'),prev=$('bs-group-prev'),next=$('bs-group-next');
  if(!rail||!bar||!prev||!next)return;
  const contentWidth=measureGroupRailContentWidth(bar);
  const overflow=contentWidth>bar.clientWidth+1;
  rail.classList.toggle('has-overflow',overflow);
  const maxScroll=Math.max(0,bar.scrollWidth-bar.clientWidth);
  prev.disabled=!overflow||bar.scrollLeft<=1;
  next.disabled=!overflow||bar.scrollLeft>=maxScroll-1;
}
function bindGroupRail(){
  if(groupRailBound)return;
  const rail=$('bs-group-rail'),bar=$('bs-groups'),prev=$('bs-group-prev'),next=$('bs-group-next');
  if(!rail||!bar||!prev||!next)return;
  groupRailBound=true;
  const scrollByViewport=direction=>bar.scrollBy({left:direction*Math.max(140,Math.round(bar.clientWidth*.72)),behavior:'smooth'});
  prev.addEventListener('click',()=>scrollByViewport(-1));
  next.addEventListener('click',()=>scrollByViewport(1));
  bar.addEventListener('scroll',updateGroupRail,{passive:true});
  bar.addEventListener('wheel',function(e){
    if(bar.scrollWidth<=bar.clientWidth+1||Math.abs(e.deltaY)<=Math.abs(e.deltaX))return;
    e.preventDefault();bar.scrollLeft+=e.deltaY;
  },{passive:false});
  const reschedule=()=>scheduleGroupRailMeasurement();
  window.addEventListener('resize',reschedule,{passive:true});
  if(typeof ResizeObserver==='function'){
    groupRailObserver=new ResizeObserver(reschedule);
    groupRailObserver.observe(rail);
    groupRailObserver.observe(bar);
  }
  if(typeof MutationObserver==='function'){
    groupRailMutationObserver=new MutationObserver(reschedule);
    groupRailMutationObserver.observe(bar,{childList:!0,subtree:!0,characterData:!0,attributes:!0,attributeFilter:['class','style']});
  }
  if(document.fonts){
    if(document.fonts.ready&&typeof document.fonts.ready.then==='function')document.fonts.ready.then(reschedule).catch(()=>{});
    if(typeof document.fonts.addEventListener==='function')document.fonts.addEventListener('loadingdone',reschedule);
  }
}
function renderGroupBar(){
  const bar=$('bs-groups'),rail=$('bs-group-rail');
  if(!bar)return;
  if(rail)rail.hidden=settings.groups.length===0&&activeGroupId===null;
  bindGroupRail();
  const counts={};
  bookshelf.forEach(s=>{const key=s.groupId||UNGROUPED_GROUP_ID;counts[key]=(counts[key]||0)+1});
  const isActive=id=>activeGroupId===id;
  let html='<button class="bs-group-tab'+(isActive(null)?' active':'')+'" data-group-id="">全部 <span class="bs-group-count">'+bookshelf.length+'</span></button>';
  html+='<button class="bs-group-tab'+(isActive(UNGROUPED_GROUP_ID)?' active':'')+'" data-group-id="'+UNGROUPED_GROUP_ID+'">未分组 <span class="bs-group-count">'+(counts[UNGROUPED_GROUP_ID]||0)+'</span></button>';
  settings.groups.forEach(g=>{
    html+='<button class="bs-group-tab'+(isActive(g.id)?' active':'')+'" data-group-id="'+escapeHTML(g.id)+'" data-group-context="'+escapeHTML(g.id)+'" title="右键管理此分组">'+escapeHTML(g.name)+' <span class="bs-group-count">'+(counts[g.id]||0)+'</span></button>';
  });
  html+='<button class="bs-group-add" id="bs-group-add">＋ 新建分组</button>';
  bar.innerHTML=html;
  bar.querySelectorAll('.bs-group-tab').forEach(btn=>btn.addEventListener('click',function(){activeGroupId=this.dataset.groupId||null;rackPage=0;renderBookshelf()}));
  bar.querySelectorAll('[data-group-context]').forEach(btn=>btn.addEventListener('contextmenu',function(e){e.preventDefault();e.stopPropagation();showModal('group-menu',{id:this.dataset.groupContext})}));
  const add=bar.querySelector('#bs-group-add');
  if(add)add.addEventListener('click',()=>showModal('group-create'));
  updateGroupRail();
  scheduleGroupRailMeasurement();
}


const SHELF_PALETTE=[[152,20,26],[212,24,28],[24,28,32],[6,28,33],[192,18,29],[20,12,22]]; // 装帧色板：墨绿/藏蓝/赭棕/砖红/黛青/炭棕（低饱和书店系，避免随机色相撞出刺眼配色）
function spineColor(name){
  let hash=0;
  for(let i=0;i<name.length;i++){hash=name.charCodeAt(i)+((hash<<5)-hash);hash=hash&hash}
  const t=SHELF_PALETTE[Math.abs(hash)%SHELF_PALETTE.length];
  return 'hsl('+t[0]+','+t[1]+'%,'+t[2]+'%)';
}

let shelfEnterPending=true; // 书架首次渲染时播放入场交错浮现，之后重渲染（搜索/删除/翻页）不再重播
function renderBookshelf(){
  try{$('bs-add-btn').style.display=''}catch(e){}
  const grid=$('bs-grid'),total=$('bs-total'),libraryHead=$('bs-library-head'),libraryCount=$('bs-library-count'),libraryTitle=$('bs-library-title'),shelf=$('bookshelf');
  if(activeGroupId&&activeGroupId!==UNGROUPED_GROUP_ID&&!getGroupById(activeGroupId))activeGroupId=null;
  renderGroupBar();
  total.textContent=bookshelf.length+' 部';
  clearRackOverlay();
  const startup=$('startup-note'),hint=$('drag-hint');
  const isFileMode=window.location.protocol==='file:';
  if(startup)startup.style.display=isFileMode?'':'none';
  if(hint)hint.style.display=bookshelf.length?'none':'';
  let sorted=bookshelf.filter(seriesInActiveGroup);
  if(sortMode==='name')sorted.sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh'));
  else if(sortMode==='created')sorted.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  else sorted.sort((a,b)=>(b.lastReadAt||0)-(a.lastReadAt||0));
  if(searchQuery)sorted=sorted.filter(s=>s.name.toLowerCase().includes(searchQuery.toLowerCase()));
  if(libraryCount)libraryCount.textContent=sorted.length+' 部';
  const footerCount=Qs('#bs-footer-count');
  if(footerCount)footerCount.textContent='· '+bookshelf.length+' 部';
  if(libraryTitle)libraryTitle.textContent=getActiveGroupLabel();
  if(!sorted.length){
    if(libraryHead)libraryHead.style.display='none';
    grid.dataset.count='0';
    const title=bookshelf.length?(searchQuery?'没有匹配漫画':'这个分组暂无漫画'):'书架空空';
    const desc=bookshelf.length?(searchQuery?'换个关键词试试':'可以把漫画移入这个分组'):'选择 PDF 文件或文件夹开始导入';
    grid.innerHTML='<div class="bs-empty"><div class="empty-icon"></div><h2>'+title+'</h2><p>'+desc+'</p><button class="empty-action" id="bs-empty-add">+ 添加漫画</button></div>';
    const emptyAdd=Qs('#bs-empty-add',grid);if(emptyAdd)emptyAdd.onclick=()=>showAddModal();
    try{$('bs-add-btn').style.display='none'}catch(e){}
    $('rack-pager').style.display='none';
    return;
  }
  if(libraryHead)libraryHead.style.display='flex';
  // 「继续阅读」融入书架：最近读过的一本书获得 resume 徽章（排序默认按 lastReadAt 置顶）
  const resumeSeries=sorted.reduce((m,s)=>((s.lastReadAt||0)>((m&&m.lastReadAt)||0)?s:m),null);
  const resumeId=resumeSeries&&resumeSeries.lastReadAt?resumeSeries.seriesId:null;
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
    if(s.lastChNum&&isFinite(s.lastChNum)&&chCount>0){let ci=s.chapters.findIndex(c=>c.chapterNum===s.lastChNum);pct=ci>=0?Math.round((ci+1)/chCount*100):0}
    const coverHTML=covers[s.seriesId]?'<img class="shelf-cover-image" src="'+covers[s.seriesId]+'" alt="">':'<div class="cover-fallback">'+s.name.charAt(0)+'</div>';
    const sel=currentSeries===s.seriesId?' selected':'';
    const res=s.seriesId===resumeId?' resume':'';
    const bg=spineColor(s.name||s.seriesId);
    const volume=String(rackPage*PAGE_SIZE+i+1).padStart(2,'0');
    const chapterLabel=s.lastChNum&&isFinite(s.lastChNum)?'第 '+s.lastChNum+' 话':'未开始';
    const resumeBadge=s.seriesId===resumeId?'<span class="resume-badge">继续阅读</span>':'';
    const status=(!resumeBadge)&&currentSeries===s.seriesId?'<span class="shelf-status">在读</span>':'';
    html+='<article class="rack-book'+sel+res+'" data-id="'+s.seriesId+'" data-idx="'+i+'" tabindex="0" role="button" aria-label="打开 '+s.name+'" style="--spine-bg:'+bg+'"><div class="shelf-cover-wrap"><div class="shelf-cover-inner">'+coverHTML+'</div><span class="shelf-cover-frame" aria-hidden="true"></span><span class="shelf-cover-index">'+volume+'</span><span class="shelf-cover-progress" aria-hidden="true"><span style="width:'+pct+'%"></span></span></div><div class="shelf-card-content"><strong class="shelf-title">'+s.name+'</strong><div class="shelf-meta"><span>'+chapterLabel+'</span>'+resumeBadge+status+'</div><div class="shelf-progress" aria-hidden="true"><span style="width:'+pct+'%"></span></div></div><div class="rack-book-shadow"></div><div class="rack-rigid-book"><div class="rack-pages"><span class="rack-face front"></span><span class="rack-face back"></span><span class="rack-face spine-side"></span><span class="rack-face fore"></span><span class="rack-face top"></span><span class="rack-face bottom"></span></div><div class="rack-cover-box back-cover"><span class="rack-cover-face front"></span><span class="rack-cover-face back"></span><span class="rack-cover-face top"></span><span class="rack-cover-face bottom"></span><span class="rack-cover-face left"></span><span class="rack-cover-face right"></span></div><div class="rack-cover-box front-cover"><span class="rack-cover-face front">'+coverHTML+'<span class="rack-cover-frame"></span><span class="rack-cover-mark">VOL. '+volume+'</span></span><span class="rack-cover-face back"></span><span class="rack-cover-face top"></span><span class="rack-cover-face bottom"></span><span class="rack-cover-face left"></span><span class="rack-cover-face right"></span></div><div class="rack-physics-spine"><span class="rack-spine-volume">'+volume+'</span><span class="rack-spine-band"></span><span class="rack-spine-title">'+s.name+'</span><span class="rack-spine-imprint">MANGA</span><div class="rack-progress"><div class="rack-progress-fill" style="width:'+pct+'%"></div></div></div></div><div class="rack-actions"><button class="rack-menu-btn" data-menu-sid="'+s.seriesId+'" title="菜单">⋯</button><button class="change-cover-btn" data-cover-sid="'+s.seriesId+'">换封面</button></div></article>'
  });
  const addCardClass=pageBooks.length<4?' is-prominent':'';
  html+='<div class="rack-add'+addCardClass+'" id="bs-add-card"><div class="add-icon">＋</div><div class="add-label">添加</div></div>';
  grid.innerHTML=html;
  if(shelfEnterPending&&pageBooks.length){shelfEnterPending=false;grid.classList.add('rack-enter');setTimeout(function(){grid.classList.remove('rack-enter')},1600)}
  grid.querySelectorAll('.rack-book[data-id]').forEach(card=>{card.addEventListener('click',function(e){if(e.target.closest('.change-cover-btn')||e.target.closest('.rack-menu-btn'))return;openSeries(this.dataset.id)});card.addEventListener('keydown',function(e){if(e.target.closest('.change-cover-btn')||e.target.closest('.rack-menu-btn'))return;if(e.key==='Enter'||e.key===' '){e.preventDefault();openSeries(this.dataset.id)}})});
  grid.querySelectorAll('.change-cover-btn').forEach(btn=>{btn.addEventListener('click',function(e){e.stopPropagation();showModal('cover-pick',{sid:this.dataset.coverSid})})});
  grid.querySelectorAll('.rack-menu-btn').forEach(btn=>{btn.addEventListener('click',function(e){e.stopPropagation();showModal('rack-menu',{sid:this.dataset.menuSid})})});
  let addCard=grid.querySelector('#bs-add-card');if(addCard)addCard.addEventListener('click',()=>showAddModal());
  const pager=$('rack-pager');
  if(pager){if(pageCount<=1){pager.style.display='none';pager.innerHTML=''}else{pager.style.display='flex';pager.innerHTML='<button id="rack-prev">‹</button><span>'+(rackPage+1)+' / '+pageCount+'</span><button id="rack-next">›</button>';const pv=Qs('#rack-prev',pager),nx=Qs('#rack-next',pager);if(pv)pv.onclick=()=>{if(rackPage>0){rackPage--;renderBookshelf()}};if(nx)nx.onclick=()=>{if(rackPage<pageCount-1){rackPage++;renderBookshelf()}}}}
}
function findSeries(id){return bookshelf.find(s=>s.seriesId===id)}
async function saveSeriesBg(s){try{await db.saveSeries(s)}catch(e){console.error('saveSeries failed',e)}}
async function persistGroups(){await db.saveSetting('groups',settings.groups)}
function normalizedGroupName(name){return String(name||'').trim().replace(/\s+/g,' ')}
function hasGroupName(name,exceptId){const needle=normalizedGroupName(name).toLocaleLowerCase();return settings.groups.some(g=>g.id!==exceptId&&g.name.toLocaleLowerCase()===needle)}
async function createGroup(name){
  const clean=normalizedGroupName(name);
  if(!clean){showToast('请输入分组名称');return false}
  if(hasGroupName(clean)){showToast('分组名称已存在');return false}
  const group={id:'g'+Date.now()+'_'+Math.random().toString(36).slice(2,6),name:clean,createdAt:new Date().toISOString()};
  settings.groups.push(group);
  try{await persistGroups()}catch(e){settings.groups=settings.groups.filter(g=>g.id!==group.id);showToast('分组保存失败');return false}
  renderBookshelf();
  showToast('已创建分组「'+clean+'」');
  return true;
}
async function renameGroup(id,name){
  const group=getGroupById(id),clean=normalizedGroupName(name);
  if(!group){showToast('分组不存在');return false}
  if(!clean){showToast('请输入分组名称');return false}
  if(hasGroupName(clean,id)){showToast('分组名称已存在');return false}
  const previous=group.name;
  group.name=clean;
  try{await persistGroups()}catch(e){group.name=previous;showToast('分组保存失败');return false}
  renderBookshelf();
  showToast('分组已重命名');
  return true;
}
async function deleteGroup(id){
  const group=getGroupById(id);
  if(!group)return false;
  const previousGroups=settings.groups.slice(),affected=bookshelf.filter(s=>s.groupId===id),previousAssignments=affected.map(s=>s.groupId);
  settings.groups=settings.groups.filter(g=>g.id!==id);
  affected.forEach(s=>{s.groupId=null});
  if(activeGroupId===id)activeGroupId=null;
  try{await persistGroups();await Promise.all(affected.map(s=>db.saveSeries(s)))}catch(e){settings.groups=previousGroups;affected.forEach((s,i)=>{s.groupId=previousAssignments[i]});showToast('分组删除保存失败');return false}
  renderBookshelf();
  showToast('已删除分组，漫画已移到未分组');
  return true;
}
async function moveSeriesToGroup(seriesId,groupId){
  const series=findSeries(seriesId);
  if(!series)return false;
  if(groupId&&groupId!==UNGROUPED_GROUP_ID&&!getGroupById(groupId))return false;
  const previous=series.groupId||null;
  series.groupId=groupId===UNGROUPED_GROUP_ID||!groupId?null:groupId;
  try{await db.saveSeries(series)}catch(e){series.groupId=previous;showToast('移动保存失败');return false}
  renderBookshelf();
  showToast('已移动「'+series.name+'」');
  return true;
}
function getImportGroupId(){return activeGroupId&&activeGroupId!==UNGROUPED_GROUP_ID&&getGroupById(activeGroupId)?activeGroupId:null}


function applyRackSizing(n){
  const grid=$('bs-grid');if(!grid||!n)return;
  const availW=Math.max(320,grid.clientWidth-80);
  const addW=Math.max(90,Math.min(130,Math.round(availW*0.09)));
  const gap=n>=8?2:n>=5?3:4;
  const spineW=Math.max(34,Math.min(54,Math.round((availW-addW-gap*(n))/n)));
  const mobile=window.matchMedia&&window.matchMedia('(max-width:620px)').matches;
  const bookW=mobile?136:168;
  const bookH=mobile?236:286;
  const coverT=mobile?6:7;
  grid.style.setProperty('--rack-spine-w',spineW+'px');
  grid.style.setProperty('--rack-book-w',bookW+'px');
  grid.style.setProperty('--rack-book-h',bookH+'px');
  grid.style.setProperty('--rack-book-d',spineW+'px');
  grid.style.setProperty('--rack-cover-t',coverT+'px');
  grid.style.setProperty('--rack-page-w',(bookW-12)+'px');
  grid.style.setProperty('--rack-page-h',(bookH-16)+'px');
  grid.style.setProperty('--rack-page-d',Math.max(18,spineW-coverT*2)+'px');
  grid.style.setProperty('--rack-spine-gap',gap+'px');
  grid.style.setProperty('--rack-add-w',addW+'px');
}
function rackCards(){
  const grid=$('bs-grid');
  return grid?[...grid.querySelectorAll('.rack-book[data-id]')]:[];
}
function ensureRackOverlay(){
  if(rackOverlay&&rackOverlay.isConnected)return rackOverlay;
  rackOverlay=document.getElementById('rack-overlay');
  if(!rackOverlay){rackOverlay=document.createElement('div');rackOverlay.id='rack-overlay';document.body.appendChild(rackOverlay)}
  return rackOverlay;
}
function rackRigidFor(card){
  if(card._rackRigid)return card._rackRigid;
  const rigid=card.querySelector('.rack-rigid-book');
  if(rigid)card._rackRigid=rigid;
  return rigid;
}
function clearRackOverlay(){
  if(!rackOverlay)return;
  while(rackOverlay.firstChild)rackOverlay.removeChild(rackOverlay.firstChild);
}
function moveRackRigid(card,rigid,moving){
  const overlay=ensureRackOverlay();
  const props=['--spine-bg','--rack-book-w','--rack-book-h','--rack-book-d','--rack-cover-t','--rack-page-w','--rack-page-h','--rack-page-d'];
  if(moving){
    if(rigid.parentElement!==overlay){
      rigid._rackOriginalParent=card;
      rigid._rackOriginalNext=rigid.nextSibling;
      const computed=getComputedStyle(card);
      props.forEach(name=>rigid.style.setProperty(name,computed.getPropertyValue(name)));
      overlay.appendChild(rigid);
    }
  }else if(rigid.parentElement===overlay){
    const parent=rigid._rackOriginalParent;
    const next=rigid._rackOriginalNext;
    if(parent&&parent.isConnected)parent.insertBefore(rigid,next&&next.parentNode===parent?next:null);
    props.forEach(name=>rigid.style.removeProperty(name));
    rigid._rackOriginalParent=null;
    rigid._rackOriginalNext=null;
  }
}
function syncRackFixedBodies(){
  rackCards().forEach(card=>{
    const p=Number(card.dataset.rackProgress||0);
    if(p>.001)renderRackCard(card,p);
  });
}
function rackClamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rackEase(v){return v*v*(3-2*v)}
function rackDisplayPhase(p){return rackEase(rackClamp((p-.68)/.32,0,1))}
function rackPose(p){
  const out=rackEase(rackClamp(p/.24,0,1));
  const tilt=rackEase(rackClamp((p-.24)/.22,0,1));
  const lift=rackEase(rackClamp((p-.46)/.22,0,1));
  const display=rackDisplayPhase(p);
  return {z:64*out+84*lift,y:-58*lift+26*display,pitch:-4*display,roll:-27*tilt+25*display,yaw:90-72*display};
}
function renderRackCard(card,p){
  const rigid=rackRigidFor(card),shadow=card.querySelector('.rack-book-shadow');
  const grid=$('bs-grid');if(!rigid||!grid)return;
  const scale=Number(card.dataset.rackScale||1);
  const bookW=parseFloat(getComputedStyle(rigid).getPropertyValue('--rack-book-w'))||168;
  const visualW=bookW+22;
  const pivotX=card.offsetLeft;
  const minPivot=12,maxPivot=Math.max(minPivot,grid.clientWidth-visualW-12);
  const q=rackPose(p),edgeShift=(rackClamp(pivotX,minPivot,maxPivot)-pivotX)*rackDisplayPhase(p);
  const moving=p>.001;
  moveRackRigid(card,rigid,moving);
  if(moving){
    const cardRect=card.getBoundingClientRect();
    rigid.style.position='absolute';
    rigid.style.left=cardRect.left+'px';
    rigid.style.top=cardRect.top+'px';
    rigid.style.bottom='auto';
  }else{
    rigid.style.position='absolute';
    rigid.style.left='0';
    rigid.style.top='auto';
    rigid.style.bottom='0';
  }
  rigid.style.transform='translate3d('+edgeShift+'px,'+q.y+'px,'+q.z+'px) rotateY('+q.yaw+'deg) rotateZ('+q.roll+'deg) rotateX('+q.pitch+'deg) scale('+scale+')';
  if(shadow){shadow.style.opacity=String(.68-.5*rackEase(rackClamp((p-.46)/.22,0,1)));shadow.style.transform='translateX('+(12+q.y*.25+edgeShift*.25)+'px) scale('+scale+') scaleX('+(1+.45*rackEase(rackClamp((p-.46)/.22,0,1)))+')'}
  const index=Number(card.dataset.idx);
  card.style.zIndex=p>.001?(index===rackHoverIndex?1000:900):(card.classList.contains('selected')?16:1);
  if(moving)rigid.style.zIndex=String(index===rackHoverIndex?1000:900);
  else rigid.style.removeProperty('z-index');
  card.dataset.rackProgress=p.toFixed(3);
}
function renderRackMotion(now){
  const dt=rackMotionLast?Math.min(40,now-rackMotionLast):0;rackMotionLast=now;
  const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active=false;
  rackCards().forEach(card=>{
    let p=Number(card.dataset.rackProgress||0),target=card.classList.contains('is-hovered')?1:0;
    if(reduced)p=target;
    else if(Math.abs(target-p)>1e-3){p+=Math.sign(target-p)*dt*rackMotionSpeed/(target?850:500);p=rackClamp(p,0,1);active=true}
    renderRackCard(card,p);
  });
  if(active)rackMotionFrame=requestAnimationFrame(renderRackMotion);else{rackMotionFrame=0;rackMotionLast=0}
}
function startRackMotion(){if(!rackMotionFrame)rackMotionFrame=requestAnimationFrame(renderRackMotion)}
function setRackHover(index){
  rackCards().forEach((card,i)=>card.classList.toggle('is-hovered',i===index));
  rackHoverIndex=index;
  startRackMotion();
}
function queueRackHover(index){
  if(index===rackHoverPending||(rackHoverPending===null&&index===rackHoverIndex))return;
  if(rackHoverTimer){clearTimeout(rackHoverTimer);rackHoverTimer=null}
  rackHoverPending=index;
  const token=++rackHoverToken;
  rackHoverTimer=setTimeout(()=>{
    rackHoverTimer=null;
    if(token!==rackHoverToken)return;
    rackHoverPending=null;
    if(index!==rackHoverIndex)setRackHover(index);
  },40);
}
function clearRackHover(){
  rackHoverToken++;
  rackHoverPending=null;
  if(rackHoverTimer){clearTimeout(rackHoverTimer);rackHoverTimer=null}
  if(rackHoverIndex!==-1)setRackHover(-1);
}
function updateRackHover(e){
  if(e.pointerType==='touch')return;
  const cards=rackCards();
  const slots=cards.map((card,index)=>{
    const rect=card.getBoundingClientRect();
    return {index,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
  });
  const helper=window.RackInteraction&&window.RackInteraction.findRackBookAtPoint;
  const index=typeof helper==='function'?helper(slots,e.clientX,e.clientY,{verticalPadding:12}):-1;
  queueRackHover(index);
}
function bindRackHover(){
  const grid=$('bs-grid');
  if(!grid||rackHoverBound)return;
  rackHoverBound=!0;
  grid.addEventListener('pointermove',function(e){updateRackHover(e)},true);
  grid.addEventListener('pointerleave',clearRackHover);
  grid.addEventListener('scroll',syncRackFixedBodies,{passive:true});
  const shelf=$('bookshelf');
  if(shelf)shelf.addEventListener('scroll',syncRackFixedBodies,{passive:true});
  window.addEventListener('resize',syncRackFixedBodies);
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
    let h=0;for(let i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))>>>0;
    // 装帧封面：从策划色板挑一组低饱和深底，哈希只负责选组不赌色相
    const tone=SHELF_PALETTE[h%SHELF_PALETTE.length];
    const g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'hsl('+tone[0]+' '+tone[1]+'% '+(tone[2]+8)+'%)');g.addColorStop(1,'hsl('+tone[0]+' '+(tone[1]+4)+'% '+(tone[2]-7)+'%)');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    // subtle paper grain
    ctx.globalAlpha=.05;ctx.fillStyle='#fff';
    for(let i=0;i<120;i++){ctx.fillRect(Math.random()*W,Math.random()*H,2,2)}
    ctx.globalAlpha=1;
    // 细装帧双线框
    ctx.strokeStyle='rgba(244,241,230,.30)';ctx.lineWidth=2;
    ctx.strokeRect(26,26,W-52,H-52);
    ctx.strokeStyle='rgba(244,241,230,.14)';ctx.lineWidth=1;
    ctx.strokeRect(36,36,W-72,H-72);
    // title
    const chars=String(name||'未命名').trim().replace(/\s+/g,'').slice(0,8)||'未命名';
    const twoCols=chars.length>4;
    const colLen=twoCols?Math.ceil(chars.length/2):chars.length;
    const colH=H*.5;
    const spacing=Math.min(132,Math.floor(colH/colLen));
    const fontSize=Math.max(92,Math.min(160,Math.round(spacing*1.4)));
    const colGap=Math.max(120,Math.round(fontSize*.85));
    const leftX=W/2-(twoCols?colGap/2:0);
    const rightX=W/2+(twoCols?colGap/2:0);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.miterLimit=2;
    ctx.shadowColor='rgba(15,17,19,.5)';ctx.shadowBlur=16;ctx.shadowOffsetX=0;ctx.shadowOffsetY=4;
    ctx.strokeStyle='rgba(15,17,19,.4)';ctx.lineWidth=Math.max(5,Math.round(fontSize*.045));
    ctx.fillStyle='#F4F1E6';
    ctx.font='700 '+fontSize+'px "Microsoft YaHei UI","Microsoft YaHei","Noto Sans CJK SC","Arial Black",sans-serif';
    function drawCol(colChars,x,off){const arr=Array.from(colChars);const sy=H*.34-(arr.length-1)*spacing/2+off;arr.forEach((ch,i)=>{const y=sy+i*spacing;const rot=((i%3)-1)*0.012;ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.strokeText(ch,0,0);ctx.fillText(ch,0,0);ctx.restore()})}
    drawCol(chars.slice(0,colLen),leftX,0);
    if(twoCols)drawCol(chars.slice(colLen),rightX,spacing*0.06);
    ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
    // 底部细线 + 印记
    ctx.strokeStyle='rgba(244,241,230,.38)';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(W*.37,H*.775);ctx.lineTo(W*.63,H*.775);ctx.stroke();
    ctx.font='500 24px "Microsoft YaHei",sans-serif';ctx.fillStyle='rgba(244,241,230,.75)';
    ctx.fillText('M A N H W A',W/2,H*.815);
    return cv.toDataURL('image/jpeg',0.92);
  }catch(e){console.warn('text cover fail',e);return null}
}
// 旧版文字封面识别（600×840 + 28px 白框特征）：仅用于一次性换装，用户自设封面不会命中
function isLegacyTextCover(dataUrl){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      try{
        const c=document.createElement('canvas');c.width=240;c.height=336;
        const x=c.getContext('2d');x.drawImage(img,0,0,240,336);
        const d=x.getImageData(0,0,240,336).data;
        const lum=(px,py)=>{let s=0,n=0;for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const i=((py+oy)*240+(px+ox))*4;s+=d[i]*.299+d[i+1]*.587+d[i+2]*.114;n++}return s/n};
        const bright=v=>v>112,bgOk=lum(120,30)<108;
        const edges=[lum(120,11),lum(120,325),lum(11,168),lum(229,168)].filter(bright).length;
        res(bgOk&&edges>=3);
      }catch(e){res(false)}
    };
    img.onerror=()=>res(false);
    img.src=dataUrl;
  });
}
async function refreshLegacyTextCovers(){
  try{
    if(localStorage.getItem('textcover-v5-refresh'))return;
    const legacy=[];
    for(const s of bookshelf){if(covers[s.seriesId]&&await isLegacyTextCover(covers[s.seriesId]))legacy.push(s)}
    for(const s of legacy)await persistTextCover(s.seriesId,s.name,{force:true,refresh:false});
    localStorage.setItem('textcover-v5-refresh','1');
    if(legacy.length)renderBookshelf();
  }catch(e){}
}
async function persistTextCover(sid,name,options){
  const opts=options||{};
  if(!opts.force&&covers[sid])return covers[sid];
  const dataUrl=makeTextCover(String(name||'未命名'));
  if(!dataUrl)return null;
  try{
    await db.saveCover(sid,dataUrl);covers[sid]=dataUrl;
    if(opts.refresh!==false&&!currentSeries)renderBookshelf();
    if(opts.successMessage)showToast(opts.successMessage);
    return dataUrl;
  }catch(e){console.warn('text cover save fail',e);return null}
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
  else if(type==='group-create'){title='新建分组';body='<p>用一个短名称整理你的漫画：</p><input type="text" id="modal-group-name" placeholder="例如：正在追" autofocus>';actions='<button id="modal-cancel">取消</button><button class="accent" id="modal-confirm">创建分组</button>'}
  else if(type==='group-rename'){const group=getGroupById(data.id);title='重命名分组';body='<p>修改分组名称：</p><input type="text" id="modal-group-name" value="'+escapeHTML(group?group.name:'')+'" autofocus>';actions='<button id="modal-cancel">取消</button><button class="accent" id="modal-confirm">保存名称</button>'}
  else if(type==='group-delete-confirm'){const group=getGroupById(data.id);title='删除分组';body='<p>确定删除「<b>'+escapeHTML(group?group.name:'')+'</b>」吗？</p><p style="color:var(--text3)">分组中的漫画会保留，并移到未分组。</p>';actions='<button id="modal-cancel">取消</button><button class="danger" id="modal-confirm">确认删除</button>'}
  else if(type==='move-group'){const series=findSeries(data.sid);let options='<label><input type="radio" name="moveGroup" value="" '+(!series||!series.groupId?'checked':'')+'> 未分组</label>';settings.groups.forEach(g=>{options+='<label><input type="radio" name="moveGroup" value="'+escapeHTML(g.id)+'" '+(series&&series.groupId===g.id?'checked':'')+'> '+escapeHTML(g.name)+'</label>'});title='移动到分组';body='<p>为「<b>'+escapeHTML(series?series.name:'')+'</b>」选择目标分组：</p><div class="radio-row">'+options+'</div>';actions='<button id="modal-cancel">取消</button><button class="accent" id="modal-confirm">移动</button>'}
  else if(type==='delete-confirm'){title='删除系列';body='<p>确定要删除「<b>'+data.name+'</b>」吗？<br><span style="color:var(--text3)">可选择是否同时清除缓存文件。</span></p><div class="radio-row"><label><input type="checkbox" id="modal-delete-cache" checked> 同时清除缓存的 PDF 文件</label></div>';actions='<button id="modal-cancel">取消</button><button class="danger" id="modal-confirm">确认删除</button>'}
  else if(type==='cache-mgr'){title='💾 缓存管理';let listHTML='<p style="font-size:12px;color:var(--text3)">各系列已缓存的 PDF 占用空间：</p><div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:8px">';if(Object.keys(data.stats).length===0)listHTML+='<p style="color:var(--text3);text-align:center">暂无缓存</p>';else{for(const[sid,st]of Object.entries(data.stats)){let s=findSeries(sid),name=s?s.name:sid,sz=st.size>1048576?(st.size/1048576).toFixed(1)+' MB':(st.size/1024).toFixed(0)+' KB';listHTML+='<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface2);border-radius:6px"><span>'+name+' <span style="color:var(--text3);font-size:11px">'+st.count+'章</span></span><span style="display:flex;align-items:center;gap:10px"><span style="color:var(--text2);font-size:12px">'+sz+'</span><button class="cache-clear-btn" data-sid="'+sid+'" style="font-size:11px;padding:4px 10px">清除</button></span></div>'}}if(data.storageInfo){let si=data.storageInfo,u=si.usage>1048576?(si.usage/1048576).toFixed(1)+' MB':(si.usage/1024).toFixed(0)+' KB',q=si.quota>1073741824?(si.quota/1073741824).toFixed(1)+' GB':(si.quota/1048576).toFixed(0)+' MB';listHTML+='<p style="font-size:11px;color:var(--text3);margin-top:8px">总计已用 '+u+' / 可用 '+q+'（'+si.pct+'%）</p>'}listHTML+='</div>';body=listHTML;actions='<button id="modal-cancel">关闭</button>'}
  else if(type==='settings'){
    let untHtml=settings.webtoonAuto?' selected':'',umHtml=settings.webtoonAuto?'':' selected';
    title='⚙️ 阅读设置';
    body='<div class="settings-form"><label>默认缩放<select id="setting-zoom"><option value="fit" '+(settings.zoom==='fit'?'selected':'')+'>适应宽度</option><option value="0.75" '+(settings.zoom==='0.75'?'selected':'')+'>75%</option><option value="1" '+(settings.zoom==='1'?'selected':'')+'>100%</option><option value="1.25" '+(settings.zoom==='1.25'?'selected':'')+'>125%</option><option value="1.5" '+(settings.zoom==='1.5'?'selected':'')+'>150%</option></select></label><label>翻页方向<select id="setting-direction"><option value="scroll" '+(settings.direction==='scroll'?'selected':'')+'>上下滚动</option><option value="flip" '+(settings.direction==='flip'?'selected':'')+'>左右翻页</option></select></label><label>双页模式<select id="setting-dual"><option value="0" '+(!settings.dualPage?'selected':'')+'>单页</option><option value="1" '+(settings.dualPage?'selected':'')+'>双页（暂未实现）</option></select></label><label>侧边栏默认展开<select id="setting-sidebar"><option value="1" '+((settings.sidebarOpen!==!1)?'selected':'')+'>展开</option><option value="0" '+((settings.sidebarOpen===!1)?'selected':'')+'>收起</option></select></label><label>主题<select id="setting-theme"><option value="night" '+(settings.theme==='night'?'selected':'')+'>夜间 · 墨稿</option><option value="day" '+(settings.theme==='day'?'selected':'')+'>日间 · 纸稿</option></select></label><label>条漫自动识别<select id="setting-webtoon"><option value="1"'+untHtml+'>开启</option><option value="0"'+umHtml+'>关闭（普通分页）</option></select></label></div>';
     actions='<button id="modal-cancel">关闭</button><button class="accent" id="modal-save-settings">保存</button>'
   }
  else if(type==='reader-more'){
    title='阅读操作';
    body='<div class="reader-action-list"><button id="reader-more-directory" type="button">目录</button><button id="reader-more-immersive" type="button">沉浸模式</button><button id="reader-more-settings" type="button">阅读设置</button><button id="reader-more-cover" type="button">设封面</button><button id="reader-more-files" type="button">追加 PDF 文件</button>'+(hasFolderPicker?'<button id="reader-more-folder" type="button">追加文件夹</button>':'')+'</div>';
    actions='<button id="modal-cancel">关闭</button>';
  }
  else if(type==='cover-pick'){title='🖼 更换封面';body='<p>点选一张预览图，再按「使用选中画面」生成清晰封面：</p><div class="cover-pick-grid" id="cover-pick-grid"><p style="color:var(--text3);font-size:12px">正在加载缩略图…</p></div>';actions='<button id="cover-confirm" class="accent" disabled>使用选中画面</button><button id="cover-open-reader">进入阅读器手动选图</button><button id="cover-make-text">文字封面</button><button id="cover-upload">上传</button><button id="modal-reset-cover">恢复默认</button><button id="modal-cancel">取消</button>';
    setTimeout(async function(){const grid=Qs('#cover-pick-grid',mc);if(!grid)return;const confBtn=Qs('#cover-confirm',mc);try{const cands=await loadCoverCandidates(data.sid);if(!cands.length){grid.innerHTML='<p style="color:var(--text3);font-size:12px">无法加载缩略图</p>';if(confBtn)confBtn.style.display='none';return}grid.innerHTML=cands.map(c=>'<div class="cover-opt" data-page="'+c.page+'" data-chapter="'+c.chapterNum+'"><img src="'+c.dataUrl+'"><span>第'+c.page+'页</span></div>').join('');grid.querySelectorAll('.cover-opt').forEach(el=>el.addEventListener('click',function(){grid.querySelectorAll('.cover-opt').forEach(opt=>opt.classList.remove('is-selected'));this.classList.add('is-selected');if(confBtn)confBtn.disabled=false}));if(confBtn)confBtn.onclick=async function(){const sel=grid.querySelector('.cover-opt.is-selected');if(!sel)return;const page=parseInt(sel.dataset.page,10),chapterNum=Number(sel.dataset.chapter);confBtn.disabled=!0;confBtn.textContent='正在生成…';showToast('正在生成清晰封面…');try{const url=await renderCoverCandidate(data.sid,chapterNum,page);if(url&&await setSeriesCover(data.sid,url,{successMessage:'清晰封面已设置',errorMessage:'清晰封面保存失败，请重试'}))closeModal();else{confBtn.disabled=!1;confBtn.textContent='使用选中画面'}}catch(e){showToast('清晰封面生成失败，请重试');confBtn.disabled=!1;confBtn.textContent='使用选中画面'}}}catch(e){grid.innerHTML='<p style="color:var(--text3);font-size:12px">加载失败</p>'}},120)}
  else if(type==='cover-select'){title='封面';const s=findSeries(data&&data.sid);const preview=covers[data&&data.sid]||(s?makeTextCover(s.name):null);body='<p>默认已生成文字封面，也可上传图片。</p><div style="text-align:center;margin:10px 0">'+(preview?'<img src="'+preview+'" style="width:150px;height:210px;object-fit:cover;border-radius:8px;box-shadow:var(--shadow)">':'<span style="color:var(--text3)">无预览</span>')+'</div>';actions='<button id="cover-sel-upload">上传图片</button><button id="modal-skip-cover">完成</button>';
    setTimeout(()=>{const uBtn=Qs('#cover-sel-upload',mc);if(uBtn)uBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}}},80)}
else if(type==='group-menu'){const group=getGroupById(data.id);title='分组操作';body='<div style="display:flex;flex-direction:column;gap:8px;margin:8px 0"><button id="group-menu-rename" style="text-align:left">重命名「'+escapeHTML(group?group.name:'')+'」</button><button id="group-menu-delete" class="danger" style="text-align:left">删除分组</button></div>';actions='<button id="modal-cancel">取消</button>';
    setTimeout(()=>{const renameBtn=Qs('#group-menu-rename',mc),deleteBtn=Qs('#group-menu-delete',mc);if(renameBtn)renameBtn.onclick=function(){closeModal();showModal('group-rename',{id:data.id})};if(deleteBtn)deleteBtn.onclick=function(){closeModal();showModal('group-delete-confirm',{id:data.id})}},80)}
else if(type==='rack-menu'){title='操作';body='<div style="display:flex;flex-direction:column;gap:8px;margin:8px 0"><button id="rack-menu-move" style="text-align:left">移动到分组</button><button id="rack-menu-cover" style="text-align:left">换封面</button><button id="rack-menu-delete" class="danger" style="text-align:left">删除</button></div>';actions='<button id="modal-cancel">取消</button>';
    setTimeout(()=>{const moveBtn=Qs('#rack-menu-move',mc),coverBtn=Qs('#rack-menu-cover',mc),delBtn=Qs('#rack-menu-delete',mc);if(moveBtn)moveBtn.onclick=function(){closeModal();showModal('move-group',{sid:data.sid})};if(coverBtn)coverBtn.onclick=function(){closeModal();showModal('cover-pick',{sid:data.sid})};if(delBtn)delBtn.onclick=function(){let s=findSeries(data.sid);closeModal();if(s)showModal('delete-confirm',{id:data.sid,name:s.name})}},80)}
  else if(type==='set-cover'){title='设封面';body='<p>选择一种方式设置封面：</p><div style="display:flex;flex-direction:column;gap:8px;margin:8px 0"><button id="set-cover-capture">当前画面截图</button><button id="set-cover-upload">上传本地图片</button><button id="set-cover-text">生成文字封面</button><button id="set-cover-cands">从候选页选择</button></div>';actions='<button id="modal-cancel">取消</button>';
    setTimeout(()=>{const cBtn=Qs('#set-cover-capture',mc),uBtn=Qs('#set-cover-upload',mc),tBtn=Qs('#set-cover-text',mc),cdBtn=Qs('#set-cover-cands',mc);if(cBtn)cBtn.onclick=function(){startCoverCapture(data.sid)};if(uBtn)uBtn.onclick=async function(){closeModal();const d=await pickImageCover(data.sid);if(d)setSeriesCover(data.sid,d)};if(tBtn)tBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');closeModal();if(d)setSeriesCover(data.sid,d)};if(cdBtn)cdBtn.onclick=function(){closeModal();showModal('cover-pick',{sid:data.sid})}},80)}
mc.innerHTML='<h3>'+title+'</h3>'+body+'<div class="modal-actions'+(type==='cover-pick'?' cover-pick-actions':'')+'">'+actions+'</div>';ov.classList.add('show');
  const cancelBtn=Qs('#modal-cancel',mc),confirmBtn=Qs('#modal-confirm',mc);
  let modalClosed=false;
  function closeModal(){if(modalClosed)return;modalClosed=true;ov.classList.remove('show');ov.removeEventListener('click',onOverlayClick);if(cancelBtn)cancelBtn.onclick=null;if(confirmBtn)confirmBtn.onclick=null;if(mc._modalCleanup===closeModal)mc._modalCleanup=null}
  if(cancelBtn)cancelBtn.onclick=closeModal;const readerCoverBtn=Qs('#cover-open-reader',mc);if(readerCoverBtn)readerCoverBtn.onclick=function(){closeModal();if(currentSeries!==data.sid)openSeries(data.sid)};const resetCoverBtn=Qs('#modal-reset-cover',mc);if(resetCoverBtn)resetCoverBtn.onclick=async function(){const s=findSeries(data.sid);closeModal();showToast('正在生成文字封面…');await persistTextCover(data.sid,s?s.name:'未命名',{force:true,successMessage:'文字封面已恢复'})};const makeTextBtn=Qs('#cover-make-text',mc);if(makeTextBtn)makeTextBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');if(d){setSeriesCover(data.sid,d);closeModal();}};const uploadCoverBtn=Qs('#cover-upload',mc);if(uploadCoverBtn)uploadCoverBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}};const skipCoverBtn=Qs('#modal-skip-cover',mc);if(skipCoverBtn)skipCoverBtn.onclick=function(){closeModal();showToast('使用文字封面')};const selTextBtn=Qs('#cover-sel-text',mc);if(selTextBtn)selTextBtn.onclick=function(){const s=findSeries(data.sid);const d=makeTextCover(s?s.name:'未命名');if(d){setSeriesCover(data.sid,d);closeModal();}};const selUploadBtn=Qs('#cover-sel-upload',mc);if(selUploadBtn)selUploadBtn.onclick=async function(){const d=await pickImageCover(data.sid);if(d){setSeriesCover(data.sid,d);closeModal();}};
   function onOverlayClick(e){if(e.target===ov)closeModal()}ov.addEventListener('click',onOverlayClick);mc._modalCleanup=closeModal;
   const readerMoreDirectory=Qs('#reader-more-directory',mc),readerMoreSettings=Qs('#reader-more-settings',mc),readerMoreCover=Qs('#reader-more-cover',mc),readerMoreFiles=Qs('#reader-more-files',mc);
   if(readerMoreDirectory)readerMoreDirectory.onclick=function(){closeModal();$('sidebar').classList.toggle('hidden')};
   if(readerMoreSettings)readerMoreSettings.onclick=function(){closeModal();showModal('settings')};
   if(readerMoreCover)readerMoreCover.onclick=function(){closeModal();showModal('set-cover',{sid:currentSeries})};
   if(readerMoreFiles)readerMoreFiles.onclick=async function(){closeModal();if(currentSeries){const files=await pickFilesViaInput();if(files&&files.length)await importFilesToSeries(currentSeries,files)}};
   const readerMoreImmersive=Qs('#reader-more-immersive',mc);if(readerMoreImmersive)readerMoreImmersive.onclick=function(){closeModal();if(chromeHidden)chromeShow();else chromeHide()};
   const readerMoreFolder=Qs('#reader-more-folder',mc);if(readerMoreFolder)readerMoreFolder.onclick=async function(){closeModal();if(currentSeries){const files=await pickFolder();if(files&&files.length)await importFilesToSeries(currentSeries,files)}};
  if(type==='add-choose'){if(!confirmBtn)return;confirmBtn.onclick=async function(){let r=Qs('input[name="addType"]:checked',mc),isNew=!r||r.value==='new';closeModal();try{let files;if(_pendingFiles&&_pendingFiles.length){files=_pendingFiles;_pendingFiles=null}else{if(hasFolderPicker&&_pendingFilesMode!=='input')files=await pickFolder();else files=await pickFilesViaInput()}if(!files||!files.length)return;showToast('已选择 '+files.length+' 个文件');if(isNew){_pendingFiles=files;_pendingFilesMode='drop';showModal('add-name')}else{if(_importBusy){showToast('正在导入中，请稍候');return}let sel=Qs('#modal-existing-select',mc);if(!sel){showToast('没有可用的系列');return}let sid=sel.value;if(!sid){showToast('没有可用的系列');return}_importBusy=!0;try{await importFilesToSeries(sid,files)}finally{_importBusy=!1}}}catch(e){console.error(e);showToast('操作失败')}}}
  else if(type==='add-name'){if(!confirmBtn)return;confirmBtn.onclick=async function(){let ni=$('modal-name');if(!ni){closeModal();return}let name=ni.value.trim();if(!name){showToast('请输入名称');return}closeModal();if(_importBusy){showToast('正在导入中，请稍候');return}let files=_pendingFiles;_pendingFiles=null;if(files){_importBusy=!0;try{showToast('正在导入「'+name+'」，共 '+files.length+' 章，请稍候…');await createSeries(name,files)}finally{_importBusy=!1}}else showToast('未找到文件，请重新选择')};setTimeout(()=>{let inp=$('modal-name');if(inp){inp.focus();inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&confirmBtn)confirmBtn.click()})}},100)}
  else if(type==='group-create'){if(!confirmBtn)return;confirmBtn.onclick=async function(){const input=$('modal-group-name');if(!input)return;if(await createGroup(input.value))closeModal()};setTimeout(()=>{const input=$('modal-group-name');if(input){input.focus();input.addEventListener('keydown',e=>{if(e.key==='Enter')confirmBtn.click()})}},80)}
  else if(type==='group-rename'){if(!confirmBtn)return;confirmBtn.onclick=async function(){const input=$('modal-group-name');if(!input)return;if(await renameGroup(data.id,input.value))closeModal()};setTimeout(()=>{const input=$('modal-group-name');if(input){input.focus();input.select();input.addEventListener('keydown',e=>{if(e.key==='Enter')confirmBtn.click()})}},80)}
  else if(type==='group-delete-confirm'){if(!confirmBtn)return;confirmBtn.onclick=async function(){closeModal();await deleteGroup(data.id)}}
  else if(type==='move-group'){if(!confirmBtn)return;confirmBtn.onclick=async function(){const selected=Qs('input[name="moveGroup"]:checked',mc);closeModal();if(selected)await moveSeriesToGroup(data.sid,selected.value||UNGROUPED_GROUP_ID)}}
  else if(type==='delete-confirm'){if(!confirmBtn)return;confirmBtn.onclick=function(){let dc=Qs('#modal-delete-cache',mc),shouldDelete=dc?dc.checked:!0;closeModal();let idx=bookshelf.findIndex(s=>s.seriesId===data.id);if(idx>=0){let s=bookshelf[idx];if(currentSeries===data.id)closeReader();bookshelf.splice(idx,1);renderBookshelf();delete covers[data.id];showToast('已删除「'+s.name+'」');// Background async cleanup
(async()=>{if(shouldDelete){try{await db.deleteSeriesPDFs(data.id)}catch(e){}try{await db.deleteCover(data.id)}catch(e){}}try{await db.deleteSeries(data.id)}catch(e){}})()}}}
  else if(type==='cache-mgr'){setTimeout(()=>{mc.querySelectorAll('.cache-clear-btn').forEach(btn=>{btn.addEventListener('click',async function(){let sid=this.dataset.sid,s=findSeries(sid),name=s?s.name:sid;try{await db.deleteSeriesPDFs(sid);await db.deleteCover(sid);delete covers[sid];showToast('已清除「'+name+'」的缓存');renderBookshelf()}catch(e){showToast('清除失败')}let stats=await db.getCacheStats(),si=await db.getStorageEstimate();closeModal();showModal('cache-mgr',{stats,storageInfo:si})})})},100)}
  else if(type==='settings'){const saveBtn=Qs('#modal-save-settings',mc);if(saveBtn)saveBtn.onclick=async function(){let z=$('setting-zoom').value,d=$('setting-direction').value,dp=$('setting-dual').value==='1',sb=$('setting-sidebar').value==='1',t=$('setting-theme').value,wa=$('setting-webtoon').value==='1',zoomChanged=settings.zoom!==z;Object.assign(settings,{zoom:z,direction:d,dualPage:dp,sidebarOpen:sb,theme:t,webtoonAuto:wa});$('zoom-select').value=z;if(zoomChanged)requestZoomChange(z);document.documentElement.setAttribute('data-theme',t);await db.saveSetting('zoom',z);await db.saveSetting('direction',d);await db.saveSetting('dualPage',dp);await db.saveSetting('sidebarOpen',sb);await db.saveSetting('theme',t);await db.saveSetting('webtoonAuto',wa);closeModal();showToast('设置已保存')};if(cancelBtn)cancelBtn.onclick=closeModal}
}

async function pickFolder(){try{if(!window.showDirectoryPicker)return await pickFilesViaInput();let dh=await window.showDirectoryPicker(),fs=[];for await(let e of dh.values()){if(e.kind==='file')fs.push(await e.getFile())}let pdfs=fs.filter(f=>f.name.toLowerCase().endsWith('.pdf'));if(!pdfs.length){showToast('文件夹中没有PDF文件');return null}return pdfs}catch(e){if(e.name!=='AbortError')showToast('操作取消');return null}}
async function pickFilesViaInput(){
  const cap=window.Capacitor;
  if(cap&&cap.isNativePlatform&&cap.isNativePlatform()&&cap.Plugins&&cap.Plugins.CapacitorFilePicker){
    try{
      const r=await cap.Plugins.CapacitorFilePicker.pickFiles({multiple:!0,types:['application/pdf'],readData:!0});
      const pdfs=(r.files||[]).filter(f=>(f.name||'').toLowerCase().endsWith('.pdf')).map(f=>{const bin=atob(f.data);const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return new File([new Blob([u8],{type:f.mimeType||'application/pdf'})],f.name,{type:f.mimeType||'application/pdf'})});
      if(!pdfs.length){showToast('未选中PDF文件');return null}
      return pdfs;
    }catch(e){return null}
  }
  return new Promise(resolve=>{let inp=$('hidden-file-input'),ni=inp.cloneNode(!0);inp.parentNode.replaceChild(ni,inp);ni.id='hidden-file-input';ni.accept='application/pdf,.pdf';ni.addEventListener('change',function(){let fs=Array.from(this.files),pdfs=fs.filter(f=>f.name.toLowerCase().endsWith('.pdf'));if(!pdfs.length){showToast('未选中PDF文件');resolve(null);return}resolve(pdfs)});ni.addEventListener('cancel',()=>resolve(null));ni.click()})}
function extractChapterNumber(f){let n=f.replace(/\.pdf$/i,'');for(let p of[/第\s*(\d+)\s*[话章节]/g,/[Cc]h(?:apter)?[.\s_-]*(\d+)/g,/^(\d+)[\s_.-]/g,/[[(（](\d+)[\])）]/g,/(\d+)$/g]){let m=[...n.matchAll(p)];if(m.length)return parseInt(m[m.length-1][1])}let m=n.match(/(\d+)/g);return m?parseInt(m[m.length-1]):NaN}
function assignFallbackChapterNums(list,existing){let mx=(existing||list).reduce((m,c)=>isFinite(c.chapterNum)&&c.chapterNum>m?c.chapterNum:m,0),seq=mx+1;list.forEach(c=>{if(!isFinite(c.chapterNum))c.chapterNum=seq++})}

async function createSeries(name,files){if(!files||!files.length)return;let sid='s'+Date.now()+'_'+Math.random().toString(36).slice(2,6),chs=files.map(f=>({name:f.name.replace(/\.pdf$/i,''),chapterNum:extractChapterNumber(f.name),pages:null,cached:!1,loaded:!1,status:'unread',isWebtoon:!1}));assignFallbackChapterNums(chs);chs.sort((a,b)=>a.chapterNum-b.chapterNum);let s={seriesId:sid,name,groupId:getImportGroupId(),chapters:chs,lastChNum:null,lastPage:null,createdAt:new Date().toISOString()};bookshelf.push(s);await db.saveSeries(s);await persistTextCover(sid,name,{refresh:false});renderBookshelf();showCoverSelectDuringImport(sid,files,chs.length?chs[0].chapterNum:null);let okChs=await cachePDFs(sid,files,chs);s=findSeries(sid);if(s){s.chapters.forEach(c=>{if(okChs.includes(c.chapterNum)){c.cached=!0;c.loaded=!1}});await db.saveSeries(s)}openSeries(sid)}

async function importFilesToSeries(sid,files){let s=findSeries(sid);if(!s)return;let en=new Set(s.chapters.map(c=>c.name)),vf=files.filter(f=>f.name.toLowerCase().endsWith('.pdf')),nc=vf.filter(f=>!en.has(f.name.replace(/\.pdf$/i,''))).map(f=>({name:f.name.replace(/\.pdf$/i,''),chapterNum:extractChapterNumber(f.name),pages:null,cached:!1,loaded:!1,status:'unread',isWebtoon:!1}));if(!nc.length){showToast('没有新的PDF文件');return}assignFallbackChapterNums(nc,s.chapters);s.chapters.push(...nc);s.chapters.sort((a,b)=>a.chapterNum-b.chapterNum);await db.saveSeries(s);if(currentSeries===sid){chapters=s.chapters;renderChapterList();prefetchNextSafe(currentChIdx)}renderBookshelf();let fm=[];for(let f of vf){let fn=f.name.replace(/\.pdf$/i,''),ch=s.chapters.find(c=>c.name===fn);if(ch)fm.push({file:f,ch:ch})}let okChs=await cachePDFs(sid,fm.map(x=>x.file),fm.map(x=>x.ch));s=findSeries(sid);if(s){fm.forEach(({ch})=>{if(!okChs.includes(ch.chapterNum))return;let c=s.chapters.find(sc=>sc.chapterNum===ch.chapterNum&&sc.name===ch.name);if(c){c.cached=!0;c.loaded=!1}});await db.saveSeries(s);if(currentSeries===sid){chapters=s.chapters;renderChapterList()}}showToast('已追加 '+nc.length+' 章')}

async function cachePDFs(sid,files,chs){if(!files.length)return[];showProgress(0,files.length);let ok=[];for(let i=0;i<files.length;i++){try{let ab=await files[i].arrayBuffer(),cn=i<chs.length?chs[i].chapterNum:i+1;if(!pdfHeaderOk(ab)){showToast('文件读取异常，已跳过：'+files[i].name);continue}await db.savePDF(sid,cn,ab);sessionPDFCache.set(sid+'_'+cn,ab);if(sessionPDFCache.size>3){sessionPDFCache.delete(sessionPDFCache.keys().next().value)}ok.push(cn)}catch(e){console.warn('Cache fail:',files[i].name,e);showToast('「'+files[i].name+'」存储失败：'+((e&&e.message)||'未知错误'))}showProgress(i+1,files.length)}setTimeout(()=>hideProgress(),800);return ok}
function showProgress(done,total){let p=$('import-progress');if(!p){p=document.createElement('div');p.id='import-progress';p.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--border);padding:12px 24px;border-radius:12px;z-index:1500;display:flex;align-items:center;gap:12px;box-shadow:0 4px 24px rgba(0,0,0,0.1)';p.innerHTML='<span id="import-progress-text" style="color:var(--text);font-size:13px"></span><div style="width:120px;height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div id="import-progress-bar" style="height:100%;background:var(--accent);border-radius:2px;width:0%;transition:width .2s"></div></div>';document.body.appendChild(p)}Qs('#import-progress-text',p).textContent='正在导入 '+done+'/'+total;Qs('#import-progress-bar',p).style.width=(done/total*100)+'%'}
function hideProgress(){let p=$('import-progress');if(p){Qs('#import-progress-text',p).textContent='导入完成 ✓';setTimeout(()=>{if(p.parentNode)p.parentNode.removeChild(p)},1500)}}

async function generateCover(sid,file){try{let ab=await file.arrayBuffer(),doc=await ManhwaPdf.getDocument({data:ab}).promise,page=await doc.getPage(1),vp=page.getViewport({scale:.4}),cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;let dataUrl=cv.toDataURL('image/jpeg',.7);await db.saveCover(sid,dataUrl);covers[sid]=dataUrl;doc.destroy();if(!currentSeries)renderBookshelf()}catch(e){console.warn('Cover fail:',e)}}


async function autoPickCover(sid,files,chapterNum){
  try{
    let file=null;
    if(files&&files.length){if(chapterNum!=null)file=files.find(f=>f.name&&extractChapterNumber(f.name)===chapterNum)||files[0];else file=files[0]}
    let ab=null;
    if(file){try{ab=await file.arrayBuffer()}catch(e){}}
    if(!ab){try{ab=await db.loadPDF(sid,chapterNum||1)}catch(e){}}if(!ab&&!chapterNum){try{const s=findSeries(sid);const ch=[...(s&&s.chapters||[])].filter(c=>c.cached).sort((a,b)=>a.chapterNum-b.chapterNum)[0];if(ch)ab=await db.loadPDF(sid,ch.chapterNum)}catch(e){}}
    if(!ab){console.warn('autoPickCover: no data for',sid);return}
    const doc=await ManhwaPdf.getDocument({data:ab}).promise;
    const maxP=doc.numPages;
    let best={score:-1,page:1,dataUrl:null};
    for(let p=1;p<=maxP;p++){
      try{
        const pg=await doc.getPage(p);
        const vp=pg.getViewport({scale:.25});
        const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
        await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        const dataUrl=cv.toDataURL('image/jpeg',.7);
        const score=scoreCover(cv,vp,p,maxP);
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

function scoreCover(cv,vp,pageNum,totalPages){
  try{
    const ctx=cv&&cv.getContext?cv.getContext('2d'):null,w=Math.max(1,cv&&cv.width||0),h=Math.max(1,cv&&cv.height||0);
    if(!ctx||!w||!h)return 0;
    const img=ctx.getImageData(0,0,w,h).data;
    // Work from a bounded sample grid so long webtoon pages do not make imports slow.
    const step=Math.max(1,Math.ceil(Math.max(w,h)/220)),cols=Math.ceil(w/step),rows=Math.ceil(h/step),lums=new Array(cols*rows);
    let count=0,sum=0,sum2=0,content=0,white=0,dark=0,colorful=0,edgeSum=0,edgeCount=0,borderContent=0,centerContent=0,centerCount=0,edgeContent=0,edgeCountContent=0;
    const colors=new Set();
    for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
      const x=Math.min(w-1,gx*step),y=Math.min(h-1,gy*step),i=(y*w+x)*4,alpha=(img[i+3]===undefined?255:img[i+3])/255;
      const r=img[i]*alpha+255*(1-alpha),g=img[i+1]*alpha+255*(1-alpha),b=img[i+2]*alpha+255*(1-alpha),lum=(.299*r+.587*g+.114*b)/255,chroma=(Math.max(r,g,b)-Math.min(r,g,b))/255;
      const index=gy*cols+gx;lums[index]=lum;count+=1;sum+=lum;sum2+=lum*lum;
      if(lum<.94)content+=1;if(lum>.96)white+=1;if(lum<.18)dark+=1;if(chroma>.12)colorful+=1;
      colors.add(Math.floor(r/32)+','+Math.floor(g/32)+','+Math.floor(b/32));
      const isBorder=gx<cols*.12||gx>=cols*.88||gy<rows*.12||gy>=rows*.88,isCenter=gx>=cols*.3&&gx<cols*.7&&gy>=rows*.25&&gy<rows*.75;
      if(isBorder){if(lum<.94)borderContent+=1}else if(isCenter){if(lum<.94)centerContent+=1;centerCount+=1}else{if(lum<.94)edgeContent+=1;edgeCountContent+=1}
      if(gx>0){edgeSum+=Math.abs(lum-lums[index-1]);edgeCount+=1}
      if(gy>0){edgeSum+=Math.abs(lum-lums[index-cols]);edgeCount+=1}
    }
    const mean=sum/count,variance=Math.max(0,sum2/count-mean*mean),coverage=content/count,whiteRate=white/count,darkRate=dark/count,colorRate=colorful/count,colorRich=Math.min(1,colors.size/48),edgeChange=edgeCount?Math.min(1,edgeSum/edgeCount*3):0;
    const borderTotal=Math.max(1,Math.round(count-(cols*.76)*(rows*.76))),borderRate=borderContent/borderTotal;
    const centerRate=centerCount?centerContent/centerCount:coverage,outerRate=edgeCountContent?edgeContent/edgeCountContent:coverage,focal=Math.max(0,Math.min(1,centerRate-outerRate+.5));
    // Long dark runs are common panel borders and speech-bubble outlines, but rare on cover art.
    let longRows=0,longCols=0;
    for(let gy=0;gy<rows;gy++){
      let run=0,maxRun=0;for(let gx=0;gx<cols;gx++){if(lums[gy*cols+gx]<.24){run+=1;maxRun=Math.max(maxRun,run)}else run=0}if(maxRun>=cols*.58)longRows+=1;
    }
    for(let gx=0;gx<cols;gx++){
      let run=0,maxRun=0;for(let gy=0;gy<rows;gy++){if(lums[gy*cols+gx]<.24){run+=1;maxRun=Math.max(maxRun,run)}else run=0}if(maxRun>=rows*.48)longCols+=1;
    }
    const lineDensity=Math.min(1,(longRows+longCols)/Math.max(1,rows+cols));
    const aspect=Number(vp&&vp.height)/Math.max(1,Number(vp&&vp.width)),aspectPenalty=Number.isFinite(aspect)?Math.min(1,Math.max(0,(aspect-2.35)/1.65)):0;
    const pagePosition=Number.isFinite(pageNum)&&pageNum>0?Math.max(0,pageNum-1):0,pagePrior=Number.isFinite(totalPages)&&totalPages>1?Math.max(-.12,.12-pagePosition*.012):0;
    const whitePenalty=Math.pow(Math.max(0,whiteRate-.58),1.35)*5,darkPenalty=Math.pow(Math.max(0,darkRate-.72),1.3)*4;
    const score=coverage*4.2+Math.min(1,variance*5.5)*3.1+colorRich*1.8+colorRate*1.3+edgeChange*1.2+borderRate*1.5+focal*1.1+(1-lineDensity)*2.2-lineDensity*4.4-whitePenalty-darkPenalty-aspectPenalty*1.4+pagePrior;
    return Number.isFinite(score)?score:0;
  }catch(e){return 0}
}

async function loadCoverCandidates(sid){
  const s=findSeries(sid);if(!s||!s.chapters.length)return[];
  const ch=[...s.chapters].filter(c=>c.cached).sort((a,b)=>a.chapterNum-b.chapterNum)[0]||s.chapters[0];
  let ab;try{ab=await db.loadPDF(sid,ch.chapterNum)}catch(e){return[]}
  if(!ab)return[];
  try{
    const doc=await ManhwaPdf.getDocument({data:ab}).promise;
    const maxP=doc.numPages,cands=[];
    for(let p=1;p<=maxP;p++){
      try{
        const pg=await doc.getPage(p),vp=pg.getViewport({scale:.25});
        const cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
        await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
        cands.push({page:p,chapterNum:ch.chapterNum,dataUrl:cv.toDataURL('image/jpeg',.7),score:scoreCover(cv,vp,p,maxP)});
      }catch(e){}
    }
    doc.destroy();
    cands.sort((a,b)=>b.score-a.score);
    return cands.slice(0,12);
  }catch(e){return[]}
}
async function renderCoverCandidate(sid,chapterNum,pageNum){
  const ab=await db.loadPDF(sid,chapterNum);
  const doc=await ManhwaPdf.getDocument({data:ab}).promise;
  try{
    const page=await doc.getPage(pageNum);
    let scale=2;
    let viewport=page.getViewport({scale});
    const maxPixels=4500000;
    if(viewport.width*viewport.height>maxPixels){scale*=Math.sqrt(maxPixels/(viewport.width*viewport.height));viewport=page.getViewport({scale})}
    const cv=document.createElement('canvas');cv.width=Math.ceil(viewport.width);cv.height=Math.ceil(viewport.height);
    await page.render({canvasContext:cv.getContext('2d',{alpha:false}),viewport}).promise;
    return cv.toDataURL('image/jpeg',.92);
  }finally{doc.destroy()}
}
function openSeries(id){let s=findSeries(id);if(!s)return;currentSeries=id;chapters=s.chapters;currentChIdx=-1;currentPage=1;isWebtoon=!1;webtoonScrollPct=0;restoringProgress=!1;renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;renderedPages.clear();prefetchQueue=[];prefetching=!1;chapterLoadToken++;(function fadeOpen(){let bs=$('bookshelf'),rd=$('reader');bs.style.transition='opacity .2s ease';bs.style.opacity='0';setTimeout(function(){bs.classList.add('hidden');bs.style.opacity='';rd.classList.remove('hidden');rd.style.opacity='0';void rd.offsetWidth;rd.style.transition='opacity .2s ease';rd.style.opacity='1';document.body.classList.add('reader-active');chromeShow()},200)})();$('ch-info').textContent=s.name+' — 共 '+chapters.length+' 章';$('ch-count').textContent=chapters.length+' 章';$('page-info').textContent='- / -';$('page-container').innerHTML='';renderChapterList();if(chapters.length>0){let si=0;if(s.lastChNum){let f=chapters.findIndex(c=>c.chapterNum===s.lastChNum);if(f>=0)si=f}const restoreState=s.lastPage&&chapters[si]&&s.lastChNum===chapters[si].chapterNum?{page:s.lastPage,pageProgress:s.lastPageProgress}:null;loadChapter(si,restoreState)}try{history.pushState({mrReader:Date.now()},'')}catch(e){}}

function closeReader(fromPop){// Fire-and-forget: UI first, save in background
  let s=null;if(currentSeries){s=findSeries(currentSeries);if(s&&currentChIdx>=0&&currentChIdx<chapters.length){s.lastChNum=chapters[currentChIdx].chapterNum;s.lastReadAt=Date.now();s.lastPage=isWebtoon?getScrollProgress():currentPage;if(!isWebtoon){let ratio=getNormalPageProgress();if(ratio!==null)s.lastPageProgress=ratio}if(chapters[currentChIdx].status==='reading')chapters[currentChIdx].status='read'}}
  chapterLoadToken++;markCaptureCanvasesIneligible($('page-container'));renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;currentSeries=null;chapters=[];currentChIdx=-1;isWebtoon=!1;renderedPages.clear();
  (function fadeClose(){let rd=$('reader'),bs=$('bookshelf');rd.style.transition='opacity .2s ease';rd.style.opacity='0';setTimeout(function(){rd.classList.add('hidden');rd.style.opacity='';$('page-container').innerHTML='';bs.classList.remove('hidden');bs.style.opacity='0';void bs.offsetWidth;bs.style.transition='opacity .2s ease';bs.style.opacity='1';renderBookshelf();document.body.classList.remove('reader-active');stopReaderChrome()},200)})();
  if(s)saveSeriesBg(s);
  if(!fromPop&&history.state&&history.state.mrReader){try{history.back()}catch(e){}}
}

function renderChapterList(){const cl=$('chapter-list');cl.innerHTML=chapters.map((c,i)=>{let lab=c.chapterNum!==Infinity?'第'+String(c.chapterNum)+'话':'?',dot='<span class="ch-dot dot-'+c.status+'"></span>',wTag=c.isWebtoon?'<span class="ch-type">条漫</span>':'',cls=c.status==='read'?'chapter-item read-item':'chapter-item';return '<div class="'+cls+'" data-idx="'+i+'">'+dot+'<span class="ch-num">'+lab+'</span><span class="ch-name">'+c.name+'</span>'+wTag+'</div>'}).join('');$('ch-count').textContent=chapters.length+' 话 · 已读 '+chapters.filter(c=>c.status==='read').length+' 话';cl.querySelectorAll('.chapter-item').forEach(e=>e.addEventListener('click',function(){if(typeof snapSidebarDrawer==='function')snapSidebarDrawer();loadChapter(parseInt(this.dataset.idx))}))}
function highlightChapter(i){const cl=$('chapter-list');cl.querySelectorAll('.chapter-item').forEach(e=>e.classList.remove('active'));let e=cl.querySelector('[data-idx="'+i+'"]');if(e){e.classList.add('active');e.scrollIntoView({block:'nearest',behavior:'smooth'})}}
function setChapterStatus(i,status){let c=chapters[i];if(c)c.status=status;let el=$('chapter-list').querySelector('[data-idx="'+i+'"] .ch-dot');if(el)el.className='ch-dot dot-'+status}

// Webtoon detection
async function detectWebtoon(){if(!pdfDoc||!settings.webtoonAuto)return!1;try{const viewports=[];for(let p=1;p<=Math.min(pdfDoc.numPages,3);p++){const pg=await pdfDoc.getPage(p);if(pg)viewports.push(pg.getViewport({scale:1}))}return window.ReaderMode?window.ReaderMode.shouldUseWebtoon(viewports):viewports.some(v=>v.height/v.width>3)}catch(e){console.warn('webtoon detect fail',e);return!1}}
function getScrollProgress(){let va=$('viewer-area'),pc=$('page-container');if(!va||!pc)return 0;let top=va.scrollTop,maxH=Math.max(pc.scrollHeight-va.clientHeight,1);return Math.round(top/maxH*100)}
function restoreTokenIsCurrent(token){if(token&&typeof token==='object')return token.chapter===chapterLoadToken&&token.view===viewRestoreGeneration;return token===chapterLoadToken}
function restoreWebtoonScroll(pct,token){return new Promise(resolve=>{let started=Date.now();function apply(){let va=$('viewer-area'),pc=$('page-container');if(token!==undefined&&!restoreTokenIsCurrent(token)){resolve(!1);return}if(!va||!pc){resolve(!1);return}let maxH=pc.scrollHeight-va.clientHeight;if(maxH>0||Date.now()-started>=2000){va.scrollTop=Math.max(maxH,1)*pct/100;resolve(!0);return}setTimeout(apply,16)}apply()})}
function getNormalPageAtAnchor(){if(isWebtoon)return currentPage;let va=$('viewer-area'),pc=$('page-container');if(!va||!pc)return currentPage;let cr=va.getBoundingClientRect(),my=cr.top+cr.height*.3,ws=pc.querySelectorAll('.page-wrapper'),bp=currentPage,bd=Infinity;for(let w of ws){let r=w.getBoundingClientRect();if(!(r.height>0))continue;let d=Math.abs(r.top-my);if(d<bd){bd=d;bp=parseInt(w.dataset.page)}}return bp}
function getNormalPageProgressAt(page){if(!window.ReadingProgress||isWebtoon)return null;let va=$('viewer-area'),w=$('page-container').querySelector('[data-page="'+page+'"]');if(!va||!w)return null;return window.ReadingProgress.pageRatioAtAnchor(va.getBoundingClientRect(),w.getBoundingClientRect())}
function getNormalPageProgress(){return getNormalPageProgressAt(currentPage)}
function captureReaderViewState(){if(!pdfDoc)return null;if(isWebtoon)return{isWebtoon:!0,scrollProgress:getScrollProgress()};let page=getNormalPageAtAnchor();return{isWebtoon:!1,page:page,pageProgress:getNormalPageProgressAt(page)}}
function withInstantScroll(viewer,action){if(!viewer||typeof action!=='function')return;let style=viewer.style,previous=style?style.scrollBehavior:'';if(style)style.scrollBehavior='auto';try{return action()}finally{if(style)style.scrollBehavior=previous}}
async function renderPagesForRestore(page,token){for(let start=1;start<=page;start+=3){if(!restoreTokenIsCurrent(token))return!1;let batch=[];for(let p=start;p<=Math.min(page,start+2);p++)batch.push(renderPage(p));await Promise.all(batch)}return restoreTokenIsCurrent(token)}
async function restoreNormalPageProgress(state,token){if(!state||isWebtoon||!pdfDoc)return!1;let page=Math.max(1,Math.min(pdfDoc.numPages,parseInt(state.page,10)||1));if(!await renderPagesForRestore(page,token))return!1;let va=$('viewer-area'),w=$('page-container').querySelector('[data-page="'+page+'"]');if(!va||!w)return!1;currentPage=page;$('page-slider').value=page;updatePageInfo();if(page===pdfDoc.numPages)setChapterStatus(currentChIdx,'read');let ratio=window.ReadingProgress.normalizePageRatio(state.pageProgress);if(ratio===null)withInstantScroll(va,()=>w.scrollIntoView({behavior:'auto',block:'start'}));else{let vr=va.getBoundingClientRect();vr={top:vr.top,height:vr.height,scrollTop:va.scrollTop};let target=window.ReadingProgress.scrollTopForPageRatio(vr,w.getBoundingClientRect(),ratio),maxTop=Math.max(0,va.scrollHeight-va.clientHeight);if(target!==null)withInstantScroll(va,()=>{va.scrollTop=Math.max(0,Math.min(maxTop,target))})}return!0}

async function loadChapter(i,restoreState){
  if(i<0||i>=chapters.length)return;if(typeof snapSidebarDrawer==='function')snapSidebarDrawer();if(currentChIdx>=0&&currentChIdx<chapters.length&&currentChIdx!==i&&chapters[currentChIdx].status==='reading')setChapterStatus(currentChIdx,'read');
  markCaptureCanvasesIneligible($('page-container'));renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];if(pdfDoc){try{pdfDoc.destroy()}catch(e){}}pdfDoc=null;renderedPages.clear();isWebtoon=!1;webtoonScrollPct=0;
  const myToken=++chapterLoadToken;restoringProgress=!1;currentChIdx=i;let c=chapters[i];setChapterStatus(i,'reading');
  const chBookEl=$('ch-book'),chInfoEl=$('ch-info');if(chBookEl)chBookEl.textContent=currentSeries?(findSeries(currentSeries)?.name||'未命名'):'未加载';if(chInfoEl)chInfoEl.textContent='第'+c.chapterNum+'话 · '+c.name;highlightChapter(i);updateNavButtons();
  $('loading').classList.add('show');$('load-text').textContent='正在加载 第'+c.chapterNum+'话...';
  $('chapter-list').style.pointerEvents='none';$('page-slider').disabled=!0;
  try{let ab=sessionPDFCache.get(currentSeries+'_'+c.chapterNum);if(ab&&!pdfHeaderOk(ab))ab=null;if(!ab){if(c.cached){ab=await db.loadPDF(currentSeries,c.chapterNum)}else{let exists=!1;try{exists=await db.pdfExists(currentSeries,c.chapterNum)}catch(e){}if(exists){try{ab=await db.loadPDF(currentSeries,c.chapterNum);c.cached=!0}catch(e){}}}}if(!ab){$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';showToast('该章节未缓存，请重新导入');return}
  if(myToken!==chapterLoadToken){$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';return}
  pdfDoc=await ManhwaPdf.getDocument({data:ab}).promise;sessionPDFCache.delete(currentSeries+'_'+c.chapterNum);if(myToken!==chapterLoadToken){try{pdfDoc.destroy()}catch(e){}pdfDoc=null;$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';return}
  c.pages=pdfDoc.numPages;
  // Detect webtoon
  isWebtoon=await detectWebtoon();c.isWebtoon=isWebtoon;
  }catch(e){$('loading').classList.remove('show');$('chapter-list').style.pointerEvents='';showToast('加载失败：'+((e&&e.message)||'未知错误'));console.error(e);return}
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
async function drainPrefetchSafe(){prefetching=!0;while(prefetchQueue.length>0){let i=prefetchQueue.shift();if(i>=chapters.length)continue;let c=chapters[i];if(c.loaded||!c.cached)continue;if(Math.abs(i-currentChIdx)>5)continue;try{let ab=await db.loadPDF(currentSeries,c.chapterNum),doc=await ManhwaPdf.getDocument({data:ab}).promise;c.pages=doc.numPages;doc.destroy()}catch(e){console.warn('Prefetch fail:',c.name)}}prefetching=!1}

function waitForReaderViewport(canvas,version){
  return new Promise((resolve,reject)=>{
    let done=false,frame=0;
    const finish=(width,error)=>{if(done)return;done=true;clearTimeout(deadline);if(frame)cancelAnimationFrame(frame);error?reject(error):resolve(width)};
    const deadline=setTimeout(()=>finish(null,new Error('Reader viewport did not become measurable (TIMEOUT)')),1500);
    const measure=()=>{frame=0;if(done)return;if(canvas._captureRenderVersion!==version){finish(null);return}const width=$('viewer-area').clientWidth;if(width>40)finish(width);else frame=requestAnimationFrame(measure)};
    measure();
  });
}
async function renderPage(pn){
  if(!pdfDoc||renderedPages.has(pn))return;
  const w=$('page-container').querySelector('[data-page="'+pn+'"]');if(!w)return;
  const cv=w.querySelector('canvas');if(!cv)return;
  const renderVersion=setCaptureRenderState(cv,'rendering');renderedPages.add(pn);
  try{
    const pg=await pdfDoc.getPage(pn);if(cv._captureRenderVersion!==renderVersion)return;
    const vp=pg.getViewport({scale:zoom});let task;
    if(fitWidth){let width=$('viewer-area').clientWidth;if(width<=40){width=await waitForReaderViewport(cv,renderVersion);if(width===null||cv._captureRenderVersion!==renderVersion)return}let cw=width-40,base=pg.getViewport({scale:1}),sc=cw/base.width,fvp=pg.getViewport({scale:sc});cv.dataset.pdfScale=String(sc);cv.width=fvp.width;cv.height=fvp.height;task=pg.render({canvasContext:cv.getContext('2d'),viewport:fvp})}
    else{cv.dataset.pdfScale=String(zoom);cv.width=vp.width;cv.height=vp.height;task=pg.render({canvasContext:cv.getContext('2d'),viewport:vp})}
    renderTasks.push(task);await task.promise;
    if(setCaptureRenderState(cv,'complete',renderVersion)!==null)w.style.width=cv.style.width||cv.width+'px';
  }catch(e){
    if(setCaptureRenderState(cv,'idle',renderVersion)!==null)renderedPages.delete(pn);
    throw e;
  }
}
function renderVisiblePages(){if(!pdfDoc)return Promise.resolve([]);let cr=$('viewer-area').getBoundingClientRect(),ws=$('page-container').querySelectorAll('.page-wrapper'),tr=[];for(let w of ws){let r=w.getBoundingClientRect();if(r.bottom>=cr.top-400&&r.top<=cr.bottom+400){let p=parseInt(w.dataset.page);if(!renderedPages.has(p))tr.push(p)}}let jobs=[];for(let i=0;i<tr.length;i+=3)tr.slice(i,i+3).forEach(p=>jobs.push(renderPage(p).catch(e=>{if(!e||e.name!=='RenderingCancelledException')console.warn('page render failed',e);return null})));return Promise.all(jobs)}
function reRenderAll(viewState){markCaptureCanvasesIneligible($('page-container'));renderTasks.forEach(t=>{try{t.cancel()}catch(e){}});renderTasks=[];renderedPages.clear();if(!viewState||!pdfDoc)return renderVisiblePages();const viewToken=++viewRestoreGeneration,token={chapter:chapterLoadToken,view:viewToken};restoringProgress=!0;let pending;if(viewState.isWebtoon){renderVisiblePages();pending=restoreWebtoonScroll(viewState.scrollProgress,token)}else pending=restoreNormalPageProgress(viewState,token);return Promise.resolve(pending).catch(e=>console.warn('restore zoom anchor failed',e)).then(()=>{if(token.chapter!==chapterLoadToken||token.view!==viewRestoreGeneration)return;restoringProgress=!1;return renderVisiblePages()})}

function requestZoomChange(value){
  pendingZoomValue=value;
  if(zoomChangeRun)return zoomChangeRun;
  zoomChangeRun=(async function(){
    while(pendingZoomValue!==null){
      const next=pendingZoomValue;pendingZoomValue=null;
      const viewState=captureReaderViewState();
      fitWidth=next==='fit';
      if(!fitWidth){const parsed=parseFloat(next);if(Number.isFinite(parsed))zoom=parsed}
      settings.zoom=next;
      const select=$('zoom-select');if(select)select.value=next;
      try{await reRenderAll(viewState);if(fitWidth){const viewer=$('viewer-area');withInstantScroll(viewer,()=>{if(viewer)viewer.scrollLeft=0})}}catch(e){console.warn('zoom rerender failed',e)}
    }
  })();
  const finished=zoomChangeRun;
  finished.then(()=>{if(zoomChangeRun!==finished)return;zoomChangeRun=null;if(pendingZoomValue!==null)requestZoomChange(pendingZoomValue)},e=>{if(zoomChangeRun===finished)zoomChangeRun=null;if(pendingZoomValue!==null)requestZoomChange(pendingZoomValue);console.warn('zoom request failed',e)});
  return finished;
}

function goToPage(n,options){if(!pdfDoc||isWebtoon)return;options=options||{};n=Math.max(1,Math.min(pdfDoc.numPages,n));currentPage=n;$('page-slider').value=n;updatePageInfo();let w=$('page-container').querySelector('[data-page="'+n+'"]');if(w)w.scrollIntoView({behavior:options.behavior||'smooth',block:'start'});if(n===pdfDoc.numPages)setChapterStatus(currentChIdx,'read');if(!options.suppressSave)saveProgress(0)}
function nextPage(){if(!pdfDoc)return;if(isWebtoon){scrollWebtoon(.5);return}if(currentPage<pdfDoc.numPages)goToPage(currentPage+1);else nextChapter()}
function prevPage(){if(!pdfDoc)return;if(isWebtoon){scrollWebtoon(-.5);return}if(currentPage>1)goToPage(currentPage-1);else prevChapter()}
function scrollWebtoon(dir){let va=$('viewer-area'),h=va.clientHeight*.7;va.scrollBy({top:dir*h,behavior:'smooth'})}
async function nextChapter(){if(currentChIdx+1<chapters.length){setChapterStatus(currentChIdx,'read');await loadChapter(currentChIdx+1);showToast('▶ 第'+chapters[currentChIdx].chapterNum+'话')}else showToast('已经是最后一章了')}
async function prevChapter(){if(currentChIdx>0){setChapterStatus(currentChIdx,'read');await loadChapter(currentChIdx-1);if(!isWebtoon)goToPage(chapters[currentChIdx].pages||1);showToast('◀ 第'+chapters[currentChIdx].chapterNum+'话')}else showToast('已经是第一章了')}
function updateNavButtons(){$('btn-prev-ch').disabled=currentChIdx<=0;$('btn-next-ch').disabled=currentChIdx>=chapters.length-1}
function updatePageInfo(){let t='- / -';if(pdfDoc)t=isWebtoon?'滚动 '+getScrollProgress()+'%':currentPage+' / '+pdfDoc.numPages;$('page-info').textContent=t;const hud=$('page-hud');if(hud)hud.textContent=t}
let chromeHidden=!1;
function chromeShow(){chromeHidden=!1;document.body.classList.remove('reader-chrome-hidden');updateImmersiveBtn()}
function chromeHide(){if(chromeHidden)return;chromeHidden=!0;document.body.classList.add('reader-chrome-hidden');updateImmersiveBtn()}
function stopReaderChrome(){chromeHidden=!1;document.body.classList.remove('reader-chrome-hidden');updateImmersiveBtn()}
function updateImmersiveBtn(){const label=chromeHidden?'退出沉浸':'沉浸模式';const b=$('btn-immersive');if(b)b.textContent=label;const m=$('reader-more-immersive');if(m)m.textContent=label}
(function(){const rd=$('reader');let sx=0,sy=0,st=0;rd.addEventListener('pointerdown',function(e){sx=e.clientX;sy=e.clientY;st=Date.now()});rd.addEventListener('click',function(e){if(e.target.closest('#topbar,#bottombar,#sidebar'))return;if(Math.abs(e.clientX-sx)>14||Math.abs(e.clientY-sy)>14||Date.now()-st>650)return;if(chromeHidden)chromeShow()})})();
async function saveProgress(pageProgressOverride){if(currentChIdx<0||!currentSeries||restoringProgress)return;let s=findSeries(currentSeries);if(s){s.lastChNum=chapters[currentChIdx].chapterNum;s.lastReadAt=Date.now();s.lastPage=isWebtoon?getScrollProgress():currentPage;if(!isWebtoon){let ratio=pageProgressOverride===undefined?getNormalPageProgress():window.ReadingProgress.normalizePageRatio(pageProgressOverride);if(ratio!==null)s.lastPageProgress=ratio}saveSeriesBg(s)}}

// ===== Event Bindings =====
$('viewer-area').addEventListener('scroll',()=>{if(scrollTimer)clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(!pdfDoc)return;if(!isWebtoon){let cr=$('viewer-area').getBoundingClientRect(),my=cr.top+cr.height*.3,ws=$('page-container').querySelectorAll('.page-wrapper'),bp=currentPage,bd=Infinity;for(let w of ws){let r=w.getBoundingClientRect();if(!(r.height>0))continue;let d=Math.abs(r.top-my);if(d<bd){bd=d;bp=parseInt(w.dataset.page)}}if(bp!==currentPage){currentPage=bp;$('page-slider').value=currentPage;updatePageInfo()}saveProgress()}else{updatePageInfo();saveProgress();if(getScrollProgress()>=99&&currentChIdx<chapters.length){chapters[currentChIdx].status='read'}}renderVisiblePages()},150)});
function bindMobileReaderGestures(){
  const viewer=$('viewer-area');
  if(!viewer||viewer._mobileGestureBound||!window.MobileReader)return;
  viewer._mobileGestureBound=!0;
  const pointers=new Map();
  let swipeStart=null,swipePanning=false,panStartLeft=0,touchPinching=false;
  let pinchStartDistance=0,pinchStartZoom=1,pinchStartValue=1,pinchLastZoom=1,pinchFrame=0,pinchTarget=null;
  const point=e=>({x:e.clientX,y:e.clientY});
  const blocked=()=>captureUiActive||!pdfDoc||$('reader').classList.contains('hidden')||$('modal-overlay').classList.contains('show');
  const distance=()=>{const values=[...pointers.values()];if(values.length<2)return 0;return Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y)};
  const schedulePinchZoom=value=>{if(value===pinchLastZoom)return;pinchLastZoom=value;pinchTarget=value;if(pinchFrame)return;pinchFrame=requestAnimationFrame(()=>{pinchFrame=0;if(pinchTarget!==null&&!blocked())requestZoomChange(String(pinchTarget));pinchTarget=null})};
  const beginPinch=initialDistance=>{pinchStartDistance=initialDistance;pinchStartValue=fitWidth?'fit':zoom;const canvas=fitWidth&&viewer.querySelector('.page-wrapper[data-page="'+currentPage+'"] canvas');pinchStartZoom=canvas?Number(canvas.dataset.pdfScale)||zoom:zoom;pinchLastZoom=pinchStartValue;swipeStart=null;swipePanning=false};
  const pinchValue=nextDistance=>{const ratio=nextDistance/pinchStartDistance;return Math.abs(ratio-1)<0.03?pinchStartValue:window.MobileReader.clampPinchZoom(pinchStartZoom*ratio)};
  const reset=cancelled=>{if(pinchFrame)cancelAnimationFrame(pinchFrame);pinchFrame=0;if(!cancelled&&pinchTarget!==null&&!blocked())requestZoomChange(String(pinchTarget));pinchTarget=null;pointers.clear();swipeStart=null;swipePanning=false;pinchStartDistance=0};
  viewer.addEventListener('pointerdown',function(e){
    if(e.pointerType!=='touch'||touchPinching||blocked()||e.target.closest('button,input,select,a'))return;
    pointers.set(e.pointerId,point(e));
    if(pointers.size===1){swipeStart=point(e);swipePanning=!fitWidth&&viewer.scrollWidth>viewer.clientWidth+1;panStartLeft=viewer.scrollLeft}
    if(pointers.size===2)beginPinch(distance());
  },{passive:true});
  viewer.addEventListener('pointermove',function(e){
    if(e.pointerType!=='touch'||touchPinching||!pointers.has(e.pointerId))return;
    if(blocked()){reset(true);return}
    pointers.set(e.pointerId,point(e));
    if(pointers.size===1&&swipeStart&&swipePanning){const dx=e.clientX-swipeStart.x,dy=e.clientY-swipeStart.y;if(Math.abs(dx)>Math.abs(dy)){if(e.cancelable)e.preventDefault();viewer.scrollLeft=panStartLeft-dx}return}
    if(pointers.size<2||!pinchStartDistance)return;
    if(e.cancelable)e.preventDefault();
    const next=pinchValue(distance());
    schedulePinchZoom(next);
  },{passive:false});
  const finish=e=>{
    if(e.pointerType!=='touch'||touchPinching||!pointers.has(e.pointerId))return;
    pointers.delete(e.pointerId);
    if(pointers.size<2)pinchStartDistance=0;
    if(pointers.size!==0)return;
    if(swipeStart&&!swipePanning&&!isWebtoon&&!blocked()){const direction=window.MobileReader.swipeDirection(swipeStart,point(e));if(direction==='next')nextPage();if(direction==='previous')prevPage()}
    reset(false);
  };
  viewer.addEventListener('pointerup',finish,{passive:true});
  viewer.addEventListener('pointercancel',e=>{if(e.pointerType==='touch'&&!touchPinching)reset(true)},{passive:true});
  // Touch events cancel browser pinch before it takes over; one-finger vertical scrolling remains native.
  const touchDistance=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
  viewer.addEventListener('touchstart',e=>{if(e.touches.length<2||blocked())return;reset(true);touchPinching=true;beginPinch(touchDistance(e));if(e.cancelable)e.preventDefault()},{passive:false});
  viewer.addEventListener('touchmove',e=>{if(!touchPinching)return;if(blocked()){reset(true);touchPinching=false;return}if(e.cancelable)e.preventDefault();if(e.touches.length<2||!pinchStartDistance)return;schedulePinchZoom(pinchValue(touchDistance(e)))},{passive:false});
  viewer.addEventListener('touchend',e=>{if(touchPinching&&e.touches.length===0){reset(false);touchPinching=false}},{passive:true});
  viewer.addEventListener('touchcancel',()=>{reset(true);touchPinching=false},{passive:true});
}
bindMobileReaderGestures();
window.addEventListener('popstate',function(){if(currentSeries)closeReader(!0)});
$('page-slider').addEventListener('input',function(){goToPage(parseInt(this.value))});
$('zoom-select').addEventListener('change',function(){let v=this.value;requestZoomChange(v);db.saveSetting('zoom',v)});
$('btn-back').addEventListener('click',closeReader);
$('btn-reader-more').addEventListener('click',function(){showModal('reader-more')});
$('btn-toggle-sidebar').addEventListener('click',function(){$('sidebar').classList.toggle('hidden')});
// 手机端抽屉：统一收起 / 遮罩同步 / 点遮罩关闭
(function wireSidebarDrawer(){
  function isMobile(){return window.matchMedia&&window.matchMedia('(max-width:780px)').matches}
  function syncBackdrop(){
    const sb=$('sidebar'),bd=$('sidebar-backdrop');if(!bd)return;
    if(isMobile()&&sb&&!sb.classList.contains('hidden')){bd.hidden=false;bd.style.display='block'}
    else{bd.hidden=true;bd.style.display='none'}
  }
  // drawer class 变化 → 同步 backdrop
  if(typeof MutationObserver!=='undefined'){
    const sb=$('sidebar'),mo=new MutationObserver(syncBackdrop);
    if(sb)mo.observe(sb,{attributes:!0,attributeFilter:['class']})}
  window.addEventListener('resize',syncBackdrop);
  // 点遮罩关闭
  const bd=$('sidebar-backdrop');
  if(bd)bd.addEventListener('click',()=>{const sb=$('sidebar');if(sb)sb.classList.add('hidden')});
  // 暴露给导航函数用
  window.snapSidebarDrawer=function(){if(isMobile()){const sb=$('sidebar');if(sb)sb.classList.add('hidden')}}
})();
$('btn-prev-pg').addEventListener('click',prevPage);$('btn-next-pg').addEventListener('click',nextPage);
$('btn-prev-ch').addEventListener('click',prevChapter);$('btn-next-ch').addEventListener('click',nextChapter);
$('btn-cache-mgr').addEventListener('click',async function(){let stats=await db.getCacheStats(),si=await db.getStorageEstimate();showModal('cache-mgr',{stats,storageInfo:si})});$('bs-settings-btn').addEventListener('click',function(){showModal('settings')});
$('btn-settings').addEventListener('click',function(){showModal('settings')});const setCoverBtn=$('btn-set-cover');if(setCoverBtn)setCoverBtn.addEventListener('click',function(){if(!currentSeries)return;showModal('set-cover',{sid:currentSeries})});
$('bs-search').addEventListener('input',function(){searchQuery=this.value;renderBookshelf()});
$('bs-sort').addEventListener('change',function(){sortMode=this.value;renderBookshelf()});
$('bs-add-btn').addEventListener('click',function(){_pendingFilesMode=hasFolderPicker?'folder':'input';showAddModal()});
$('btn-immersive').addEventListener('click',function(){if(chromeHidden)chromeShow();else chromeHide()});
const themeToggleBtn=$('bs-theme-toggle');if(themeToggleBtn)themeToggleBtn.addEventListener('click',async function(){let t=document.documentElement.getAttribute('data-theme')==='day'?'night':'day';document.documentElement.setAttribute('data-theme',t);settings.theme=t;try{await db.saveSetting('theme',t)}catch(e){}showToast(t==='day'?'已切换到日间模式':'已切换到夜间模式')});
$('btn-add-files-reader').addEventListener('click',async function(){if(!currentSeries)return;let files=await pickFilesViaInput();if(files&&files.length)await importFilesToSeries(currentSeries,files)});
$('btn-add-folder-reader').addEventListener('click',async function(){if(!currentSeries)return;let files=await pickFolder();if(files&&files.length)await importFilesToSeries(currentSeries,files)});

let sidebarResizing=!1,sX=0,sW=0;const sidebarEl=$('sidebar'),resizerEl=$('sidebar-resizer');
resizerEl.addEventListener('mousedown',function(e){sidebarResizing=!0;sX=e.clientX;sW=sidebarEl.offsetWidth;document.body.style.cursor='col-resize';document.body.style.userSelect='none';e.preventDefault()});
document.addEventListener('mousemove',function(e){if(!sidebarResizing)return;let w=Math.max(180,Math.min(480,sW+(e.clientX-sX)));sidebarEl.style.width=w+'px';sidebarEl.style.minWidth=w+'px';sidebarEl.style.maxWidth=w+'px'});
document.addEventListener('mouseup',function(){if(!sidebarResizing)return;sidebarResizing=!1;document.body.style.cursor='';document.body.style.userSelect=''});

function handleReaderKeyDown(e){if(captureUiActive)return;if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;switch(e.key){
  case'ArrowRight':case'd':e.preventDefault();nextPage();break;case'ArrowLeft':case'a':e.preventDefault();prevPage();break;
  case'ArrowDown':case's':e.preventDefault();nextChapter();break;case'ArrowUp':case'w':e.preventDefault();prevChapter();break;
  case'f':e.preventDefault();$('zoom-select').value='fit';requestZoomChange('fit');db.saveSetting('zoom','fit');break;
  case'b':e.preventDefault();$('sidebar').classList.toggle('hidden');break;case'Escape':e.preventDefault();if(chromeHidden){chromeShow()}else{closeReader()}break}}
document.addEventListener('keydown',handleReaderKeyDown);

function preventAndStop(e){e.preventDefault();e.stopPropagation()}
document.addEventListener('dragover',function(e){preventAndStop(e);$('drop-overlay').classList.add('show')});
document.addEventListener('dragenter',function(e){preventAndStop(e);$('drop-overlay').classList.add('show')});
document.addEventListener('dragleave',function(e){preventAndStop(e);$('drop-overlay').classList.remove('show')});
document.addEventListener('drop',function(e){preventAndStop(e);$('drop-overlay').classList.remove('show');if(e.dataTransfer)dropHandler(e.dataTransfer)});

async function dropHandler(dt){try{let pdfs=[];if(dt.files&&dt.files.length>0){let fp=Array.from(dt.files).filter(f=>f&&f.name&&f.name.toLowerCase().endsWith('.pdf'));if(fp.length>0)pdfs=fp}if(pdfs.length===0&&dt.items&&dt.items.length>0){if(window.location.protocol==='file:'&&dt.items.length>0){let hasDir=!1;for(let it of Array.from(dt.items)){if(it&&it.kind==='file'){let en=null;try{en=it.webkitGetAsEntry?it.webkitGetAsEntry():null}catch(e){}if(en&&en.isDirectory){hasDir=!0;break}}}if(hasDir){showToast('检测到文件夹拖入。请使用「启动阅读器.bat」以 http://localhost 方式打开，或点击按钮选择文件夹');return}}let fs=[],es=[];for(let it of Array.from(dt.items)){if(!it||it.kind!=='file')continue;let en=null;try{en=it.webkitGetAsEntry?it.webkitGetAsEntry():null}catch(e){}if(en)es.push(en);else{try{let f=it.getAsFile();if(f)fs.push(f)}catch(e){}}}let allFiles=[...fs];for(let e of es){try{await collectFiles(e,allFiles)}catch(e){}}pdfs=allFiles.filter(f=>f&&f.name&&f.name.toLowerCase().endsWith('.pdf'))}if(!pdfs.length){showToast('未找到PDF文件');return}showToast('已接收 '+pdfs.length+' 个 PDF 文件');_pendingFiles=pdfs;_pendingFilesMode='drop';if(currentSeries){await importFilesToSeries(currentSeries,pdfs)}else{showModal('add-choose')}}catch(err){console.error('Drop handler error:',err);showToast('拖拽处理失败')}}
async function collectFiles(entry,out){if(!entry)return;if(entry.isFile){out.push(await new Promise((r,rj)=>entry.file(r,rj)))}else if(entry.isDirectory){let rd=entry.createReader(),batch;do{batch=await new Promise((r,rj)=>rd.readEntries(r,rj));for(let e of batch)await collectFiles(e,out)}while(batch.length>0)}}

function showToast(m){let t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._timeout);t._timeout=setTimeout(function(){t.classList.remove('show')},2000)}
window.addEventListener('resize',function(){if(fitWidth)reRenderAll(captureReaderViewState());const g=Qs('bs-grid');if(g&&g.dataset.count)applyRackSizing(parseInt(g.dataset.count||'0',10));syncRackFixedBodies()});
document.addEventListener('contextmenu',function(e){let card=e.target.closest('.rack-book');if(!card)return;e.preventDefault();let sid=card.dataset.id,s=findSeries(sid);if(s)showModal('rack-menu',{sid:sid})});
initApp().then(()=>console.log('📚 v10 — interactive rack + import cover select'));
