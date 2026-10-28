'use strict';
/* The dashboard talks to the engine over /api + /ws.  Every panel shows real
   store data or an explicit waiting/unavailable banner (liveWait) — never
   mock data.
   Wired live: pipeline log, stage HUD, progress, view gating, run/cancel/
   save/clear, image + boundaries + SST/fills + pins, distance scatter,
   normal coords, spectrum, RMSE-vs-r, clusters, Karcher mean + convergence,
   PGA mode sweep, per-shape RMSE histogram, and (mmd) witness + decisions.

   LIVE is kept as a named constant rather than inlined: it marks the boundary
   between the shared drawing layer and the live-data closures, and reads at
   each site as "this needs engine data". */
const QSP = new URLSearchParams(location.search);
const TOKEN = QSP.get('t') || '';
const LIVE = true;
/* live-layer shim registry: everything the live closures expose to
   the shared drawing/UI layer lives on this one object — one greppable
   surface instead of ~40 window globals.  Members are set inside the
   `if (LIVE)` IIFEs; readers guard with `LIVEAPI.x && LIVEAPI.x(...)`. */
const LIVEAPI = window.LIVEAPI = {};

/* ---------- utilities ---------- */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function hexRGB(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function mix(a,b,t){return '#'+[0,1,2].map(i=>Math.round(a[i]+(b[i]-a[i])*t).toString(16).padStart(2,'0')).join('');}
function ramp3(t,lo,md,hi){const L=hexRGB(css(lo)),M=hexRGB(css(md)),H=hexRGB(css(hi));return t<0.5?mix(L,M,t*2):mix(M,H,(t-0.5)*2);}
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
/* ---------- fill colormaps: user-selectable, kind-locked ----------
   Each fill quantity offers only maps of its CORRECT class: sequential for
   distances (magnitude), diverging for witness (polarity — neutral midpoint),
   categorical for clusters (identity).  The evie defaults read the theme
   tokens (track light/dark); the alternatives are published CVD-safe maps —
   viridis/cividis (perceptually uniform), ColorBrewer RdBu/PuOr (RdBu matches
   plot_witness's blue-white-red convention on both language surfaces), and a
   Tol-vibrant categorical with per-theme steps re-validated via the dataviz
   validator on EVIE's own surfaces (floor-band CVD is legal here because the
   cluster legend is always shown as secondary encoding). */
function stopRamp(stops){
  return t=>{
    t=clamp(t,0,1)*(stops.length-1);
    const i=Math.min(Math.floor(t),stops.length-2), f=t-i;
    return mix(hexRGB(stops[i]),hexRGB(stops[i+1]),f);
  };
}
const CMAPS={
  seq:{
    evie:   {label:'evie',    fn:t=>ramp3(clamp(t,0,1),'--ramp-lo','--ramp-mid','--ramp-hi')},
    viridis:{label:'viridis', fn:stopRamp(['#440154','#482878','#3e4989','#31688e','#26828e','#1f9e89','#35b779','#6ece58','#b5de2b','#fde725'])},
    cividis:{label:'cividis', fn:stopRamp(['#00224e','#123570','#3b496c','#575d6d','#707173','#8a8678','#a59c74','#c3b369','#e1cc55','#fee838'])},
  },
  div:{
    evie:{label:'evie',          fn:t=>ramp3(clamp(t,0,1),'--div-lo','--div-mid','--div-hi')},
    rdbu:{label:'blue–red',      fn:stopRamp(['#053061','#2166ac','#4393c3','#92c5de','#d1e5f0','#f7f7f7','#fddbc7','#f4a582','#d6604d','#b2182b','#67001f'])},
    puor:{label:'purple–orange', fn:stopRamp(['#2d004b','#542788','#8073ac','#b2abd2','#d8daeb','#f7f7f7','#fee0b6','#fdb863','#e08214','#b35806','#7f3b08'])},
  },
  cat:{
    evie:   {label:'evie',    n:8, colors:()=>Array.from({length:8},(_,i)=>css('--clust-'+(i+1)))},
    vibrant:{label:'vibrant', n:6, colors:()=>Array.from({length:6},(_,i)=>css('--clust2-'+(i+1)))},
  },
};
const ramp  = t => CMAPS.seq[S.cmap.seq].fn(t);
const dramp = t => CMAPS.div[S.cmap.div].fn(t);
function clustColors(){
  /* CATEGORICAL cluster identities (not magnitudes → distinct hues, not a ramp;
     owner-confirmed 2026-07-07).  The default is the validated CVD-safe 8-hue
     set from the dataviz skill (light worst-adjacent CVD ΔE 24.2, dark 10.3
     floor band → the cluster legend is the required secondary encoding); the
     active map is the user's categorical pick, read from theme tokens. */
  return CMAPS.cat[S.cmap.cat].colors();
}
const CLUST_MAX=8;                                     // absolute ceiling (evie map)
const clustMax = ()=>CMAPS.cat[S.cmap.cat].n;          // active map's k ceiling
/* "cluster N" tinted with that cluster's categorical hue (matches legend+fills);
   used in pinned shape cards and hover tooltips (both innerHTML). */
const clustLabel = o => (o && o.clust!=null)
  ? `<span style="color:${clustColors()[o.clust%CLUST_MAX]}">cluster ${o.clust+1}</span>` : '';

/* ---------- app state ---------- */
const NOM = {w:1280, h:960};
const AR = NOM.w/NOM.h;
let pinW = 300;                /* pinned-card base width (mmd tray width / g2 grid min-column), resizable via the pin splitter; grid cards grow past this to fill leftover space */
let imgWOverride = null;       /* g2: explicit image-panel width set by the pin splitter (null = aspect max) */
/* Floor for the g2 image panel.  Its default width is derived
   from the available HEIGHT times the image aspect ratio, so on a short screen
   vertical scarcity squeezed the panel horizontally until the toolbar had
   nowhere to go — the pane looked broken and the controls were unreachable.
   Letterboxing a smaller image inside a usable panel is the better trade.
   Same value the drag-resize clamp already used, shared so they cannot drift. */
const IMG_MIN_W = 320;
const NMODES = 200;
/* rSel = the run's computed dimensionality — LOCKED (set at load, immovable in
   the UI; the solid green vertical in the spectrum/RMSE tiles).  Ensemble views
   (SST, fills) always render at rSel: what you see is what the run computed.
   rProbe = an optional second line dragged OFF the locked one; it re-renders
   ONLY the pinned shape cards (bounded by pin count → real-time at any N). */
let rSel = 150;
let rProbe = null;
const cardR = ()=> rProbe!=null ? rProbe : rSel;   /* dimensionality pinned cards render at */
/* move (or spawn) the probe line; fin=true on drag release.  Dropping the
   probe back on the locked run line clears it (cards return to run r). */
function setProbe(r, fin){
  rProbe = clamp(Math.round(r), 1, nModes());
  if (fin && rProbe===rSel) rProbe=null;
  drawEig(); drawRConv();
  if (LIVEAPI.probeRecon) LIVEAPI.probeRecon();   /* live: fetch pinned ids at r′ (latest-wins) */
  drawPins();                                   /* redraw cached pin geometry */
  if (fin){
    /* only quote RMSE when the real curve is loaded (never the mock in live) */
    const rmse = curRmse() ? ` · RMSE≈${liveRmseAt(rProbe).toFixed(3)}` : '';
    logLine(rProbe==null
      ? `<span class="okm">·</span>probe cleared — pinned cards back at run r=${rSel}`
      : `<span class="okm">✓</span>probe r′=${rProbe}${rmse} — pinned cards re-rendered`);
  }
}
const S = {
  mode:'g2', view:'seg', fillBy:'dProd', clustK:4, clustBasis:'joint',
  clustMethod:'average',            // registry key; 'average' = historical default
  witCol:0,   // witCol: 0=gr, 1=spd (test=both)
  dlandScale:null,   // decision-landscape source: null=run grid, i=sweep scale index
  cmap:{seq:'evie', div:'evie', cat:'evie'},   // active colormap per fill kind
  /* live: image keys are assigned when loadImages() populates the store */
  g2img: null,
  mmdA:  null,
  mmdB:  null,
  hover:{canvas:null, sample:null},
};
const view={}, cropRect={}, cropMode={}, imgHit={}, lastRect={};
/* pin state lives in the live layer (LIVEAPI.livePinList); the module-level
   `pins` array was written only by the demo hook and went with it. */
/* background-image brightness per view (owner request: a dimming slider so
   overlays can be compared against the source image at any contrast).
   sst defaults dim so original-vs-reconstruction pops; seg defaults full. */
const DIM={raw:1, seg:1, sst:0.3};
function syncDimSliders(){
  document.querySelectorAll('.dimr').forEach(sl=>{
    const applicable = DIM[S.view]!=null;
    sl.style.display = applicable ? '' : 'none';
    if (applicable) sl.value = Math.round(DIM[S.view]*100);
  });
}

/* ---------- theme ---------- */
const themeBtn = document.getElementById('themeBtn');
const hashTokens = location.hash.replace('#','').split(',');
/* headless-smoke hash hooks: one idiom for flags and options */
const hashFlag = n => hashTokens.includes(n);
const hashOpt  = n => { const t = hashTokens.find(t => t.startsWith(n + '='));
                        return t ? t.slice(n.length + 1) : null; };
if (hashFlag('light')){ document.documentElement.setAttribute('data-evie','light'); themeBtn.textContent='dark'; }
themeBtn.addEventListener('click', () => {
  const r=document.documentElement;
  const light=r.getAttribute('data-evie')==='light';
  if (light){ r.removeAttribute('data-evie'); themeBtn.textContent='light'; }
  else { r.setAttribute('data-evie','light'); themeBtn.textContent='dark'; }
  drawAll();
});

/* ---------- clean exit (quit): cancel any run + shut the server down ---------- */
function evieModal(html, variant){
  let sc=document.getElementById('modalScrim');
  if(!sc){ sc=document.createElement('div'); sc.id='modalScrim'; sc.className='modal-scrim'; document.body.appendChild(sc); }
  sc.innerHTML=`<div class="modal-card${variant?' '+variant:''}">${html}</div>`; sc.hidden=false; return sc;
}
function evieModalHide(){ const sc=document.getElementById('modalScrim'); if(sc) sc.hidden=true; }
{ const qb=document.getElementById('quitBtn');
  if (qb) qb.addEventListener('click', ()=>{
    const st=(LIVEAPI.liveStatus&&LIVEAPI.liveStatus())||{};
    const warn = st.running ? '<p class="warn-line">⚠ A computation is running — it will be interrupted.</p>'
               : (st.hasResults && !st.saved) ? '<p class="warn-line">⚠ Displayed results are not saved.</p>' : '';
    evieModal(`<h2>Quit EVIE dashboard?</h2>${warn}`
      +`<p class="side-note">Cancels any running work and shuts the server down. Save first if you want to keep results.</p>`
      +`<div class="modal-actions"><button id="mCancel">cancel</button>`
      +`<button id="mQuit" class="danger">⏻ quit &amp; shut down</button></div>`);
    document.getElementById('mCancel').addEventListener('click', evieModalHide);
    document.getElementById('mQuit').addEventListener('click', async ()=>{
      try { await fetch('/api/shutdown',{method:'POST',
        headers:{'x-evie-token':TOKEN,'content-type':'application/json'},body:'{}'}); } catch(_){}
      evieModal(`<h2>EVIE dashboard stopped</h2>`
        +`<p>Any running computation was interrupted and the server has shut down.</p>`
        +`<p class="side-note">Safe to close this tab.</p>`);
    });
  });
  if (hashFlag('quitmodal'))   // headless smoke: open the quit confirm
    setTimeout(()=>{ if(qb) qb.click(); }, 500);
}

function inPoly(pts,x,y){let c=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}return c;}

/* ---------- canvas + aspect-locked viewport ---------- */
function fit(cv){
  const r=cv.parentElement.getBoundingClientRect();
  const d=devicePixelRatio||1;
  cv.width=Math.max(1,r.width*d); cv.height=Math.max(1,r.height*d);
  const ctx=cv.getContext('2d'); ctx.setTransform(d,0,0,d,0,0);
  return [ctx,r.width,r.height];
}
/* HTML-escape untrusted text (filenames, dataset/label names read off the
   filesystem) before it is interpolated into innerHTML — defense-in-depth
   against a crafted filename injecting markup/script (see SECURITY.md).
   Sinks that use textContent (terminal echo, log lines) are already safe. */
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/* pin-card canvases size to THEMSELVES (their parent card is taller than
   the canvas, so fit() there would squash the aspect — equal axis breaks) */
function fitSelf(cv){
  const r=cv.getBoundingClientRect();
  const d=devicePixelRatio||1;
  cv.width=Math.max(1,r.width*d); cv.height=Math.max(1,r.height*d);
  const ctx=cv.getContext('2d'); ctx.setTransform(d,0,0,d,0,0);
  return [ctx,r.width,r.height];
}
function imgRect(W,H,ar){
  ar = ar || AR;
  let rw=W-14, rh=rw/ar;
  if (rh>H-14){ rh=H-14; rw=rh*ar; }
  return {rx:(W-rw)/2, ry:(H-rh)/2, rw, rh};
}
/* aspect of the currently-shown image for a canvas: real in live mode,
   nominal otherwise. Overridden by the live layer when images are loaded. */
function arFor(cvId){ return (LIVEAPI.liveAR && LIVEAPI.liveAR(cvId)) || AR; }
function getView(cvId){ return view[cvId] || (view[cvId]={z:1,cx:0.5,cy:0.5}); }
function clampView(V){
  V.z=clamp(V.z,1,12);
  const hw=0.5/V.z;
  V.cx=clamp(V.cx,hw,1-hw); V.cy=clamp(V.cy,hw,1-hw);
}
function u2s(u,v,R,V){ return [ R.rx+((u-V.cx)*V.z+0.5)*R.rw, R.ry+((v-V.cy)*V.z+0.5)*R.rh ]; }
function s2u(x,y,R,V){ return [ ((x-R.rx)/R.rw-0.5)/V.z+V.cx, ((y-R.ry)/R.rh-0.5)/V.z+V.cy ]; }

function clustOn(){ return S.view==='fill' && S.fillBy==='clust'; }

/* ---------- live waiting banners ----------
   NO mock data is ever drawn: panels show a text banner until their real data
   arrives. */
function paintBanner(ctx,W,H,msg,sub){
  ctx.fillStyle=css('--bg'); ctx.fillRect(0,0,W,H);
  ctx.strokeStyle=css('--border'); ctx.strokeRect(6,6,W-12,H-12);
  ctx.fillStyle=css('--text-sec'); ctx.textAlign='center';
  ctx.font='15px '+css('--font-mono');          /* readable at a glance (6c) */
  ctx.fillText(msg, W/2, H/2 - (sub?10:0));
  if (sub){ ctx.font='12px '+css('--font-mono'); ctx.globalAlpha=0.7;
    ctx.fillText(sub, W/2, H/2+14); ctx.globalAlpha=1; }
  ctx.textAlign='left';
}
const _WIRED_TILES={spec:1,sct:1,pga:1,rconv:1,whist:1,mean:1,rmse:1,sweep:1,
                    dland:1,ssweep:1};
function liveWait(ctx,W,H,kind){
  if (_WIRED_TILES[kind]){
    const tileReady = LIVEAPI.liveTileReady && LIVEAPI.liveTileReady(kind);
    if (tileReady) return false;
    const st=(LIVEAPI.liveStatus&&LIVEAPI.liveStatus())||{};
    if (LIVEAPI.liveDataReady && LIVEAPI.liveDataReady()){
      /* run finished but this tile's quantity was not produced
         (e.g. spectrum/rmse in mmd, witness in g2image) */
      paintBanner(ctx,W,H,'not available for this run',
        kind==='whist'?'witness values come from mmdG2Image runs'
                      :'produced by g2image runs');
    } else {
      paintBanner(ctx,W,H, st.running?'computing…':'waiting for a run',
        st.running?'results appear as stages finish':'pick a dataset and press ▶ run');
    }
  } else {
    paintBanner(ctx,W,H,'not yet wired to engine results','');
  }
  return true;
}
/* data-source getters: real store data, or empty until a run produces it */
function curSamples(){
  const s = LIVEAPI.liveSamples && LIVEAPI.liveSamples();
  return s || [];
}
function curSpectrum(){ return LIVEAPI.liveSpectrum ? LIVEAPI.liveSpectrum() : null; }
function curRmse(){ return LIVEAPI.liveRmse ? LIVEAPI.liveRmse() : null; }
function nModes(){
  if (LIVEAPI.liveNModes){ const n=LIVEAPI.liveNModes(); if (n) return n; }
  const sp=curSpectrum(); return sp ? sp.length : NMODES;
}
const AXES={
  t1:{lbl:'t₁',get:o=>o.t[0]}, t2:{lbl:'t₂',get:o=>o.t[1]},
  t3:{lbl:'t₃',get:o=>o.t[2]}, t4:{lbl:'t₄',get:o=>o.t[3]},
  s1:{lbl:'s₁ scale',get:o=>o.s[0]}, s2:{lbl:'s₂ scale',get:o=>o.s[1]}, s3:{lbl:'s₃ scale',get:o=>o.s[2]},
};
const P={pgaX:'t1',pgaY:'t2',meanView:'shape',sweepK:1,sweepT:0};
let eigPts=[], sctPts=[], pgaPts=[], convPts=[];
let eigL=null, rconvL=null;
function ringHover(ctx,pts){
  if (S.hover.sample==null) return;
  const p=pts.find(q=>q.o.i-1===S.hover.sample);
  if (p){ctx.beginPath();ctx.arc(p.x,p.y,6.5,0,7);ctx.strokeStyle=css('--heading');ctx.lineWidth=2;ctx.stroke();}
}

/* ---------- r selection (draggable dimension) ---------- */
function liveRmseAt(r){
  const rm=curRmse();
  if (rm) return rm.mean[clamp(r,1,rm.mean.length)-1];
  return 0;
}
/* set the LOCKED run dimensionality — called when run data loads (and by the
   #lowr smoke hook), never by dragging; the tiles render it as the immovable
   solid line.  Clears any probe left over from a previous run. */
function setR(r){
  rSel=clamp(Math.round(r),1,nModes());
  rProbe=null;
  document.getElementById('sstBtn').textContent=`sst r=${rSel}`;
  const pR=document.getElementById('pR'); if(pR) pR.textContent=rSel;
  drawEig(); drawRConv();
  if (LIVEAPI.onRSet) LIVEAPI.onRSet(rSel);   // live: fetch reconstructions at the run r
  if (S.view==='sst'||S.view==='fill') drawImgs();
  drawPins();
}

/* ---------- image rendering ---------- */
function keyFor(cvId){ return cvId==='cImgB' ? S.mmdB : (S.mode==='g2'?S.g2img:S.mmdA); }
function drawImgs(){ drawImg('cImgA'); if (S.mode==='mmd') drawImg('cImgB'); }
function drawImg(cvId){
  const cv=document.getElementById(cvId); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  /* never invent imagery — banner until real data arrives */
  if (!(LIVEAPI.liveImgReady && LIVEAPI.liveImgReady())){
    const st=(LIVEAPI.liveStatus&&LIVEAPI.liveStatus())||{};
    imgHit[cvId]=[];
    paintBanner(ctx,W,H, st.running?'segmenting…':'no image data',
      st.running?'image appears when boundaries are ready':'pick a dataset and press ▶ run');
    return;
  }
  const ar=arFor(cvId);
  const R=imgRect(W,H,ar), V=getView(cvId); clampView(V);
  lastRect[cvId]=R;
  const pnl=cv.closest('.img-panel');
  if (pnl){
    if (S.mode==='g2'){
      /* never below IMG_MIN_W: the toolbar needs a usable width regardless of
         how little vertical room the image has */
      const wmax=Math.max(IMG_MIN_W, Math.ceil((H-14)*ar)+20);
      pnl.style.maxWidth=wmax+'px';
      /* explicit basis so the pin splitter moves the real boundary (flex:1 vs flex:1 splits 50/50) */
      pnl.style.flex = imgWOverride ? `0 0 ${clamp(imgWOverride,IMG_MIN_W,wmax)}px` : `0 1 ${wmax}px`;
    } else { pnl.style.maxWidth=''; pnl.style.flex=''; }
  }
  imgHit[cvId]=[];
  /* live raw/seg views render real image + boundaries */
  if (LIVEAPI.drawLiveImg && LIVEAPI.drawLiveImg(cvId, ctx, W, H, R, V)) {
    updateCropUI(cvId);
  }
}
function trace(ctx,pts){ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();}
function subRegOf(cr){
  return `[${Math.round(cr.u0*NOM.w)} ${Math.round(cr.v0*NOM.h)}; ${Math.round(cr.u1*NOM.w)} ${Math.round(cr.v1*NOM.h)}]`;
}
function subRegDisp(cvId,cr){
  /* live: real source-pixel coords for THIS image; mock: nominal frame */
  const m = LIVEAPI.liveMeta && LIVEAPI.liveMeta(keyFor(cvId));
  if (!m) return subRegOf(cr);
  return `[${Math.round(cr.u0*m.width)} ${Math.round(cr.v0*m.height)}; `
       + `${Math.round(cr.u1*m.width)} ${Math.round(cr.v1*m.height)}]`;
}
function updateCropUI(cvId){
  const el=document.getElementById('cropui_'+cvId); if(!el) return;
  const cr=cropRect[cvId];
  el.classList.toggle('show',!!cr);
  if (cr) el.querySelector('.crop-lbl').textContent='sub_reg '+subRegDisp(cvId,cr);
}
/* leave crop mode for one image: reset the flag, the crop tool button, and the
   cursor.  Without this, a cropped image stays in crop mode after a rerun and
   its clicks are treated as crop draws instead of pinning shapes. */
function exitCropMode(cvId){
  cropMode[cvId]=false;
  const cb=document.querySelector(`[data-act="crop"][data-cv="${cvId}"]`);
  if(cb) cb.classList.remove('on');
  const cv=document.getElementById(cvId); if(cv) cv.style.cursor='default';
}

/* ---------- pinned shape cards ---------- */
function renderPins(){
  if (LIVEAPI.renderLivePins) LIVEAPI.renderLivePins();
}
function drawPins(){
  if (LIVEAPI.drawLivePins) LIVEAPI.drawLivePins();
}

/* ---------- supplemental plot draws ---------- */
function axes(ctx,W,H,m){ctx.strokeStyle=css('--border');ctx.lineWidth=1;ctx.strokeRect(m.l,m.t,W-m.l-m.r,H-m.t-m.b);}
function gridY(ctx,W,H,m,n){
  ctx.strokeStyle=css('--border');ctx.globalAlpha=0.45;ctx.lineWidth=1;
  for(let i=1;i<n;i++){const y=m.t+(H-m.t-m.b)*i/n;ctx.beginPath();ctx.moveTo(m.l,y);ctx.lineTo(W-m.r,y);ctx.stroke();}
  ctx.globalAlpha=1;
}
/* fit one or more shape polylines (arrays of [x,y]) into a panel with EQUAL
   aspect, centered.  Standardized shapes are y-up, so pixels flip y. */
function shapeMap(W,H,polys,pad){
  pad=pad==null?0.16:pad;
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const p of polys) for(const q of p){
    if(q[0]<x0)x0=q[0]; if(q[0]>x1)x1=q[0];
    if(q[1]<y0)y0=q[1]; if(q[1]>y1)y1=q[1];
  }
  const bw=(x1-x0)||1, bh=(y1-y0)||1;
  const s=Math.min(W*(1-2*pad)/bw, H*(1-2*pad)/bh);   // equal aspect
  const cx=(x0+x1)/2, cy=(y0+y1)/2;
  return q=>[W/2+(q[0]-cx)*s, H/2-(q[1]-cy)*s];
}
function strokePoly(ctx,map,poly,o){
  o=o||{};
  ctx.beginPath();
  poly.forEach((q,i)=>{const [x,y]=map(q); i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
  if(o.close!==false) ctx.closePath();
  if(o.fill){ctx.fillStyle=css(o.fill);ctx.globalAlpha=o.fillAlpha==null?1:o.fillAlpha;ctx.fill();ctx.globalAlpha=1;}
  if(o.dash) ctx.setLineDash(o.dash);
  ctx.strokeStyle=css(o.stroke||'--accent-hover');ctx.lineWidth=o.width||2;
  ctx.globalAlpha=o.alpha==null?1:o.alpha;ctx.stroke();ctx.globalAlpha=1;ctx.setLineDash([]);
}
/* fill-view colorbar (live): sequential ramp for d_Prod/d_Gr/d_SPD (0..max),
   diverging ramp for witness (±|w|max, 0 at center).  Cluster fill uses the
   legend instead.  Drawn unclipped in the image panel's bottom-right. */
function fillColorbar(ctx,R){
  if (S.view!=='fill' || S.fillBy==='clust') return;
  const smp=curSamples()||[]; if(!smp.length) return;
  const bw=Math.min(132, R.rw*0.42), bh=9;
  const bx=R.rx+R.rw-bw-12, by=R.ry+R.rh-24;
  let diverging=false, label='', loL='', midL=null, hiL='';
  if (S.fillBy==='wit'){
    diverging=true;
    const wm=(LIVEAPI.liveWitMax?LIVEAPI.liveWitMax():1)||1;
    label='witness'; loL=(-wm).toFixed(2); midL='0'; hiL='+'+wm.toFixed(2);
  } else {
    const pick=o=>S.fillBy==='dGr'?o.dGr:S.fillBy==='dSPD'?o.dSPD:o.dProd;
    const dmax=Math.max(...smp.map(pick))||1;
    label={dProd:'d_Prod',dGr:'d_Gr',dSPD:'d_SPD'}[S.fillBy]||'';
    loL='0'; hiL=dmax.toFixed(2);
  }
  const grad=ctx.createLinearGradient(bx,0,bx+bw,0);
  for(let i=0;i<=20;i++){const t=i/20; grad.addColorStop(t, diverging?dramp(t):ramp(t));}
  ctx.fillStyle=grad; ctx.fillRect(bx,by,bw,bh);
  ctx.strokeStyle=css('--border'); ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh);
  ctx.fillStyle=css('--text-sec'); ctx.font='9px '+css('--font-mono');
  ctx.textAlign='left';  ctx.fillText(loL,bx,by+bh+10);
  if(midL){ctx.textAlign='center'; ctx.fillText(midL,bx+bw/2,by+bh+10);}
  ctx.textAlign='right'; ctx.fillText(hiL,bx+bw,by+bh+10);
  ctx.textAlign='left';  ctx.fillText(label,bx,by-3);
}
function drawEig(){
  const cv=document.getElementById('c_spec'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'spec')) return;
  const m={l:44,r:14,t:12,b:26};
  gridY(ctx,W,H,m,4); axes(ctx,W,H,m);
  /* liveWait('spec') already returned false, and liveTileReady('spec') is
     !!LIVEDATA.spectrum — so sp is non-null here.  Guarded anyway: this used
     to fall through to a mock generator, and a bare assumption is what would
     turn a future gating change into an undefined-value paint. */
  const sp=curSpectrum();
  if (!sp) return;
  const n=sp.length;
  const iw=(W-m.l-m.r)/n;
  eigL={m,iw,n};
  eigPts=[];
  const vals=sp.map(s=>Math.max(s,1e-12));
  const logs=vals.map(v=>Math.log10(v));
  const lmin=Math.min(...logs), span=Math.max(Math.max(...logs)-lmin,1e-6);
  for(let i=0;i<n;i++){
    const lg = (logs[i]-lmin)/span;
    const h=Math.max(1,(H-m.t-m.b)*Math.max(0.02,lg));
    const x=m.l+i*iw;
    ctx.fillStyle=i<rSel?css('--accent'):css('--border');
    ctx.fillRect(x,H-m.b-h,Math.max(1,iw*0.6),h);
    eigPts.push({x:x+iw*0.3,y:H-m.b-h,i:i+1,v:vals[i]});
  }
  /* locked run r (solid, immovable) + optional probe r′ (dashed) */
  const xr=m.l+Math.min(rSel,n)*iw;
  drawRMarker(ctx, xr, m.t, H-m.b, `r = ${rSel} (run)`,
              {lx:Math.min(xr+5,W-m.r-86), ly:m.t+12});
  if (rProbe!=null){
    const xp=m.l+Math.min(rProbe,n)*iw;
    drawRMarker(ctx, xp, m.t, H-m.b, `r′ = ${rProbe} → pins`,
                {probe:true, lx:Math.min(xp+5,W-m.r-100), ly:m.t+24});
  }
  ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
  ctx.fillText('σₖ (log)',6,m.t+10);
  ctx.fillText('PGA mode k · drag the r line to probe pinned cards',W/2-118,H-8);
}
function drawSct(){
  const cv=document.getElementById('c_sct'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'sct')) return;
  const m={l:50,r:92,t:14,b:28};
  gridY(ctx,W,H,m,4); axes(ctx,W,H,m);
  const pw=W-m.l-m.r, ph=H-m.t-m.b;
  const SMP=curSamples();
  const gmax=Math.max(...SMP.map(o=>o.dGr))*1.05||1;
  const smax=Math.max(...SMP.map(o=>o.dSPD))*1.05||1;
  const dmax=Math.max(...SMP.map(o=>o.dProd))||1;
  sctPts=[];
  const order=[...SMP].sort((a,b)=>a.dProd-b.dProd);
  const halos=clustOn(), cc=clustColors();
  for(const o of order){
    const x=m.l+o.dGr/gmax*pw, y=H-m.b-o.dSPD/smax*ph;
    ctx.beginPath();ctx.arc(x,y,3.2,0,7);
    ctx.fillStyle=ramp(o.dProd/dmax);ctx.globalAlpha=0.9;ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle=css('--bg-sec');ctx.lineWidth=1;ctx.stroke();
    if (halos && o.clust!=null){                  /* cluster halo, same identity as image fills */
      ctx.beginPath();ctx.arc(x,y,5.4,0,7);
      ctx.strokeStyle=cc[o.clust%cc.length];ctx.lineWidth=1.6;ctx.globalAlpha=0.85;ctx.stroke();ctx.globalAlpha=1;
    }
    sctPts.push({x,y,o});
  }
  ringHover(ctx,sctPts);
  ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
  ctx.fillText('d_Gr',W-m.r-34,H-9);
  ctx.save();ctx.translate(12,H/2+18);ctx.rotate(-Math.PI/2);ctx.fillText('d_SPD',0,0);ctx.restore();
  const lx=W-m.r+22,lt=m.t+8,lh=ph-16;
  for(let i=0;i<lh;i++){ctx.fillStyle=ramp(1-i/lh);ctx.fillRect(lx,lt+i,10,1.2);}
  ctx.strokeStyle=css('--border');ctx.strokeRect(lx,lt,10,lh);
  ctx.fillStyle=css('--text-sec');
  ctx.fillText('d_Prod',lx-6,lt-6);ctx.fillText('max',lx+14,lt+8);ctx.fillText('0',lx+14,lt+lh);
}
function drawPGA(){
  const cv=document.getElementById('c_pga'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'pga')) return;
  const m={l:52,r:14,t:14,b:28};
  gridY(ctx,W,H,m,4); axes(ctx,W,H,m);
  const pw=W-m.l-m.r, ph=H-m.t-m.b;
  const SMP=curSamples();
  const ax=AXES[P.pgaX], ay=AXES[P.pgaY];
  const xm=Math.max(...SMP.map(o=>Math.abs(ax.get(o))))*1.12||1;
  const ym=Math.max(...SMP.map(o=>Math.abs(ay.get(o))))*1.12||1;
  ctx.strokeStyle=css('--border');ctx.setLineDash([2,3]);
  ctx.beginPath();ctx.moveTo(m.l+pw/2,m.t);ctx.lineTo(m.l+pw/2,H-m.b);ctx.stroke();
  ctx.beginPath();ctx.moveTo(m.l,m.t+ph/2);ctx.lineTo(W-m.r,m.t+ph/2);ctx.stroke();
  ctx.setLineDash([]);
  pgaPts=[];
  const halos=clustOn(), cc=clustColors();
  for(const o of SMP){
    const x=m.l+pw/2+ax.get(o)/xm*pw/2, y=m.t+ph/2-ay.get(o)/ym*ph/2;
    ctx.beginPath();ctx.arc(x,y,2.8,0,7);
    ctx.fillStyle=css('--accent');ctx.globalAlpha=0.55;ctx.fill();ctx.globalAlpha=1;
    if (halos && o.clust!=null){
      ctx.beginPath();ctx.arc(x,y,5,0,7);
      ctx.strokeStyle=cc[o.clust%cc.length];ctx.lineWidth=1.5;ctx.globalAlpha=0.85;ctx.stroke();ctx.globalAlpha=1;
    }
    pgaPts.push({x,y,o});
  }
  ringHover(ctx,pgaPts);
  ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
  ctx.fillText(ax.lbl,W-m.r-8-ax.lbl.length*6,H-9);
  ctx.save();ctx.translate(12,H/2+16);ctx.rotate(-Math.PI/2);ctx.fillText(ay.lbl,0,0);ctx.restore();
}
function drawMean(){
  const cv=document.getElementById('c_mean'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'mean')) return;
  if (LIVE){
    const kar=(LIVEAPI.liveKarcher&&LIVEAPI.liveKarcher())||{};
    if (P.meanView==='conv'){
      const m={l:60,r:16,t:14,b:28};
      gridY(ctx,W,H,m,5); axes(ctx,W,H,m);
      const pw=W-m.l-m.r, ph=H-m.t-m.b;
      const hist=kar.history||[];
      convPts=[];
      if (hist.length<1){
        ctx.fillStyle=css('--text-sec');ctx.font='11px '+css('--font-mono');
        ctx.textAlign='center';
        ctx.fillText('convergence trace not recorded for this run',W/2,H/2-6);
        ctx.font='10px '+css('--font-mono');ctx.globalAlpha=0.75;
        ctx.fillText('(mmd pooled mean is computed inside shapemmd)',W/2,H/2+10);
        ctx.globalAlpha=1;ctx.textAlign='left';return;
      }
      /* log10(‖V‖_F) vs iteration, real data */
      const logs=hist.map(v=>Math.log10(Math.max(v,1e-16)));
      const lmax=Math.max(...logs), lmin=Math.min(...logs);
      const span=Math.max(lmax-lmin,1e-6), pad=span*0.08;
      const yOf=l=>m.t+ph*(1-(l-(lmin-pad))/(span+2*pad));
      const xOf=i=>m.l+(hist.length<2?pw/2:pw*i/(hist.length-1));
      ctx.strokeStyle=css('--accent-hover');ctx.lineWidth=2;ctx.beginPath();
      hist.forEach((v,i)=>{const x=xOf(i),y=yOf(logs[i]);i?ctx.lineTo(x,y):ctx.moveTo(x,y);
        convPts.push({x,y,iter:i+1,val:v});});
      ctx.stroke();
      for(const p of convPts){ctx.beginPath();ctx.arc(p.x,p.y,3.4,0,7);
        ctx.fillStyle=css('--accent-hover');ctx.fill();
        ctx.strokeStyle=css('--bg-sec');ctx.lineWidth=1;ctx.stroke();}
      ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
      /* decade ticks within range */
      for(let e=Math.ceil(lmin);e<=Math.floor(lmax);e++){
        const y=yOf(e); ctx.fillText('1e'+e,6,y+3);
      }
      ctx.fillText('Karcher iteration',W/2-46,H-9);
      const last=hist[hist.length-1];
      ctx.fillText(`converged: ‖grad‖ = ${last.toExponential(1)} after ${hist.length} iters`,m.l+6,m.t+12);
    } else {
      convPts=[];
      const poly=kar.mean_shape;
      if (!poly||poly.length<2){
        ctx.fillStyle=css('--text-sec');ctx.font='11px '+css('--font-mono');
        ctx.textAlign='center';ctx.fillText('mean shape unavailable',W/2,H/2);
        ctx.textAlign='left';return;
      }
      /* faint standardized ensemble shapes behind the mean (the spread X₀
         summarizes) — shared equal-axis frame over mean + ensemble */
      const ens=(kar.ensemble||[]).filter(e=>e&&e.length>1);
      const map=shapeMap(W,H,ens.length?[poly,...ens]:[poly],0.16);
      for(const e of ens) strokePoly(ctx,map,e,{stroke:'--text-sec',width:1,alpha:0.14});
      strokePoly(ctx,map,poly,{fill:'--accent-dim',fillAlpha:0.5,
                               stroke:'--accent-hover',width:2.5});
      ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
      const N=kar.n_samples||0;
      ctx.fillText(`Karcher mean X₀ over N=${N} · standardized shape space`
                   +(kar.pruned?' · post cut-locus':''),12,H-10);
    }
  }
}
function drawRMSE(){
  const cv=document.getElementById('c_rmse'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'rmse')) return;
  const m={l:46,r:14,t:14,b:28};
  gridY(ctx,W,H,m,4); axes(ctx,W,H,m);
  const pw=W-m.l-m.r, ph=H-m.t-m.b;
  if (LIVE){
    const rh=(LIVEAPI.liveRmseHist&&LIVEAPI.liveRmseHist())||{};
    const err=rh.err||[];
    const nb=Math.max(8,Math.min(30,Math.round(Math.sqrt(err.length))));
    const emax=Math.max(rh.max||0,1e-12);
    const bins=new Array(nb).fill(0);
    for(const e of err) bins[Math.min(nb-1,Math.max(0,Math.floor(e/emax*nb)))]++;
    const cmax=Math.max(...bins,1);
    const bw=pw/nb;
    for(let i=0;i<nb;i++){
      const h=ph*bins[i]/cmax;
      ctx.fillStyle=css('--accent');
      ctx.fillRect(m.l+i*bw+1,H-m.b-h,Math.max(1,bw-2),h);
    }
    /* mean-RMSE marker line (real) */
    const xm=m.l+(rh.mean||0)/emax*pw;
    ctx.setLineDash([4,3]);ctx.strokeStyle=css('--accent-hover');ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(xm,m.t);ctx.lineTo(xm,H-m.b);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=css('--accent-hover');ctx.font='10px '+css('--font-mono');
    ctx.fillText(`mean ${(rh.mean||0).toFixed(3)}`,Math.min(xm+5,W-90),m.t+11);
    ctx.fillStyle=css('--text-sec');
    ctx.fillText('0',m.l-2,H-m.b+12);
    ctx.fillText(emax.toFixed(3),W-m.r-30,H-m.b+12);
    /* err is the FULL-dimension reconstruction RMSE (all r modes), not the
       draggable rSel — label it honestly so it isn't misread as r-dependent. */
    ctx.fillText(`full-dim RMSE (r=${nModes()}) · N=${err.length}`,W/2-72,H-9);
    ctx.save();ctx.translate(12,H/2+16);ctx.rotate(-Math.PI/2);ctx.fillText('count',0,0);ctx.restore();
  }
}
function drawRConv(){
  const cv=document.getElementById('c_rconv'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'rconv')) return;
  const m={l:56,r:16,t:14,b:28};
  gridY(ctx,W,H,m,4); axes(ctx,W,H,m);
  const pw=W-m.l-m.r, ph=H-m.t-m.b;
  /* as in drawEig: liveTileReady('rconv') is !!LIVEDATA.rmse, so rm is
     non-null past liveWait — guarded rather than assumed */
  const rm=curRmse(), n=nModes();
  rconvL={m,pw,n};
  if (!rm) return;
  const curve=rm.dims.map((d,i)=>({r:d, v:rm.mean[i]}));
  const vmax=Math.max(...curve.map(c=>c.v))||1;
  const denom=Math.max(n-1,1);
  ctx.strokeStyle=css('--accent');ctx.lineWidth=2;ctx.beginPath();
  curve.forEach((c,i)=>{ const x=m.l+(c.r-1)/denom*pw, y=m.t+ph*(1-c.v/vmax);
    i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.stroke();
  const rmseAt = liveRmseAt;
  /* locked run r (solid + curve marker) + optional probe r′ (dashed) */
  const vSel=rmseAt(rSel);
  const xr=m.l+(Math.min(rSel,n)-1)/denom*pw, yr=m.t+ph*(1-vSel/vmax);
  drawRMarker(ctx, xr, m.t, H-m.b, `r=${rSel} (run) · RMSE ${vSel.toFixed(3)}`,
              {my:yr, lx:Math.min(xr+6,W-190), ly:m.t+12});
  if (rProbe!=null){
    const vP=rmseAt(rProbe);
    const xp=m.l+(Math.min(rProbe,n)-1)/denom*pw, yp=m.t+ph*(1-vP/vmax);
    drawRMarker(ctx, xp, m.t, H-m.b,
                `r′=${rProbe} · RMSE ${vP.toFixed(3)} → pins`,
                {probe:true, my:yp, lx:Math.min(xp+6,W-200), ly:m.t+24});
  }
  ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
  ctx.fillText('r · drag the run line to probe pins',W/2-96,H-9);
  ctx.save();ctx.translate(12,H/2+16);ctx.rotate(-Math.PI/2);ctx.fillText('RMSE',0,0);ctx.restore();
}
function drawSweep(){
  const cv=document.getElementById('c_sweep'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'sweep')) return;
  if (LIVE){
    const k0=P.sweepK-1;                                  /* 0-based mode */
    const ms=LIVEAPI.liveSweep&&LIVEAPI.liveSweep(k0);
    if (!ms){
      ctx.fillStyle=css('--text-sec');ctx.font='11px '+css('--font-mono');
      ctx.textAlign='center';
      ctx.fillText(`computing mode ${P.sweepK} deformation…`,W/2,H/2);
      ctx.textAlign='left';return;
    }
    const n=ms.curves.length;
    const idx=clamp(Math.round((P.sweepT+1)/2*(n-1)),0,n-1);
    const mean=ms.mean, cur=ms.curves[idx];
    const map=shapeMap(W,H,[mean,cur],0.16);
    strokePoly(ctx,map,mean,{dash:[3,3],stroke:'--text-sec',alpha:0.55,width:1.2});
    strokePoly(ctx,map,cur,{fill:'--accent-dim',fillAlpha:0.45,
                            stroke:'--accent-hover',width:2.5});
    ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
    const tv=ms.t[idx], sg=ms.sigma;
    ctx.fillText(`geodesic sweep: X₀ deformed along mode ${P.sweepK} · t = ${tv.toFixed(3)}`
                 +(sg!=null?` · σ${'₁₂₃₄₅₆₇₈₉'[k0]||''} = ${sg.toFixed(3)}`:''),12,H-10);
    ctx.fillText('dashed = mean · shaded = deformed (observed t-range)',12,H-24);
  }
}
/* mmd grids share the fill toggle's witness/test column (S.witCol), clamped
   to what the run actually produced (paired info: gr/spd is ONE selection) */
function mmdTestIx(tests){ return clamp(S.witCol,0,(tests||['gr']).length-1); }
let DLAND_GEOM=null;   // hover geometry of the last dland paint
function drawDland(){
  const cv=document.getElementById('c_dland'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'dland')) return;
  DLAND_GEOM=null;
  const D=LIVEAPI.liveDecisions && LIVEAPI.liveDecisions();
  if (D==null){ paintBanner(ctx,W,H,'computing decision landscape…',
                            'MMD grid + per-r ambiguity'); return; }
  if (D.err){ paintBanner(ctx,W,H,'decision landscape unavailable',D.err); return; }
  const t=mmdTestIx(D.tests);
  { const ts=document.getElementById('dlTest');       // track external gr/spd picks
    if (ts && !ts.hidden && ts.value!==String(t)) ts.value=String(t); }
  const rs=D.r_vals, ns=D.nre_vals;
  const m={l:56,r:16,t:14,b:30};
  const pw=W-m.l-m.r, ph=H-m.t-m.b;
  const cw=pw/rs.length, ch=ph/ns.length;
  DLAND_GEOM={m,cw,ch,D,t};
  for(let ci=0;ci<rs.length;ci++){
    const amb=D.ambig[ci]?D.ambig[ci][t]:null;   // per-r ambiguity → column shade
    for(let ri=0;ri<ns.length;ri++){
      const x=m.l+ci*cw, y=m.t+ri*ch;
      if (amb!=null){
        ctx.fillStyle=ramp3(amb,'--ramp-lo','--ramp-mid','--ramp-hi');
        ctx.globalAlpha=0.35; ctx.fillRect(x+1,y+1,cw-2,ch-2); ctx.globalAlpha=1;
      }
      const rv=D.rslt[ci][ri][t];
      if (rv==null) continue;
      const acc = rv===1;                        /* rslt=1: fail to reject → circle */
      ctx.strokeStyle=acc?css('--accent-hover'):css('--err');ctx.lineWidth=1.6;
      const mx=x+cw/2,my=y+ch/2,s=Math.min(cw,ch)*0.18;
      if (acc){ ctx.beginPath();ctx.arc(mx,my,s,0,7);ctx.stroke(); }
      else { ctx.beginPath();ctx.moveTo(mx-s,my-s);ctx.lineTo(mx+s,my+s);
             ctx.moveTo(mx+s,my-s);ctx.lineTo(mx-s,my+s);ctx.stroke(); }
    }
  }
  axes(ctx,W,H,m);
  ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
  rs.forEach((r,i)=>{ if(rs.length<=12||i%2===0)
    ctx.fillText(String(r),m.l+i*cw+cw/2-6,H-m.b+12); });
  ns.forEach((n,i)=>ctx.fillText(String(n),8,m.t+i*ch+ch/2+3));
  ctx.fillText('r →',W-m.r-24,H-9);
  const where = D.scale!=null ? `scale ${D.scale}` : 'run grid';
  ctx.fillText(`○ accept H₀ · ✕ reject (${D.tests[t]||''}) `
               +`· shade: per-r ambiguity · ${where}`,m.l,m.t-3);
}
function bindDland(){
  const cv=document.getElementById('c_dland'); if(!cv) return;
  syncDlandCtl();
  const cellOf=e=>{
    if (!DLAND_GEOM) return null;
    const r=cv.getBoundingClientRect();
    const {m,cw,ch,D}=DLAND_GEOM;
    const ci=Math.floor((e.clientX-r.left-m.l)/cw);
    const ri=Math.floor((e.clientY-r.top-m.t)/ch);
    if (ci<0||ri<0||ci>=D.r_vals.length||ri>=D.nre_vals.length) return null;
    return {ci,ri};
  };
  cv.addEventListener('mousemove',e=>{
    const c=cellOf(e); if(!c){ hideTip(); return; }
    const {D,t}=DLAND_GEOM;
    const mmd=D.MMD[c.ci][c.ri][t], rv=D.rslt[c.ci][c.ri][t];
    const th=D.tThresh?D.tThresh[c.ci][c.ri][t]:null;
    const amb=D.ambig[c.ci]?D.ambig[c.ci][t]:null;
    showTip(`r <b>${D.r_vals[c.ci]}</b> · n_re <b>${D.nre_vals[c.ri]}</b><br>`
      +(rv==null?'cell skipped':(rv===1?'accept H₀':'<b>reject H₀</b>'))
      +(mmd!=null?`<br>MMD ${(+mmd).toFixed(4)}`:'')
      +(th!=null?` · thresh ${(+th).toFixed(4)}`:'')
      +(amb!=null?`<br>ambiguity(r) ${(+amb).toFixed(3)}`:''),
      e.clientX,e.clientY);
  });
  cv.addEventListener('mouseleave',hideTip);
}
/* head controls of the dland tile: gr/spd column (shared S.witCol) and the
   per-scale selector, revealed once a sweep exists */
function syncDlandCtl(){
  const ts=document.getElementById('dlTest'), sc=document.getElementById('dlScale');
  const D = LIVE && LIVEAPI.liveDecisions ? LIVEAPI.liveDecisions() : null;
  if (ts){
    const tests=(D&&D.tests)||[];
    ts.hidden = tests.length<2;
    if (!ts.hidden){
      ts.innerHTML=tests.map((n,i)=>
        `<option value="${i}" ${i===mmdTestIx(tests)?'selected':''}>${esc(n)}</option>`).join('');
      ts.onchange=()=>pickWitCol(+ts.value);   // ONE gr/spd selection everywhere
    }
  }
  if (sc){
    if (LIVE && LIVEAPI.liveSsweep) LIVEAPI.liveSsweep();   // lazy fetch → re-syncs
    const SW = LIVE && LIVEAPI.liveSsweepCached ? LIVEAPI.liveSsweepCached() : null;
    sc.hidden = !(SW && SW.scale_vals);
    if (!sc.hidden){
      sc.innerHTML=`<option value="">run grid</option>`+SW.scale_vals.map((v,i)=>
        `<option value="${i}" ${S.dlandScale===i?'selected':''}>scale ${v}</option>`).join('');
      sc.value = S.dlandScale==null?'':String(S.dlandScale);
      sc.onchange=()=>{ S.dlandScale=sc.value===''?null:+sc.value; drawDland(); };
    }
  }
}
function drawWhist(){
  const cv=document.getElementById('c_whist'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'whist')) return;
  const m={l:46,r:16,t:16,b:28};
  gridY(ctx,W,H,m,4); axes(ctx,W,H,m);
  const pw=W-m.l-m.r, ph=H-m.t-m.b;
  /* data source: real per-sample witness values from the store */
  const nb=24, hA=new Array(nb).fill(0), hB=new Array(nb).fill(0);
  const pinMarks=[];   // [{w, tag}]
  const smp=curSamples().filter(o=>o.wit!=null);
  const groups=[...new Set(smp.map(o=>o.label))];
  const labA=(groups[0]||'A')+'/', labB=(groups[1]||'B')+'/';
  const wmax=Math.max(1e-12,...smp.map(o=>Math.abs(o.wit)));
  for (const o of smp){
    const bin=Math.min(nb-1,Math.max(0,Math.floor((o.wit/wmax+1)/2*nb)));
    (o.label===groups[0]?hA:hB)[bin]++;
  }
  if (LIVEAPI.livePinList) LIVEAPI.livePinList().forEach(pn=>{
    const o=LIVEAPI.liveSampleById && LIVEAPI.liveSampleById(pn.sid);
    if (o && o.wit!=null) pinMarks.push({w:o.wit/wmax, tag:`#${pn.sid+1}`});
  });
  const hmax=Math.max(...hA,...hB,1)*1.1;
  const step=(h,color)=>{
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
    for(let i=0;i<nb;i++){
      const x0=m.l+i/nb*pw, x1=m.l+(i+1)/nb*pw, y=m.t+ph*(1-h[i]/hmax);
      i===0?ctx.moveTo(x0,y):ctx.lineTo(x0,y);
      ctx.lineTo(x1,y);
    }
    ctx.stroke();
  };
  step(hA,css('--div-hi')); step(hB,css('--div-lo'));
  const x0=m.l+pw/2;
  ctx.setLineDash([2,3]);ctx.strokeStyle=css('--border');
  ctx.beginPath();ctx.moveTo(x0,m.t);ctx.lineTo(x0,H-m.b);ctx.stroke();ctx.setLineDash([]);
  ctx.font='10px '+css('--font-mono');
  /* pinned shapes emphasized as labeled verticals at their witness value */
  pinMarks.forEach((pm,ix)=>{
    const xw=m.l+(pm.w+1)/2*pw;
    ctx.strokeStyle=css('--heading');ctx.lineWidth=1.4;
    ctx.beginPath();ctx.moveTo(xw,m.t+4);ctx.lineTo(xw,H-m.b);ctx.stroke();
    ctx.fillStyle=css('--heading');
    ctx.fillText(pm.tag,xw+3,m.t+12+(ix%3)*11);   /* stagger labels */
  });
  ctx.font='10px '+css('--font-mono');
  ctx.fillStyle=css('--div-hi');ctx.fillRect(W-m.r-86,m.t+6,8,8);
  ctx.fillStyle=css('--text-sec');ctx.fillText(labA,W-m.r-74,m.t+13);
  ctx.fillStyle=css('--div-lo');ctx.fillRect(W-m.r-86,m.t+20,8,8);
  ctx.fillStyle=css('--text-sec');ctx.fillText(labB,W-m.r-74,m.t+27);
  ctx.fillText(`witness value w(x) · |w|max ${wmax.toExponential(1)}`,W/2-70,H-9);
}
let SSWEEP_GEOM=null;   // hover/click geometry of the last ssweep paint
function drawSsweep(){
  const cv=document.getElementById('c_ssweep'); if(!cv) return;
  const [ctx,W,H]=fit(cv);
  if (liveWait(ctx,W,H,'ssweep')) return;
  SSWEEP_GEOM=null;
  const SW=LIVEAPI.liveSsweep && LIVEAPI.liveSsweep();
  if (SW==null){ paintBanner(ctx,W,H,'loading scale sweep…',''); return; }
  if (SW.none){ paintBanner(ctx,W,H,'no scale sweep in this run',
                            'set scales in the run form and rerun'); return; }
  const t=mmdTestIx(SW.tests);
  const m={l:52,r:74,t:14,b:30};
  const pw=W-m.l-m.r, ph=H-m.t-m.b;
  const nsc=SW.scale_vals.length, nr=SW.r_vals.length;
  const cw=pw/nsc, ch=ph/nr;
  SSWEEP_GEOM={m,cw,ch,SW,t};
  for(let si=0;si<nsc;si++) for(let ri=0;ri<nr;ri++){
    const a=SW.ambig[si][ri]?SW.ambig[si][ri][t]:null;
    ctx.fillStyle = a==null ? css('--bg-elev')
                  : ramp3(a,'--ramp-lo','--ramp-mid','--ramp-hi');
    ctx.fillRect(m.l+si*cw+0.5,m.t+ri*ch+0.5,cw-1,ch-1);
  }
  /* selected per-scale landscape column gets an outline (paired emphasis) */
  if (S.dlandScale!=null && S.dlandScale<nsc){
    ctx.strokeStyle=css('--heading');ctx.lineWidth=1.5;
    ctx.strokeRect(m.l+S.dlandScale*cw+0.5,m.t+0.5,cw-1,ph-1);
  }
  axes(ctx,W,H,m);
  ctx.fillStyle=css('--text-sec');ctx.font='10px '+css('--font-mono');
  const step=Math.max(1,Math.ceil(nsc/8));
  SW.scale_vals.forEach((s,i)=>{ if(i%step===0)
    ctx.fillText(String(s),m.l+i*cw+cw/2-6,H-m.b+12); });
  SW.r_vals.forEach((r,i)=>{ if(nr<=10||i%2===0)
    ctx.fillText(String(r),m.l-Math.min(30,m.l-8)-2,m.t+i*ch+ch/2+3); });
  ctx.fillText('smoothing scale · click a column → per-scale landscape',m.l,H-9);
  ctx.save();ctx.translate(12,H/2+8);ctx.rotate(-Math.PI/2);ctx.fillText('r',0,0);ctx.restore();
  const lx=W-m.r+22,lt=m.t+8,lh=ph-16;
  for(let i=0;i<lh;i++){
    ctx.fillStyle=ramp3(1-i/lh,'--ramp-lo','--ramp-mid','--ramp-hi');
    ctx.fillRect(lx,lt+i,10,1.2);
  }
  ctx.strokeStyle=css('--border');ctx.strokeRect(lx,lt,10,lh);
  ctx.fillStyle=css('--text-sec');
  ctx.fillText('ambig.',lx-6,lt-6);ctx.fillText('1',lx+14,lt+8);ctx.fillText('0',lx+14,lt+lh);
}

/* ---------- plot tile registry ---------- */
const PLOTS={
  sct:{title:'Grassmannian vs SPD distances',
    meta:()=>{ const s=LIVE?(LIVEAPI.liveSamples&&LIVEAPI.liveSamples()):null;
               return `N=${s?s.length:2298} · d_Prod`; },
    draw:drawSct, bind:bindSctHover},
  spec:{title:'Grassmannian PGA spectrum', meta:()=>'singular values σₖ · drag to set r', draw:drawEig, bind:bindEig},
  pga:{title:'Normal coordinates', meta:()=>'hover links to image', draw:drawPGA, bind:bindPGA,
    headExtra:`<select class="mini-sel" id="pgaX" aria-label="x axis"></select><span class="lbl">vs</span><select class="mini-sel" id="pgaY" aria-label="y axis"></select>`},
  mean:{title:'Fréchet / Karcher mean',
    meta:()=>{ const k=LIVE&&LIVEAPI.liveKarcher&&LIVEAPI.liveKarcher();
               return k?`Gr(2,n) · N=${k.n_samples}`:'Gr(2,n) · standardized'; },
    draw:drawMean, bind:bindMean,
    headExtra:`<select class="mini-sel" id="meanView" aria-label="mean view"><option value="shape">mean shape</option><option value="conv">convergence</option></select>`},
  sweep:{title:'PGA mode sweep', meta:()=>'geodesic deformation of X₀', draw:drawSweep, bind:bindSweep,
    headExtra:`<select class="mini-sel" id="swK" aria-label="mode"><option value="1">mode 1</option><option value="2">mode 2</option><option value="3">mode 3</option><option value="4">mode 4</option></select><input type="range" id="swT" min="-100" max="100" value="0" aria-label="sweep t">`},
  rconv:{title:'Reconstruction error vs r', meta:()=>'drag to choose r', draw:drawRConv, bind:bindRConv},
  rmse:{title:'Reconstruction error',
    meta:()=>{ const rh=LIVE&&LIVEAPI.liveRmseHist&&LIVEAPI.liveRmseHist();
               return rh?`N=${rh.err.length} · full-dim RMSE`:'histogram over N'; },
    draw:drawRMSE},
  dland:{title:'Decision landscape', meta:()=>'MMD over (r, n_re)', draw:drawDland, bind:bindDland, mmdOnly:true,
    headExtra:`<select class="mini-sel" id="dlTest" aria-label="test column" hidden></select><select class="mini-sel" id="dlScale" aria-label="scale" hidden></select>`},
  whist:{title:'Witness distribution', meta:()=>'per-ensemble histogram', draw:drawWhist, mmdOnly:true},
  ssweep:{title:'Scale sweep', meta:()=>'ambiguity over scales', draw:drawSsweep, bind:bindSsweep, mmdOnly:true},
};
/* A plot type from outside the code (the #plots= hash, a <select> value) as
   its canonical PLOTS key, or null. Own keys only: `PLOTS[t]` alone also
   admits inherited names, and #plots=constructor then crashed the panel
   builder on a missing meta(). */
const plotKey = t => Object.keys(PLOTS).find(k => k===t) || null;
let suppList=['spec','pga'];
let suppFolded=false;   /* 6b: plot row minimized (terminal-fold idiom) */
const suppFlex={};
function setSuppFold(folded){
  suppFolded=!!folded;
  const b=document.getElementById('suppFoldBtn');
  if (b) b.textContent = suppFolded ? '▸' : '▾';
  renderSupp();          /* display logic + redraw on restore */
}
function renderSupp(){
  const row=document.getElementById('suppRow');
  const vs=document.getElementById('vsplit');
  row.innerHTML='';
  suppList.forEach((type,i)=>{
    if (i>0){
      const h=document.createElement('div'); h.className='hsplit'; h.dataset.left=suppList[i-1]; h.dataset.right=type;
      row.appendChild(h);
    }
    const p=document.createElement('div');
    p.className='panel'; p.dataset.plot=type;
    p.style.flexGrow=suppFlex[type]||1;
    p.innerHTML=`<div class="panel-head"><h2>${PLOTS[type].title}</h2>${PLOTS[type].headExtra||''}<span class="meta">${PLOTS[type].meta()}</span><button class="close" aria-label="Remove plot" title="remove">✕</button></div>
                 <div class="panel-body"><canvas id="c_${esc(type)}"></canvas></div>`;
    p.querySelector('.close').addEventListener('click',()=>{
      suppList=suppList.filter(t=>t!==type); renderSupp();
    });
    row.appendChild(p);
  });
  const empty=suppList.length===0 || suppFolded;
  row.style.display=empty?'none':'flex';
  vs.style.display=empty?'none':'block';
  refreshAddOptions();
  suppList.forEach(t=>PLOTS[t].bind&&PLOTS[t].bind());
  bindTileResizers();
  observeBodies();
  drawAll();
}
function refreshAddOptions(){
  const sel=document.getElementById('addPlot');
  const avail=Object.keys(PLOTS).filter(t=>!suppList.includes(t)&&(!PLOTS[t].mmdOnly||S.mode==='mmd'));
  sel.innerHTML=`<option value="">+ add plot</option>`+avail.map(t=>`<option value="${t}">${PLOTS[t].title}</option>`).join('');
  sel.disabled=avail.length===0;
}
document.getElementById('addPlot').addEventListener('change',e=>{
  const t=plotKey(e.target.value);
  if (t){ suppList.push(t); setSuppFold(false); }
});
{ const b=document.getElementById('suppFoldBtn');
  if (b) b.addEventListener('click', ()=>setSuppFold(!suppFolded)); }
function bindTileResizers(){
  document.querySelectorAll('.hsplit').forEach(h=>{
    h.addEventListener('mousedown',e=>{
      e.preventDefault();
      const lp=document.querySelector(`.supp-row .panel[data-plot="${h.dataset.left}"]`);
      const rp=document.querySelector(`.supp-row .panel[data-plot="${h.dataset.right}"]`);
      const lw=lp.getBoundingClientRect().width, rw=rp.getBoundingClientRect().width;
      const x0=e.clientX, total=lw+rw;
      const move=ev=>{
        const d=clamp(ev.clientX-x0,-lw+90,rw-90);
        const lg=(lw+d)/total*2, rg=(rw-d)/total*2;
        suppFlex[h.dataset.left]=lg; suppFlex[h.dataset.right]=rg;
        lp.style.flexGrow=lg; rp.style.flexGrow=rg;
      };
      const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);};
      addEventListener('mousemove',move); addEventListener('mouseup',up);
    });
  });
}
(function(){
  const vs=document.getElementById('vsplit'), row=document.getElementById('suppRow');
  vs.addEventListener('mousedown',e=>{
    e.preventDefault();
    const h0=row.getBoundingClientRect().height, y0=e.clientY;
    const move=ev=>{ row.style.height=clamp(h0-(ev.clientY-y0),110,window.innerHeight*0.55)+'px'; };
    const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);};
    addEventListener('mousemove',move); addEventListener('mouseup',up);
  });
})();
/* sidebar width splitter: drag to resize (kills any horizontal squeeze in the
   session/dataset lists); double-click restores the stylesheet default */
(function(){
  const ss=document.getElementById('sidesplit'), side=document.querySelector('.side');
  if (!ss||!side) return;
  ss.addEventListener('mousedown',e=>{
    e.preventDefault();
    const w0=side.getBoundingClientRect().width, x0=e.clientX;
    const move=ev=>{ side.style.width=clamp(w0+(ev.clientX-x0),170,440)+'px'; };
    const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);drawAll();};
    addEventListener('mousemove',move); addEventListener('mouseup',up);
  });
  ss.addEventListener('dblclick',()=>{ side.style.width=''; drawAll(); });
})();

/* ---------- stage (image panels) ---------- */
function opt(v,sel){return `<option value="${v}" ${v===sel?'selected':''}>${v}</option>`;}
function itbHTML(cvId){
  return `<div class="itb">
    <button data-act="zo" data-cv="${cvId}" title="zoom out">−</button>
    <button data-act="zi" data-cv="${cvId}" title="zoom in">+</button>
    <button data-act="fit" data-cv="${cvId}" title="reset view">⛶</button>
    <button data-act="crop" data-cv="${cvId}" title="crop / sub-region">▣</button>
    <input type="range" class="dimr" data-cv="${cvId}" min="0" max="100"
           title="background image brightness">
  </div>
  <span class="crop-ui" id="cropui_${cvId}">
    <span class="crop-lbl"></span>
    <button data-act="rerun" data-cv="${cvId}" title="queue rerun on sub-region">rerun ▶</button>
    <button data-act="uncrop" data-cv="${cvId}" title="clear crop">✕</button>
  </span>`;
}
/* dropdown selection: prefetch the image's data first, THEN rebuild the
   stage, so the viewer populates without needing a view toggle */
function _pickImg(assign, value){
  assign(value);
  if (LIVEAPI.livePrefetch){
    LIVEAPI.livePrefetch(value).finally(()=>buildStage());
  } else buildStage();
}
/* image group source. Each group = {label, opts:[{v,t}]}.
   Without data: one empty placeholder group, never invented names. */
function imageGroups(){
  if (LIVEAPI.liveGroups){ const g=LIVEAPI.liveGroups(); if (g) return g; }
  return [{label:'—', opts:[]}];
}
function optsHTML(opts,sel){
  return opts.map(o=>`<option value="${esc(o.v)}" ${o.v===sel?'selected':''}>${esc(o.t)}</option>`).join('');
}
function shapeCountOf(value){
  if (LIVEAPI.liveShapeCount){ const n=LIVEAPI.liveShapeCount(value); if (n!=null) return n; }
  return 0;
}
function buildStage(){
  const w=document.getElementById('stageWrap');
  const groups=imageGroups();
  if (S.mode==='g2'){
    const flat=groups.flatMap(g=>g.opts.map(o=>o.v));
    if (!flat.includes(S.g2img) && flat.length) S.g2img=flat[0];
    const optg=groups.map(g=>`<optgroup label="${esc(g.label)}/">${optsHTML(g.opts,S.g2img)}</optgroup>`).join('');
    w.innerHTML=`
      <div class="panel img-panel">
        <div class="panel-head">
          <h2>image</h2>
          <select class="mini-sel" id="selG2" aria-label="Select image">${optg}</select>
          ${itbHTML('cImgA')}
          <span class="meta">${flat.length?`${flat.indexOf(S.g2img)+1}/${flat.length} · ${shapeCountOf(S.g2img)} shapes`:'no run yet'}</span>
        </div>
        <div class="panel-body"><canvas id="cImgA"></canvas></div>
      </div>
      <div class="psplit" id="psplit" style="display:none" title="drag to resize pinned cards"></div>
      <div class="pins grid" id="pinTray" style="display:none"></div>`;
    document.getElementById('selG2').addEventListener('change',e=>_pickImg(v=>S.g2img=v, e.target.value));
    bindImg('cImgA');
  } else {
    const gA=groups[0]||{label:'A',opts:[]}, gB=groups[1]||groups[0]||{label:'B',opts:[]};
    if (!gA.opts.some(o=>o.v===S.mmdA) && gA.opts.length) S.mmdA=gA.opts[0].v;
    if (!gB.opts.some(o=>o.v===S.mmdB) && gB.opts.length) S.mmdB=gB.opts[0].v;
    w.innerHTML=`
      <div class="panel img-panel">
        <div class="panel-head">
          <h2>${esc(gA.label)}/</h2>
          <select class="mini-sel" id="selA" aria-label="Select image from ${esc(gA.label)}">${optsHTML(gA.opts,S.mmdA)}</select>
          ${itbHTML('cImgA')}
          <span class="meta">${shapeCountOf(S.mmdA)} shapes</span>
        </div>
        <div class="panel-body"><canvas id="cImgA"></canvas></div>
      </div>
      <div class="panel img-panel">
        <div class="panel-head">
          <h2>${esc(gB.label)}/</h2>
          <select class="mini-sel" id="selB" aria-label="Select image from ${esc(gB.label)}">${optsHTML(gB.opts,S.mmdB)}</select>
          ${itbHTML('cImgB')}
          <span class="meta">${shapeCountOf(S.mmdB)} shapes</span>
        </div>
        <div class="panel-body"><canvas id="cImgB"></canvas></div>
      </div>
      <div class="psplit" id="psplit" style="display:none" title="drag to resize pinned cards"></div>
      <div class="pins" id="pinTray" style="display:none"></div>`;
    document.getElementById('selA').addEventListener('change',e=>_pickImg(v=>S.mmdA=v, e.target.value));
    document.getElementById('selB').addEventListener('change',e=>_pickImg(v=>S.mmdB=v, e.target.value));
    bindImg('cImgA'); bindImg('cImgB');
  }
  w.querySelectorAll('.img-panel').forEach(bindPanelResize);   // note 6a
  w.querySelectorAll('.itb button, .crop-ui button').forEach(b=>{
    b.addEventListener('click',()=>toolAct(b.dataset.act,b.dataset.cv,b));
  });
  w.querySelectorAll('.dimr').forEach(sl=>{
    sl.addEventListener('input',()=>{
      if (DIM[S.view]!=null){ DIM[S.view]=+sl.value/100; syncDimSliders(); drawImgs(); }
    });
  });
  syncDimSliders();
  /* pin splitter: moves the image/cards boundary.
     g2: drags the image panel width (cards reflow into the freed space);
     mmd: drags the tray width (card size follows). Double-click resets. */
  const ps=document.getElementById('psplit');
  ps.addEventListener('mousedown',e=>{
    e.preventDefault();
    const x0=e.clientX;
    if (S.mode==='g2'){
      const pnl=document.querySelector('.img-panel');
      const w0=pnl.getBoundingClientRect().width;
      const bodyH=pnl.querySelector('.panel-body').getBoundingClientRect().height;
      const wmax=Math.ceil((bodyH-14)*AR)+20;
      const move=ev=>{ imgWOverride=clamp(w0+(ev.clientX-x0),IMG_MIN_W,wmax); drawImg('cImgA'); };
      const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);};
      addEventListener('mousemove',move); addEventListener('mouseup',up);
    } else {
      const w0=pinW;
      const move=ev=>{ pinW=clamp(w0-(ev.clientX-x0),140,640); applyPinSizes(); };
      const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);};
      addEventListener('mousemove',move); addEventListener('mouseup',up);
    }
  });
  ps.addEventListener('dblclick',()=>{ imgWOverride=null; pinW=300; applyPinSizes(); drawImgs(); });
  renderPins();
  observeBodies();
  drawAll();
  requestAnimationFrame(()=>drawAll());   // repaint after layout settles
}
function applyPinSizes(){
  const tray=document.getElementById('pinTray'); if(!tray) return;
  if (tray.classList.contains('grid')){ tray.style.width=''; tray.style.setProperty('--pinw',pinW+'px'); }
  else { tray.style.width=pinW+'px'; }
  /* canvas height tracks its own rendered width via CSS aspect-ratio (4:3), so
     grid cards that grow to fill leftover space keep square-ish equal-axis plots */
  drawPins();
}
function toolAct(act,cvId,btn){
  const V=getView(cvId);
  if (act==='zi'){ V.z=clamp(V.z*1.4,1,12); }
  else if (act==='zo'){ V.z=clamp(V.z/1.4,1,12); }
  else if (act==='fit'){ V.z=1; V.cx=0.5; V.cy=0.5; }
  else if (act==='crop'){
    cropMode[cvId]=!cropMode[cvId];
    btn.classList.toggle('on',cropMode[cvId]);
    document.getElementById(cvId).style.cursor=cropMode[cvId]?'crosshair':'default';
    return;
  }
  else if (act==='uncrop'){ cropRect[cvId]=null; }
  else if (act==='rerun'){
    const cr=cropRect[cvId]; if(!cr) return;
    exitCropMode(cvId);      // fix: crop mode persisted → cropped image couldn't pin after rerun
    if (LIVE){ if (LIVEAPI.liveRerunCrop) LIVEAPI.liveRerunCrop(cvId); return; }
    const wf=S.mode==='g2'?'g2image':'mmdg2image';
    termEcho(`run ${wf} sub_reg=${subRegOf(cr)}`,
             `      queued re-segmentation on cropped sub-region · preview opens on completion`);
    logLine(`<span class="okm">✓</span>sub_reg ${subRegOf(cr)} queued for rerun (${esc(keyFor(cvId))})`);
    cropRect[cvId]=null; updateCropUI(cvId);
    return;
  }
  drawImg(cvId);
}

/* ---------- interactions ---------- */
const tip=document.getElementById('tip');
function showTip(html,x,y){tip.innerHTML=html;tip.style.display='block';tip.style.left=(x+14)+'px';tip.style.top=(y-10)+'px';}
function hideTip(){tip.style.display='none';}
function nearestPt(pts,mx,my,rad){
  let best=null,bd=rad*rad;
  for(const p of pts){const dd=(p.x-mx)**2+(p.y-my)**2;if(dd<bd){bd=dd;best=p;}}
  return best;
}
function setSampleHover(sample){
  if (S.hover.sample!==sample){
    S.hover={canvas:sample!=null?'cImgA':null,sample};
    drawImg('cImgA'); if (S.mode==='mmd') drawImg('cImgB'); drawSct(); drawPGA();
  }
}
/* paired-action rule: any plot that highlights a shape on hover pins it on click.
   In live mode `sample` IS the global sample index (gid); resolve its owning
   image so the pinned card renders the real boundary + reconstruction, and
   prefetch that image if the scatter/coords click targeted a shape whose image
   isn't currently on screen. */
function pinFromSample(sample){
  if (!LIVEAPI.livePinToggle) return;
  const key = LIVEAPI.liveKeyForSid ? LIVEAPI.liveKeyForSid(sample) : null;
  if (key==null){ console.warn('pinFromSample: no image owns sample', sample, '(pruned run?)'); return; }
  LIVEAPI.livePinToggle(key, sample);
  LIVEAPI.livePrefetch(key).then(()=>{ if (LIVEAPI.drawLivePins) LIVEAPI.drawLivePins(); });
}
const witTip = o => (o.wit!=null) ? `<br>witness w = ${o.wit.toFixed(3)}` : '';
const clustTip = o => (o.clust!=null) ? ` · ${clustLabel(o)}` : '';
/* one r-line in a spectrum/RMSE tile: vertical (solid accent for
   the locked run r, dashed hover for the probe r′), optional curve-marker
   dot at opts.my, and a label at (opts.lx, opts.ly) */
function drawRMarker(ctx, x, y0, y1, label, opts){
  opts = opts || {};
  const col = css(opts.probe ? '--accent-hover' : '--accent');
  if (opts.probe) ctx.setLineDash([4,3]);
  ctx.strokeStyle = col; ctx.lineWidth = opts.probe ? 1.5 : 2;
  ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
  ctx.setLineDash([]);
  if (opts.my != null){
    ctx.beginPath(); ctx.arc(x, opts.my, 4.5, 0, 7);
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = css('--bg-sec'); ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.fillStyle = col; ctx.font = '10px ' + css('--font-mono');
  ctx.fillText(label, opts.lx, opts.ly);
}
/* shared sample tooltip: identity · cluster, optional per-view
   middle lines, distance triple, witness, pin hint — every sample-hover
   surface (image, scatter, normal coords) formats through here */
function sampleTip(o, opts){
  opts = opts || {};
  return `shape <b>#${opts.id != null ? opts.id : o.i}</b>${opts.head || ''}${clustTip(o)}`
    + (opts.mid || '')
    + `<br>d_Gr ${(o.dGr||0).toFixed(3)} · d_SPD ${(o.dSPD||0).toFixed(3)}`
    + `<br>d_Prod <b>${(o.dProd||0).toFixed(3)}</b>${witTip(o)}`
    + (opts.hint != null ? opts.hint : '<br><i>↔ in image · click to pin</i>');
}
/* image-panel window adjustments: drag the right/bottom
   edges (or the corner) like the shape cards — the right edge resizes the
   panel width (g2: against the pin tray via imgWOverride; mmd: the A/B
   split), the bottom edge moves the image-row / plot-row boundary (same
   clamp as the vsplit).  Double-click an edge resets it.  Wheel-zoom and
   drag-pan inside the figure already exist (bindImg). */
const IMG_EDGE=10;
function bindPanelResize(pnl){
  const zoneOf=e=>{
    const r=pnl.getBoundingClientRect();
    return {right:r.right-e.clientX<IMG_EDGE, bottom:r.bottom-e.clientY<IMG_EDGE};
  };
  const panels=()=>Array.from(document.querySelectorAll('.img-row .img-panel'));
  const canRight=()=> S.mode==='g2' || panels()[0]===pnl;  // mmd: A/B split only
  const suppVisible=()=>{ const sr=document.getElementById('suppRow');
    return sr && sr.style.display!=='none'; };
  pnl.addEventListener('mousemove',e=>{
    if (e.buttons || e.target.closest('button,select,input')) return;
    const z=zoneOf(e);
    const zr=z.right&&canRight(), zb=z.bottom&&suppVisible();
    pnl.style.cursor = zr&&zb ? 'nwse-resize' : zr ? 'ew-resize'
                     : zb ? 'ns-resize' : '';
  });
  pnl.addEventListener('mousedown',e=>{
    if (e.button!==0 || e.target.closest('button,select,input')) return;
    const z=zoneOf(e);
    const zr=z.right&&canRight(), zb=z.bottom&&suppVisible();
    if (!zr && !zb) return;
    e.preventDefault(); e.stopPropagation();   // edge drag beats canvas pan/crop
    const x0=e.clientX, y0=e.clientY;
    const w0=pnl.getBoundingClientRect().width;
    const supp=document.getElementById('suppRow');
    const s0=supp?supp.getBoundingClientRect().height:0;
    const sib=panels().filter(p=>p!==pnl)[0];
    const sw0=sib?sib.getBoundingClientRect().width:0;
    const move=ev=>{
      if (zr){
        if (S.mode==='g2'){
          const bodyH=pnl.querySelector('.panel-body').getBoundingClientRect().height;
          const wmax=Math.ceil((bodyH-14)*arFor('cImgA'))+20;
          imgWOverride=clamp(w0+(ev.clientX-x0),IMG_MIN_W,wmax);
          drawImg('cImgA');
        } else if (sib){
          const d=ev.clientX-x0, total=w0+sw0;
          pnl.style.flexGrow=clamp((w0+d)/total*2,0.25,1.75);
          sib.style.flexGrow=clamp((sw0-d)/total*2,0.25,1.75);
          drawImgs();
        }
      }
      if (zb && supp)
        supp.style.height=clamp(s0-(ev.clientY-y0),110,window.innerHeight*0.55)+'px';
    };
    const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);};
    addEventListener('mousemove',move); addEventListener('mouseup',up);
  }, true);
  pnl.addEventListener('dblclick',e=>{
    if (e.target.closest('button,select,input')) return;
    const z=zoneOf(e);
    const zr=z.right&&canRight(), zb=z.bottom&&suppVisible();
    if (zr){
      if (S.mode==='g2') imgWOverride=null;
      else panels().forEach(p=>p.style.flexGrow='');
    }
    if (zb){ const sr=document.getElementById('suppRow');
             if (sr) sr.style.height='236px'; }
    if (zr||zb) drawAll();
  });
}
function bindImg(cvId){
  const cv=document.getElementById(cvId);
  let drag=null, downAt=null, moved=0;
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    const R=lastRect[cvId], V=getView(cvId);
    const r=cv.getBoundingClientRect();
    const [u,v]=s2u(e.clientX-r.left,e.clientY-r.top,R,V);
    const z2=clamp(V.z*(e.deltaY<0?1.18:1/1.18),1,12);
    V.cx=u-((e.clientX-r.left-R.rx)/R.rw-0.5)/z2;
    V.cy=v-((e.clientY-r.top-R.ry)/R.rh-0.5)/z2;
    V.z=z2; drawImg(cvId);
  },{passive:false});
  cv.addEventListener('mousedown',e=>{
    const R=lastRect[cvId], V=getView(cvId);
    const r=cv.getBoundingClientRect();
    const [u,v]=s2u(e.clientX-r.left,e.clientY-r.top,R,V);
    downAt=[e.clientX,e.clientY]; moved=0;
    if (cropMode[cvId]){
      drag={type:'crop',u0:clamp(u,0,1),v0:clamp(v,0,1)};
      cropRect[cvId]={u0:drag.u0,v0:drag.v0,u1:drag.u0,v1:drag.v0};
    } else {
      drag={type:'pan',x:e.clientX,y:e.clientY,cx:V.cx,cy:V.cy};
    }
  });
  addEventListener('mouseup',()=>{
    if (drag&&drag.type==='crop'){
      const cr=cropRect[cvId];
      if (cr && (Math.abs(cr.u1-cr.u0)<0.02||Math.abs(cr.v1-cr.v0)<0.02)) cropRect[cvId]=null;
      drawImg(cvId);
    }
    drag=null;
  });
  cv.addEventListener('click',e=>{
    if (cropMode[cvId]||moved>5) return;
    const r=cv.getBoundingClientRect();
    const mx=e.clientX-r.left,my=e.clientY-r.top;
    for(const h of imgHit[cvId]||[]){
      if (inPoly(h.pts,mx,my)){
        if (h.sample!=null && LIVEAPI.livePinToggle) LIVEAPI.livePinToggle(keyFor(cvId), h.sample);
        break;
      }
    }
  });
  cv.addEventListener('mousemove',e=>{
    const R=lastRect[cvId], V=getView(cvId);
    const r=cv.getBoundingClientRect();
    if (downAt) moved=Math.max(moved,Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1]));
    if (drag&&drag.type==='pan'){
      V.cx=drag.cx-(e.clientX-drag.x)/R.rw/V.z;
      V.cy=drag.cy-(e.clientY-drag.y)/R.rh/V.z;
      drawImg(cvId); return;
    }
    if (drag&&drag.type==='crop'){
      const [u,v]=s2u(e.clientX-r.left,e.clientY-r.top,R,V);
      const cr=cropRect[cvId];
      cr.u0=Math.min(drag.u0,clamp(u,0,1)); cr.u1=Math.max(drag.u0,clamp(u,0,1));
      cr.v0=Math.min(drag.v0,clamp(v,0,1)); cr.v1=Math.max(drag.v0,clamp(v,0,1));
      drawImg(cvId); return;
    }
    const mx=e.clientX-r.left,my=e.clientY-r.top;
    let hit=null;
    for(const h of imgHit[cvId]||[]) if (inPoly(h.pts,mx,my)){hit=h;break;}
    const key=keyFor(cvId);
    // resolve sample identity from the boundary's global id
    let sample=null, o=null;
    if (hit && hit.sample!=null){ sample=hit.sample; o=hit.o; }
    if (S.hover.sample!==sample || S.hover.canvas!==cvId){
      S.hover={canvas:cvId, sample};
      drawImg(cvId); drawSct(); drawPGA();
    }
    if (hit && o){
      showTip(sampleTip(o, {id: sample+1, head: ` · ${esc(key)}`,
                            hint: '<br><i>click to pin</i>'}),
              e.clientX, e.clientY);
    } else hideTip();
  });
  cv.addEventListener('mouseleave',()=>{
    hideTip();
    if (S.hover.canvas===cvId){
      S.hover={canvas:null,sample:null};
      drawImg(cvId); drawSct(); drawPGA();
    }
  });
}
function bindSctHover(){
  const cv=document.getElementById('c_sct'); if(!cv) return;
  cv.addEventListener('mousemove',e=>{
    const r=cv.getBoundingClientRect();
    const p=nearestPt(sctPts,e.clientX-r.left,e.clientY-r.top,14);
    if (p){
      setSampleHover(p.o.i-1);
      showTip(sampleTip(p.o), e.clientX, e.clientY);
    } else hideTip();
  });
  cv.addEventListener('click',e=>{
    const r=cv.getBoundingClientRect();
    const p=nearestPt(sctPts,e.clientX-r.left,e.clientY-r.top,14);
    if (p) pinFromSample(p.o.i-1);
  });
  cv.addEventListener('mouseleave',()=>{hideTip();setSampleHover(null);});
}
function bindEig(){
  const cv=document.getElementById('c_spec'); if(!cv) return;
  let dragging=false;
  const rFromX=x=>{
    const rect=cv.getBoundingClientRect();
    return (x-rect.left-eigL.m.l)/eigL.iw;
  };
  const lineXs=()=>{ const n=eigL.n||NMODES; return {
    lock: eigL.m.l+Math.min(rSel,n)*eigL.iw,
    probe: rProbe!=null ? eigL.m.l+Math.min(rProbe,n)*eigL.iw : null }; };
  const grab=mx=>{ const {lock,probe}=lineXs();
    return (probe!=null && Math.abs(mx-probe)<8) || Math.abs(mx-lock)<8; };
  cv.addEventListener('mousedown',e=>{
    const mx=e.clientX-cv.getBoundingClientRect().left;
    if (grab(mx)){ dragging=true; setProbe(rFromX(e.clientX)); }
  });
  addEventListener('mouseup',()=>{ if(dragging){dragging=false; setProbe(rProbe!=null?rProbe:rSel, true);} });
  cv.addEventListener('mousemove',e=>{
    const rect=cv.getBoundingClientRect(), mx=e.clientX-rect.left;
    if (dragging){ setProbe(rFromX(e.clientX)); hideTip(); return; }
    cv.style.cursor = grab(mx) ? 'col-resize' : 'default';
    const {lock,probe}=lineXs();
    if (probe!=null && Math.abs(mx-probe)<8){
      showTip(`probe <b>r′ = ${rProbe}</b> · pinned cards render at r′<br><i>drop on the run line to clear</i>`,e.clientX,e.clientY); return;
    }
    if (Math.abs(mx-lock)<8){
      showTip(`run dimensionality <b>r = ${rSel}</b> (locked)<br><i>drag off a probe line to explore pinned cards</i>`,e.clientX,e.clientY); return;
    }
    const p=nearestPt(eigPts,mx,e.clientY-rect.top,12);
    if (p) showTip(`mode <b>${p.i}</b> · σ ${p.v.toFixed(4)}`,e.clientX,e.clientY); else hideTip();
  });
  cv.addEventListener('mouseleave',hideTip);
}
function bindRConv(){
  const cv=document.getElementById('c_rconv'); if(!cv) return;
  let dragging=false;
  const rFromX=x=>{
    const rect=cv.getBoundingClientRect();
    const n=rconvL.n||NMODES;
    return 1+(x-rect.left-rconvL.m.l)/rconvL.pw*(n-1);
  };
  const lineX=r=>{ const n=rconvL.n||NMODES, denom=Math.max(n-1,1);
    return rconvL.m.l+(Math.min(r,n)-1)/denom*rconvL.pw; };
  const grab=mx=> (rProbe!=null && Math.abs(mx-lineX(rProbe))<8)
                  || Math.abs(mx-lineX(rSel))<8;
  cv.addEventListener('mousedown',e=>{
    const mx=e.clientX-cv.getBoundingClientRect().left;
    if (grab(mx)){ dragging=true; setProbe(rFromX(e.clientX)); }
  });
  addEventListener('mouseup',()=>{ if(dragging){dragging=false; setProbe(rProbe!=null?rProbe:rSel, true);} });
  cv.addEventListener('mousemove',e=>{
    const mx=e.clientX-cv.getBoundingClientRect().left;
    if (dragging){ setProbe(rFromX(e.clientX)); hideTip(); return; }
    cv.style.cursor = grab(mx) ? 'col-resize' : 'default';
    if (rProbe!=null && Math.abs(mx-lineX(rProbe))<8){
      showTip(`probe <b>r′ = ${rProbe}</b> · RMSE ${liveRmseAt(rProbe).toFixed(3)}<br><i>drop on the run line to clear</i>`,e.clientX,e.clientY); return;
    }
    if (Math.abs(mx-lineX(rSel))<8){
      showTip(`run dimensionality <b>r = ${rSel}</b> (locked) · RMSE ${liveRmseAt(rSel).toFixed(3)}<br><i>drag off a probe line to explore pinned cards</i>`,e.clientX,e.clientY); return;
    }
    const rr=clamp(Math.round(rFromX(e.clientX)),1,rconvL.n||NMODES);
    showTip(`r <b>${rr}</b> · RMSE ${liveRmseAt(rr).toFixed(3)}`,e.clientX,e.clientY);
  });
  cv.addEventListener('mouseleave',hideTip);
}
function bindPGA(){
  const sx=document.getElementById('pgaX'), sy=document.getElementById('pgaY');
  const opts=Object.keys(AXES).map(k=>`<option value="${k}">${AXES[k].lbl}</option>`).join('');
  sx.innerHTML=opts; sy.innerHTML=opts;
  sx.value=P.pgaX; sy.value=P.pgaY;
  sx.addEventListener('change',()=>{P.pgaX=sx.value;drawPGA();});
  sy.addEventListener('change',()=>{P.pgaY=sy.value;drawPGA();});
  const cv=document.getElementById('c_pga'); if(!cv) return;
  cv.addEventListener('mousemove',e=>{
    const r=cv.getBoundingClientRect();
    const p=nearestPt(pgaPts,e.clientX-r.left,e.clientY-r.top,14);
    if (p){
      setSampleHover(p.o.i-1);
      const ax=AXES[P.pgaX], ay=AXES[P.pgaY];
      showTip(sampleTip(p.o, {mid: `<br>${ax.lbl} ${ax.get(p.o).toFixed(3)} · `
                                   + `${ay.lbl} ${ay.get(p.o).toFixed(3)}`}),
              e.clientX, e.clientY);
    } else hideTip();
  });
  cv.addEventListener('click',e=>{
    const r=cv.getBoundingClientRect();
    const p=nearestPt(pgaPts,e.clientX-r.left,e.clientY-r.top,14);
    if (p) pinFromSample(p.o.i-1);
  });
  cv.addEventListener('mouseleave',()=>{hideTip();setSampleHover(null);});
}
function bindMean(){
  const sel=document.getElementById('meanView');
  sel.value=P.meanView;
  sel.addEventListener('change',()=>{P.meanView=sel.value;drawMean();});
  const cv=document.getElementById('c_mean'); if(!cv) return;
  cv.addEventListener('mousemove',e=>{
    if (P.meanView!=='conv'){hideTip();return;}
    const r=cv.getBoundingClientRect();
    const p=nearestPt(convPts,e.clientX-r.left,e.clientY-r.top,14);
    if (p) showTip(`iteration <b>${p.iter}</b><br>‖grad‖ ${p.val.toExponential(2)}`,e.clientX,e.clientY);
    else hideTip();
  });
  cv.addEventListener('mouseleave',hideTip);
}
function bindSweep(){
  const sk=document.getElementById('swK'), st=document.getElementById('swT');
  if (LIVE && LIVEAPI.liveNModes){                 /* offer only real modes */
    const nm=LIVEAPI.liveNModes();
    if (nm){
      const cap=Math.min(nm,8);
      if (P.sweepK>cap) P.sweepK=1;
      sk.innerHTML='';
      for(let i=1;i<=cap;i++){const o=document.createElement('option');
        o.value=String(i);o.textContent='mode '+i;sk.appendChild(o);}
    }
  }
  sk.value=String(P.sweepK); st.value=String(Math.round(P.sweepT*100));
  sk.addEventListener('change',()=>{P.sweepK=+sk.value;drawSweep();});
  st.addEventListener('input',()=>{P.sweepT=+st.value/100;drawSweep();});
}
function bindSsweep(){
  const cv=document.getElementById('c_ssweep'); if(!cv) return;
  const colOf=e=>{
    if (!SSWEEP_GEOM) return null;
    const r=cv.getBoundingClientRect();
    const {m,cw,SW}=SSWEEP_GEOM;
    const si=Math.floor((e.clientX-r.left-m.l)/cw);
    return (si>=0 && si<SW.scale_vals.length) ? si : null;
  };
  cv.addEventListener('mousemove',e=>{
    const si=colOf(e); if(si==null){ hideTip(); return; }
    const {m,ch,SW,t}=SSWEEP_GEOM;
    const r=cv.getBoundingClientRect();
    const ri=Math.floor((e.clientY-r.top-m.t)/ch);
    const a=(ri>=0&&ri<SW.r_vals.length&&SW.ambig[si][ri])?SW.ambig[si][ri][t]:null;
    const g=SW.ambig_global[si]?SW.ambig_global[si][t]:null;
    showTip(`scale <b>${SW.scale_vals[si]}</b>`
      +(ri>=0&&ri<SW.r_vals.length?` · r <b>${SW.r_vals[ri]}</b>`:'')
      +(a!=null?`<br>ambiguity(r) ${(+a).toFixed(3)}`:'')
      +(g!=null?`<br>global ambiguity ${(+g).toFixed(3)}`:'')
      +`<br>rejections ${SW.rejects[si][t]}/${SW.totals[si][t]}`
      +`<br><i>click → per-scale landscape</i>`,
      e.clientX,e.clientY);
  });
  cv.addEventListener('mouseleave',hideTip);
  cv.addEventListener('click',e=>{
    const si=colOf(e); if(si==null) return;
    S.dlandScale=si;
    if (!suppList.includes('dland')){ suppList.push('dland'); renderSupp(); }
    else { syncDlandCtl(); drawDland(); drawSsweep(); }
    logLine(`<span class="okm">✓</span>decision landscape → scale `
      +`${SSWEEP_GEOM.SW.scale_vals[si]}`);
  });
}

/* ---------- view / fill / mode controls ---------- */
document.getElementById('viewCtl').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b||b.disabled) return;
  document.querySelectorAll('#viewCtl button').forEach(x=>x.classList.toggle('on',x===b));
  S.view=b.dataset.view;
  document.getElementById('fillBy').hidden=S.view!=='fill';
  syncFillCtls();
  syncDimSliders();
  drawAll();
});
document.getElementById('fillBy').addEventListener('change',e=>{
  S.fillBy=e.target.value;
  if (LIVE && S.fillBy==='clust' && LIVEAPI.liveNeedClusters) LIVEAPI.liveNeedClusters();
  syncFillCtls();
  drawAll();
});
/* ---------- cluster count + legend (cluster fill view only) ---------- */
function activeClustCount(){
  const smp = (typeof curSamples==='function' ? curSamples() : null) || [];
  let m=-1; for (const o of smp){ if (o && o.clust!=null && o.clust>m) m=o.clust; }
  return m>=0 ? m+1 : S.clustK;   // reflect clusters actually present (store may return < k)
}
function renderClustLegend(){
  const leg=document.getElementById('clustLegend'); if(!leg) return;
  const cc=clustColors(), n=Math.min(activeClustCount(), clustMax());
  let h='';
  for (let i=0;i<n;i++)
    h+=`<span class="clust-chip"><span class="clust-sw" style="background:${cc[i%cc.length]}"></span>${i+1}</span>`;
  leg.innerHTML=h;
  const kv=document.getElementById('kVal'); if(kv) kv.textContent=S.clustK;
  const kd=document.getElementById('kDown'), ku=document.getElementById('kUp');
  if(kd) kd.disabled=S.clustK<=2;
  if(ku) ku.disabled=S.clustK>=clustMax();
  const cb=document.getElementById('clustBasis'); if(cb) cb.value=S.clustBasis;
}
LIVEAPI.renderClustLegend=renderClustLegend;
function syncClustCtl(){
  const el=document.getElementById('clustCtl'); if(!el) return;
  const on = S.view==='fill' && S.fillBy==='clust';
  el.hidden=!on;
  if (on) renderClustLegend();
}
function setClustK(dk){
  const k=clamp(S.clustK+dk, 2, clustMax());
  if (k===S.clustK) return;
  S.clustK=k;
  if (LIVE){ if (LIVEAPI.liveReclustK) LIVEAPI.liveReclustK(); }
  else { const smp=curSamples()||[]; smp.forEach(o=>{ o.clust=((o.i*1103515245+12345)>>>0)%k; }); }
  renderClustLegend(); drawAll();
}
{ const ku=document.getElementById('kUp'), kd=document.getElementById('kDown');
  if(ku) ku.addEventListener('click',()=>setClustK(+1));
  if(kd) kd.addEventListener('click',()=>setClustK(-1)); }
function pickClustBasis(v){
  if (v===S.clustBasis) return;
  S.clustBasis=v;
  if (LIVE){ if (LIVEAPI.liveReclustK) LIVEAPI.liveReclustK(); }   // invalidate + refetch
  else { const smp=curSamples()||[]; smp.forEach(o=>{ o.clust=((o.i*2246822519+(v.charCodeAt(0)||0))>>>0)%S.clustK; }); }
  renderClustLegend(); drawAll();
}
{ const cb=document.getElementById('clustBasis');
  if(cb) cb.addEventListener('change',e=>pickClustBasis(e.target.value)); }
/* ---------- clustering method + quick docs ----------
   Methods come from the server registry, so adding one to
   evie/engine/clustering.py surfaces it here -- with its caveat -- without
   touching this file.  The "?" is not decoration: every method offered is
   Euclidean, while the bases are geodesic distances or tangent coordinates,
   and offering a menu without saying so would let someone pick a
   sophisticated-looking algorithm that quietly ignores the geometry. */
let CLUST_METHODS=[];
function clustMethodInfo(){
  return CLUST_METHODS.find(m=>m.key===S.clustMethod)||null;
}
function renderClustMethods(){
  const sel=document.getElementById('clustMethod'); if(!sel) return;
  if (!CLUST_METHODS.length){ sel.hidden=true; return; }
  sel.hidden=false;
  sel.innerHTML=CLUST_METHODS.map(m=>
    `<option value="${esc(m.key)}"${m.key===S.clustMethod?' selected':''}>`
    +`${esc(m.label)}</option>`).join('');
}
function pickClustMethod(v){
  if (v===S.clustMethod) return;
  S.clustMethod=v;
  if (LIVE){ if (LIVEAPI.liveReclustK) LIVEAPI.liveReclustK(); }
  else { const smp=curSamples()||[]; smp.forEach(o=>{
    o.clust=((o.i*2654435761+(v.charCodeAt(0)||0))>>>0)%S.clustK; }); }
  renderClustLegend(); drawAll();
}
function showClustDocs(){
  const m=clustMethodInfo();
  if (!m){ evieModal(`<h2>Clustering</h2><p>No method information available `
    +`yet — run a workflow first.</p>`
    +`<div class="modal-actions"><button id="cdOk">close</button></div>`);
    document.getElementById('cdOk').addEventListener('click',evieModalHide);
    return; }
  evieModal(`<h2>${esc(m.label)}</h2>`
    +`<p><b>What it does.</b> ${m.theory}</p>`
    +`<p><b>Use it when.</b> ${m.use_when}</p>`
    +`<p class="warn-line"><b>Assumes.</b> ${m.caveat}</p>`
    +(m.ordered?`<p class="side-note">Clusters are numbered <b>inner to outer</b>, `
      +`not by size.</p>`:'')
    +`<p class="side-note"><b>Scope.</b> A tangent space is Euclidean — normal `
    +`coordinates have flattened the manifold, so these methods are not `
    +`violating anything. The log map is a <i>radial isometry</i>, so distance `
    +`from the mean is exact. Note d_Gr and ‖T‖ are radii <i>in the rank-r `
    +`model</i> — by design: choosing r is the claim that the retained modes `
    +`carry the structure, so the radius follows that choice rather than the `
    +`full ambient tangent. What flattening distorts is `
    +`non-radial separation, and only away from the mean. So treat findings as `
    +`<b>local</b> statements relative to the mean (inside the convexity radius `
    +`π/4), not global claims about the manifold.</p>`
    +`<div class="modal-actions"><button id="cdOk">close</button></div>`, 'wide');
  document.getElementById('cdOk').addEventListener('click', evieModalHide);
}
{ const cm=document.getElementById('clustMethod');
  if(cm) cm.addEventListener('change',e=>pickClustMethod(e.target.value));
  const cd=document.getElementById('clustDocs');
  if(cd) cd.addEventListener('click', showClustDocs); }
/* ---------- witness column switch (gr / spd, test='both' only) ---------- */
function syncWitCtl(){
  const el=document.getElementById('witCtl'); if(!el) return;
  const names=(LIVEAPI.liveWitNames && LIVEAPI.liveWitNames()) || null;
  const on = S.mode==='mmd' && S.view==='fill' && S.fillBy==='wit' && names && names.length===2;
  el.hidden=!on;
  if (on){
    const g=document.getElementById('witGr'), s=document.getElementById('witSpd');
    if(g) g.classList.toggle('on', S.witCol===0);
    if(s) s.classList.toggle('on', S.witCol===1);
  }
}
LIVEAPI.syncWitCtl=syncWitCtl;
function pickWitCol(col){
  if (col===S.witCol) return;
  S.witCol=col;
  if (LIVEAPI.liveSetWitCol) LIVEAPI.liveSetWitCol();   // re-point o.wit + witMax
  syncWitCtl(); drawAll();                            // fills + witness tile + pins track it
}
{ const g=document.getElementById('witGr'), s=document.getElementById('witSpd');
  if(g) g.addEventListener('click',()=>pickWitCol(0));
  if(s) s.addEventListener('click',()=>pickWitCol(1)); }
/* ---------- colormap dropdown (fill views; kind follows the fill quantity) ---------- */
function cmapKind(){ return S.fillBy==='wit' ? 'div' : S.fillBy==='clust' ? 'cat' : 'seq'; }
function syncCmapCtl(){
  const el=document.getElementById('cmapSel'); if(!el) return;
  el.hidden = S.view!=='fill';
  if (el.hidden) return;
  const kind=cmapKind();
  el.innerHTML=Object.entries(CMAPS[kind]).map(([k,m])=>
    `<option value="${k}" ${k===S.cmap[kind]?'selected':''}>map: ${m.label}</option>`).join('');
  el.dataset.kind=kind;
}
function pickCmap(kind, name){
  if (!CMAPS[kind] || !CMAPS[kind][name] || S.cmap[kind]===name) return;
  S.cmap[kind]=name;
  if (kind==='cat' && S.clustK>clustMax()){
    /* the new map has fewer identities than the current k — re-cluster at
       its ceiling so colors keep meaning identity (never cycled) */
    S.clustK=clustMax();
    if (LIVE){ if (LIVEAPI.liveReclustK) LIVEAPI.liveReclustK(); }
    else { const smp=curSamples()||[]; smp.forEach(o=>{ o.clust=((o.i*1103515245+12345)>>>0)%S.clustK; }); }
  }
  if (kind==='cat') renderClustLegend();
  drawAll();
}
{ const el=document.getElementById('cmapSel');
  if (el) el.addEventListener('change',e=>pickCmap(el.dataset.kind, e.target.value)); }
/* the three fill-view controls always sync together */
function syncFillCtls(){ syncClustCtl(); syncWitCtl(); syncCmapCtl(); }
function setFillOptions(){
  const sel=document.getElementById('fillBy');
  const base=`<option value="dProd">color: d_Prod</option><option value="dGr">color: d_Gr</option><option value="dSPD">color: d_SPD</option><option value="clust">color: cluster</option>`;
  sel.innerHTML=S.mode==='mmd'?base+`<option value="wit">color: witness</option>`:base;
  if (S.mode!=='mmd'&&S.fillBy==='wit') S.fillBy='dProd';
  sel.value=S.fillBy;
  syncFillCtls();
}
function setMode(m){
  S.mode=m;
  if (m==='g2') suppList=suppList.filter(t=>!PLOTS[t].mmdOnly);
  document.getElementById('wfG2').classList.toggle('active',m==='g2');
  document.getElementById('wfMMD').classList.toggle('active',m==='mmd');
  setFillOptions();
  buildStage();
  renderSupp();
  if (LIVEAPI.onModeChange) LIVEAPI.onModeChange(m);
}
document.getElementById('wfG2').addEventListener('click',()=>setMode('g2'));
document.getElementById('wfMMD').addEventListener('click',()=>setMode('mmd'));

/* ---------- draw orchestration ---------- */
function drawAll(){
  drawImgs();
  for(const t of suppList) PLOTS[t].draw();
  drawPins();
}
const ro=new ResizeObserver(()=>drawAll());
function observeBodies(){ document.querySelectorAll('.panel-body').forEach(el=>ro.observe(el)); }

/* progress is WS-driven */

/* ---------- terminal ---------- */
const termScroll=document.getElementById('termScroll');
function termEcho(cmd,out){
  termScroll.insertAdjacentHTML('beforeend',`<div class="tl-in"><span class="pfx">evie&gt;</span> <span class="cmd"></span></div>`);
  termScroll.lastElementChild.querySelector('.cmd').textContent=cmd;
  termScroll.insertAdjacentHTML('beforeend',`<div class="tl-out"></div>`);
  termScroll.lastElementChild.textContent=out;
  termScroll.scrollTop=termScroll.scrollHeight;
}
/* single pipeline-log DOM writer: timestamped line from TRUSTED
   markup only.  Untrusted text goes through llog, which delegates here and
   sets the message via textContent. */
function logLine(html){
  const log=document.getElementById('log');
  const t=new Date();
  const ts=[t.getHours(),t.getMinutes(),t.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
  log.insertAdjacentHTML('beforeend',`<div><span class="t">${ts}</span>${html}</div>`);
  log.scrollTop=log.scrollHeight;
  return log.lastElementChild;
}
/* echo a command line exactly as typed (textContent: never markup) */
function termCmd(cmd){
  const d=document.createElement('div'); d.className='tl-in';
  const p=document.createElement('span'); p.className='pfx'; p.textContent='evie>';
  const c=document.createElement('span'); c.className='cmd'; c.textContent=cmd;
  d.append(p,' ',c); termScroll.appendChild(d);
  termScroll.scrollTop=termScroll.scrollHeight;
}
const termIn=document.getElementById('termIn');
const hist=['help'];
let hIdx=-1;
/* one entry point for every command, typed or clicked (help links, the run
   form's setting names): echoed and remembered, so the transcript and ↑
   history are a faithful record of what was asked */
function submitCommand(cmd){
  cmd=cmd.trim(); if(!cmd) return;
  termCmd(cmd);
  if (hist[0]!==cmd) hist.unshift(cmd);
  hIdx=-1;
  LIVEAPI.liveCommand(cmd);
}
termIn.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&termIn.value.trim()){
    const cmd=termIn.value;
    termIn.value='';
    submitCommand(cmd);
  } else if(e.key==='ArrowUp'){e.preventDefault();if(hIdx<hist.length-1){hIdx++;termIn.value=hist[hIdx];}}
  else if(e.key==='ArrowDown'){e.preventDefault();if(hIdx>0){hIdx--;termIn.value=hist[hIdx];}else{hIdx=-1;termIn.value='';}}
});
const term=document.getElementById('term');
document.getElementById('termHead').addEventListener('click',()=>{
  term.classList.toggle('folded');
  document.getElementById('foldBtn').textContent=term.classList.contains('folded')?'▴':'▾';
});
/* expand for reading (help pages need more than the default 122 px) */
function growTerm(on){
  term.classList.toggle('tall', on);
  if (on && term.classList.contains('folded')){
    term.classList.remove('folded');
    document.getElementById('foldBtn').textContent='▾';
  }
}
document.getElementById('growBtn').addEventListener('click',e=>{
  e.stopPropagation();                       /* not a fold toggle */
  growTerm(!term.classList.contains('tall'));
});
/* a run-form setting's name opens its help page in the terminal: by click, or
   by Enter / Space when it has keyboard focus (it is a role=button span) */
document.addEventListener('click',e=>{
  const k=e.target.closest && e.target.closest('.hk');
  if (!k) return;
  e.preventDefault(); e.stopPropagation();
  submitCommand('help '+k.dataset.help);
});
document.addEventListener('keydown',e=>{
  if (e.key!=='Enter' && e.key!==' ') return;
  const k=e.target.closest && e.target.closest('.hk');
  if (!k) return;
  e.preventDefault();                        /* Space would scroll the rail */
  submitCommand('help '+k.dataset.help);
});

/* ---------- init ---------- */
setFillOptions();
const plotsTok=hashOpt('plots');
if (plotsTok) suppList=plotsTok.split('+').map(plotKey).filter(Boolean);
if (hashFlag('suppfold')) setSuppFold(true);   // headless smoke: minimized plots
if (hashFlag('mmd')) setMode('mmd'); else { buildStage(); renderSupp(); }
if (hashFlag('clust')){
  S.view='fill'; S.fillBy='clust';
  const ck=hashOpt('clustk');            // headless smoke: pick k
  if (ck) S.clustK=clamp(parseInt(ck,10)||4,2,CLUST_MAX);
  const cbTok=hashOpt('clustbasis');     // headless smoke: pick basis
  if (cbTok) S.clustBasis=cbTok;
  document.querySelectorAll('#viewCtl button').forEach(x=>x.classList.toggle('on',x.dataset.view==='fill'));
  const fb=document.getElementById('fillBy'); fb.hidden=false; fb.value='clust';
  syncFillCtls();
}
if (hashFlag('fill') && !hashFlag('clust')){  // smoke: d_Prod fill
  S.view='fill';
  document.querySelectorAll('#viewCtl button').forEach(x=>x.classList.toggle('on',x.dataset.view==='fill'));
  const fb=document.getElementById('fillBy'); if(fb){fb.hidden=false; fb.value=S.fillBy;}
  syncFillCtls();
}
if (hashFlag('wit')){          // headless smoke: witness fill (mmd)
  S.view='fill'; S.fillBy='wit';
  const wcTok=hashOpt('witcol');
  if (wcTok) S.witCol=clamp(parseInt(wcTok,10)||0,0,1);
  document.querySelectorAll('#viewCtl button').forEach(x=>x.classList.toggle('on',x.dataset.view==='fill'));
  const fb=document.getElementById('fillBy'); if(fb){ fb.hidden=false; fb.value='wit'; }
  syncFillCtls();
}
if (hashFlag('sst')){
  S.view='sst';
  document.querySelectorAll('#viewCtl button').forEach(x=>x.classList.toggle('on',x.dataset.view==='sst'));
}
{ const v=hashOpt('cmap');   // headless smoke: pick a colormap
  if (v){ const kind=cmapKind();
    if (CMAPS[kind][v]){ S.cmap[kind]=v; syncCmapCtl(); } } }
if (hashFlag('meanconv')){   // headless smoke: Karcher convergence view
  P.meanView='conv';
  const mv=document.getElementById('meanView'); if(mv) mv.value='conv';
}
addEventListener('load',drawAll);

/* ======================================================================
   LIVE MODE: WebSocket event stream -> pipeline log, stage HUD, progress,
   view-pill gating; terminal `run`/`cancel`/`save`/`clear` drive the engine.
   Canvas panels read the ResultStore over /api and show waiting/unavailable
   banners until their data lands (liveWait) — never mock data.
   ====================================================================== */
if (LIVE) (function(){
  const api = (path) => path + (path.includes('?')?'&':'?') + 't=' + encodeURIComponent(TOKEN);
  async function apiPost(path, body){
    const r = await fetch(api('/api'+path), {
      method:'POST', headers:{'content-type':'application/json',
                              'x-evie-token':TOKEN},
      body: JSON.stringify(body||{})});
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(data.detail || r.statusText);
    return data;
  }
  async function apiGet(path){
    const r = await fetch(api('/api'+path), {headers:{'x-evie-token':TOKEN}});
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).detail||r.statusText);
    return r.json();
  }

  /* -- live image data: real PNG + boundaries for raw/seg views -- */
  const LIVEIMG = {ready:false, byVal:{}, groups:[], pngObj:{}, bndData:{}, pending:{}};
  LIVEAPI.liveGroups = ()=> LIVEIMG.ready ? LIVEIMG.groups : null;
  LIVEAPI.liveShapeCount = (v)=> (LIVEIMG.ready && LIVEIMG.byVal[v]) ? LIVEIMG.byVal[v].n_shapes : null;
  LIVEAPI.liveAR = (cvId)=>{
    if (!LIVEIMG.ready) return null;
    const m = LIVEIMG.byVal[keyFor(cvId)];
    return m ? m.width/m.height : null;
  };
  function prefetch(v){
    if (LIVEIMG.pending[v]) return LIVEIMG.pending[v];
    const hasPng = !(LIVEIMG.byVal[v] && LIVEIMG.byVal[v].has_png===false);
    if ((LIVEIMG.pngObj[v] || !hasPng) && LIVEIMG.bndData[v]) return Promise.resolve();
    const pImg = !hasPng ? Promise.resolve()   // loaded session: no pixels in npz
      : new Promise(res=>{ const im=new Image();
          im.onload=()=>{LIVEIMG.pngObj[v]=im;res();}; im.onerror=()=>res();
          im.src=api('/api/store/image/'+v); });
    const pBnd = apiGet('/store/boundaries/'+v)
      .then(d=>{LIVEIMG.bndData[v]=d;}).catch(()=>{LIVEIMG.bndData[v]={};});
    const both = Promise.all([pImg,pBnd]).then(()=>{ LIVEIMG.pending[v]=null; drawImgs(); });
    LIVEIMG.pending[v]=both; return both;
  }
  LIVEAPI.livePrefetch = (v)=> LIVEIMG.ready ? prefetch(v) : Promise.resolve();
  /* which source image owns a global sample index: image k spans
     [sample_start, sample_start+n_shapes).  Lets the distance scatter / normal
     coordinates pin the same live card the image panel does.  Null when
     cut-locus pruning invalidated the mapping (sample_start is None). */
  LIVEAPI.liveKeyForSid = function(sid){
    if (!LIVEIMG.ready) return null;
    for (const v in LIVEIMG.byVal){
      const m=LIVEIMG.byVal[v];
      if (m.sample_start==null) continue;
      if (sid>=m.sample_start && sid<m.sample_start+m.n_shapes) return v;
    }
    return null;
  };
  async function loadImages(){
    try {
      const imgs = await apiGet('/store/images');
      LIVEIMG.byVal={}; LIVEIMG.pngObj={}; LIVEIMG.bndData={}; LIVEIMG.pending={};
      const byLabel={};
      for (const im of imgs){
        const v=String(im.image_id); LIVEIMG.byVal[v]=im;
        (byLabel[im.label]=byLabel[im.label]||[]).push({v, t:im.name});
      }
      LIVEIMG.groups=Object.entries(byLabel).map(([label,opts])=>({label,opts}));
      LIVEIMG.ready=true;
      const flat=imgs.map(im=>String(im.image_id));
      if (flat.length) S.g2img=flat[0];
      if (LIVEIMG.groups[0]) S.mmdA=LIVEIMG.groups[0].opts[0].v;
      if (LIVEIMG.groups[1]) S.mmdB=LIVEIMG.groups[1].opts[0].v;
      await Promise.all([...new Set([S.g2img,S.mmdA,S.mmdB])]
        .filter(v=>LIVEIMG.byVal[v]).map(prefetch));
      buildStage();
      setLoading('#stageWrap', false);   // image data landed
      if (hashFlag('testpin')){     // headless smoke: pin first shape
        const bd=LIVEIMG.bndData[S.g2img]||{};
        const first=Object.keys(bd)[0];
        if (first!=null && !livePins.length) LIVEAPI.livePinToggle(S.g2img,+first);
        const pz=hashOpt('pinzoom');   // card zoom view
        if (pz && first!=null){
          pinZoom[S.g2img+'|'+first]={z:+pz||2, ox:0, oy:0};
          drawPins();
        }
      }
      if (hashFlag('img2')){        // headless smoke: dropdown switch
        const flat2=imgs.map(im=>String(im.image_id));
        if (flat2.length>1) _pickImg(v=>S.g2img=v, flat2[1]);
      }
    } catch(e){ llog('warn','image load failed: '+e.message); }
  }

  /* -- live sample / spectrum / rmse + reconstruction cache -- */
  const LIVEDATA = {ready:false, samples:[], byId:{}, spectrum:null, rmse:null,
                    karcher:null, rmseHist:null, sweep:{},
                    recon:{}, reconPending:{}};
  LIVEAPI.liveSamples = ()=> LIVEDATA.ready ? LIVEDATA.samples : null;
  LIVEAPI.liveSpectrum = ()=> LIVEDATA.spectrum;
  LIVEAPI.liveRmse = ()=> LIVEDATA.rmse;
  LIVEAPI.liveKarcher = ()=> LIVEDATA.karcher;
  LIVEAPI.liveRmseHist = ()=> LIVEDATA.rmseHist;
  LIVEAPI.liveSampleById = (id)=> LIVEDATA.byId[id];
  LIVEAPI.reconAt = (r)=> LIVEDATA.recon[r] || {};
  /* PGA mode sweep: fetched lazily per mode (0-based), cached; the geodesic
     deformation is computed server-side over the observed T[k,:] envelope. */
  LIVEAPI.liveSweep = (k)=>{
    if (!LIVEDATA.ready) return null;
    const key=String(k), c=LIVEDATA.sweep[key];
    if (c==='pending'||c==='err') return null;
    if (c) return c;
    LIVEDATA.sweep[key]='pending';
    apiGet(`/store/mode_sweep?mode=${k}&steps=9`).then(res=>{
      LIVEDATA.sweep[key]=res; drawSweep();
    }).catch(e=>{ LIVEDATA.sweep[key]='err';
                  llog('warn','mode sweep failed: '+e.message); });
    return null;
  };
  /* decision landscape / SCALE sweep tiles: lazy, cached.
     Decisions are keyed by the selected scale ('run' = the run's own grid;
     's<i>' = per-scale landscape from the sweep arrays). */
  LIVEAPI.liveDecisions = ()=>{
    if (!LIVEDATA.ready) return null;
    const key = S.dlandScale==null ? 'run' : 's'+S.dlandScale;
    const c = LIVEDATA.decisions[key];
    if (c==='pending') return null;
    if (c) return c;
    LIVEDATA.decisions[key]='pending';
    apiGet('/store/decisions'+(S.dlandScale!=null?`?scale=${S.dlandScale}`:''))
      .then(res=>{ LIVEDATA.decisions[key]=res; syncDlandCtl(); drawDland(); })
      .catch(e=>{ LIVEDATA.decisions[key]={err:e.message}; drawDland(); });
    return null;
  };
  LIVEAPI.liveSsweep = ()=>{
    if (!LIVEDATA.ready) return null;
    const c=LIVEDATA.ssweepData;
    if (c==='pending') return null;
    if (c) return c;
    LIVEDATA.ssweepData='pending';
    apiGet('/store/sweep')
      .then(res=>{ LIVEDATA.ssweepData=res; drawSsweep(); syncDlandCtl(); })
      .catch(e=>{ LIVEDATA.ssweepData={none:true,msg:e.message}; drawSsweep(); });
    return null;
  };
  LIVEAPI.liveSsweepCached = ()=>{     // sweep data if (and only if) loaded OK
    const c=LIVEDATA.ssweepData;
    return (c && c!=='pending' && !c.none) ? c : null;
  };
  function resetLiveData(){
    LIVEDATA.ready=false; LIVEDATA.samples=[]; LIVEDATA.byId={};
    LIVEDATA.spectrum=null; LIVEDATA.rmse=null;
    LIVEDATA.karcher=null; LIVEDATA.rmseHist=null; LIVEDATA.sweep={};
    LIVEDATA.decisions={}; LIVEDATA.ssweepData=null; S.dlandScale=null;
    LIVEDATA.recon={}; LIVEDATA.reconPending={};
  }
  async function loadData(){
    try {
      const st = await apiGet('/store/samples?k=8');
      /* spectrum / rmse / rmse_hist are g2-only quantities: optional (mmd runs
         lack them).  karcher mean shape exists for both, but its convergence
         trace only for g2. */
      const myLoad = (LIVEDATA._loadSeq = (LIVEDATA._loadSeq||0) + 1);
      const opt = p => apiGet(p).catch(()=>null);
      // render-critical + cheap, fetched in parallel (spectrum gives nmodes and
      // the draggable r surface); the reconstruction-error curve/histogram are
      // fetched in the BACKGROUND below because for mmd they run a server-side
      // dimension sweep that must not block the first paint (a re-run would
      // otherwise appear to "not render" until the sweep finished).
      const [sp, sm, kar] = await Promise.all(
        [opt('/store/spectrum'), opt('/store/summary'), opt('/store/karcher')]);
      const n = st.idx.length, rows=[];
      for (let k=0;k<n;k++){
        const t=((st.t&&st.t[k])||[]).slice(); while(t.length<4) t.push(0);
        const s=((st.s&&st.s[k])||[]).slice(); while(s.length<3) s.push(0);
        rows.push({i: st.idx[k]+1, gid: st.idx[k],
          label: st.label?st.label[k]:'',
          dGr: st.dGr?st.dGr[k]:0, dSPD: st.dSPD?st.dSPD[k]:0,
          dProd: st.dProd?st.dProd[k]:0, t, s, clust:null,
          witCols: st.wit_cols ? st.wit_cols[k]
                   : (st.wit && st.wit[k]!=null ? [st.wit[k]] : null),
          wit: st.wit?st.wit[k]:null});
      }
      LIVEDATA.samples=rows; LIVEDATA.byId={}; rows.forEach(r=>LIVEDATA.byId[r.gid]=r);
      LIVEDATA.spectrum=sp?sp.sigma:null;
      LIVEDATA.rmse=null;          // deferred (see background fetch below)
      LIVEDATA.karcher=kar||null;
      LIVEDATA.rmseHist=null;      // deferred
      LIVEDATA.sweep={};
      LIVEDATA.witNames = st.wit_names || (st.wit ? ['witness'] : null);
      applyWitCol();     // point o.wit at the selected column (0=gr,1=spd) + witMax
      if (LIVEAPI.syncWitCtl) LIVEAPI.syncWitCtl();   // reveal gr/spd toggle now names are known
      LIVEDATA.clusters=null; LIVEDATA.clustPending=false;
      LIVEDATA.recon={}; LIVEDATA.reconPending={};
      LIVEDATA.decisions={}; LIVEDATA.ssweepData=null;
      LIVEDATA.ready=true;
      LIVEDATA.nmodes = sp?sp.sigma.length : ((sm&&sm.r)||rows.length||NMODES);
      setR(LIVEDATA.nmodes);             // lock r at the run's computed dimension
      if (hashFlag('lowr'))   // headless smoke: coarse reconstruction
        setR(Math.max(2, Math.round(LIVEDATA.nmodes*0.35)));
      setLoading('#suppRow', false);     // plot data landed
      drawAll();                         // first paint — everything except the RMSE tiles
      // deferred reconstruction-error tiles: fetched after the first paint so a
      // (possibly costly) mmd dimension sweep never blocks rendering; a newer
      // run supersedes this via the load sequence guard.
      Promise.all([opt('/store/rmse_curve'), opt('/store/rmse_hist')]).then(([rcB,rhB])=>{
        if (LIVEDATA._loadSeq!==myLoad) return;
        LIVEDATA.rmse = rcB?{dims:rcB.dims, mean:rcB.mean, max:rcB.max}:null;
        LIVEDATA.rmseHist = rhB||null;
        drawAll();
      });
      if (hashFlag('sctpin') && rows.length){
        /* headless smoke: pin via the scatter/coords code path (paired-action
           rule).  Prefer a sample NOT on the shown image so the cross-image
           prefetch + self-heal branch is exercised. */
        const shown=LIVEAPI.liveKeyForSid?LIVEAPI.liveKeyForSid(rows[0].gid):null;
        const off=rows.find(o=>LIVEAPI.liveKeyForSid
                     && LIVEAPI.liveKeyForSid(o.gid)!==shown);
        pinFromSample((off||rows[0]).gid);
      }
      const pbTok=hashOpt('probe');
      if (pbTok){   // headless smoke: probe pinned cards at r′ (pair with #testpin)
        setTimeout(()=>setProbe(parseInt(pbTok,10)||2, true), 900);
      }
    } catch(e){ llog('warn','sample data load failed: '+e.message); }
  }
  LIVEAPI.liveNModes = ()=> LIVEDATA.ready ? LIVEDATA.nmodes : null;
  LIVEAPI.liveWitMax = ()=> LIVEDATA.witMax || 1;
  /* point every sample's `wit` at the chosen witness column (0=gr, 1=spd for a
     test='both' run) and recompute the global |witness| max — everything that
     reads o.wit (fills, tooltips, witness histogram, pinned verticals) then
     tracks the selection on the next drawAll(). */
  function applyWitCol(){
    const n = LIVEDATA.witNames ? LIVEDATA.witNames.length : 1;
    const c = clamp(S.witCol, 0, Math.max(0, n-1));
    LIVEDATA.samples.forEach(o=>{ if (o.witCols) o.wit = o.witCols[c]; });
    LIVEDATA.witMax = Math.max(1e-12, ...LIVEDATA.samples.map(o=>Math.abs(o.wit??0)));
  }
  LIVEAPI.liveSetWitCol = applyWitCol;
  LIVEAPI.liveWitNames = ()=> LIVEDATA.witNames || null;
  LIVEAPI.liveTileReady = (kind)=>{
    if (!LIVEDATA.ready) return false;
    if (kind==='spec')  return !!LIVEDATA.spectrum;
    if (kind==='rconv') return !!LIVEDATA.rmse;
    if (kind==='rmse')  return !!LIVEDATA.rmseHist;
    if (kind==='mean')  return !!LIVEDATA.karcher;   // mean shape (g2 + mmd)
    if (kind==='sweep') return LIVEDATA.ready;        // curves fetched lazily
    if (kind==='whist') return LIVEDATA.samples.some(o=>o.wit!=null);
    if (kind==='dland' || kind==='ssweep')            // fetched lazily; the draw
      return S.mode==='mmd' && LIVEDATA.ready;        // paints its own states
    return kind==='sct' || kind==='pga';
  };
  LIVEAPI.liveNeedClusters = function(){
    if (LIVEDATA.clusters || LIVEDATA.clustPending || !LIVEDATA.ready) return;
    LIVEDATA.clustPending=true;
    apiGet('/store/clusters?k='+S.clustK+'&basis='+S.clustBasis+'&r='+rSel
           +'&method='+encodeURIComponent(S.clustMethod)).then(res=>{
      LIVEDATA.clusters=res.labels;
      LIVEDATA.samples.forEach(o=>{ o.clust=res.labels[o.gid]; });
      LIVEDATA.clustPending=false;
      if (LIVEAPI.renderClustLegend) LIVEAPI.renderClustLegend();   // reflect actual n_clusters
      drawAll();
      const bLabel={joint:'(d_Gr, d_SPD)',spd:'d_SPD',gr:'d_Gr',t:`T (≤r=${rSel})`,s:'S'}[res.basis]||res.basis;
      llog('ok', `clustered into ${res.n_clusters} groups over ${bLabel}`);
    }).catch(e=>{ LIVEDATA.clustPending=false;
                  llog('warn','clustering failed: '+e.message); });
  };
  /* cluster-count control changed k: drop the cached labels and refetch */
  LIVEAPI.liveReclustK = function(){
    LIVEDATA.clusters=null; LIVEDATA.clustPending=false;
    if (LIVEAPI.liveNeedClusters) LIVEAPI.liveNeedClusters();
  };
  function ensureRecon(ids, r){
    const have = LIVEDATA.recon[r] || (LIVEDATA.recon[r]={});
    const need = ids.filter(id=>!(id in have));
    if (!need.length) return;
    const key = r+':'+need.join(',');
    if (LIVEDATA.reconPending[key]) return;
    LIVEDATA.reconPending[key]=true;
    apiGet(`/store/reconstruct?ids=${need.join(',')}&r=${r}`).then(res=>{
      const tgt = LIVEDATA.recon[r] || (LIVEDATA.recon[r]={});
      for (const k in res) tgt[+k]=res[k];
      LIVEDATA.reconPending[key]=false;
      drawImgs(); drawPins();            // pinned cards pick up new geometry
    }).catch(()=>{ LIVEDATA.reconPending[key]=false; });
  }
  LIVEAPI.ensureReconVisible = function(cvId){
    const bd=LIVEIMG.bndData[keyFor(cvId)]; if(!bd) return;
    ensureRecon(Object.keys(bd).map(Number), rSel);
  };
  /* probe fetch: pinned ids at the probe r′ — tiny payload (pins only), one
     in-flight request at a time; if the probe moved while a fetch was out,
     chase the newest r′ when it lands (latest-wins).  This is what keeps the
     probe real-time at ANY ensemble size: cost is bounded by the pin count,
     never by the number of visible shapes (owner design 2026-07-11). */
  let probeBusy=false;
  LIVEAPI.probeRecon = function(){
    if (!livePins.length) return;
    const r=cardR();
    const have=LIVEDATA.recon[r]||{};
    const need=livePins.map(p=>p.sid).filter(id=>!(id in have));
    if (!need.length){ drawPins(); return; }
    if (probeBusy) return;
    probeBusy=true;
    apiGet(`/store/reconstruct?ids=${need.join(',')}&r=${r}`).then(res=>{
      const tgt=LIVEDATA.recon[r]||(LIVEDATA.recon[r]={});
      for (const k in res) tgt[+k]=res[k];
      probeBusy=false;
      drawPins();
      if (cardR()!==r) LIVEAPI.probeRecon();   // probe moved meanwhile: chase it
    }).catch(()=>{ probeBusy=false; });
  };
  LIVEAPI.liveMeta = (v)=> LIVEIMG.byVal[v];
  /* fires when the run dimensionality is set at data load (rSel is locked
     thereafter — ensemble views always render at the run's r) */
  LIVEAPI.onRSet = function(r){
    if (!LIVEDATA.ready) return;
    const ids=new Set(livePins.map(p=>p.sid));
    if (S.view==='sst'||S.view==='fill'){           // both views use recon geometry
      const a=LIVEIMG.bndData[keyFor('cImgA')]; if(a) Object.keys(a).forEach(k=>ids.add(+k));
      if (S.mode==='mmd'){ const b=LIVEIMG.bndData[keyFor('cImgB')]; if(b) Object.keys(b).forEach(k=>ids.add(+k)); }
    }
    if (ids.size) ensureRecon([...ids], r);
  };
  /* crop → rerun: today's pipeline applies sub_reg globally (rows, cols);
     per-image crops land with RunSpec.crops in a later slice */
  LIVEAPI.liveRerunCrop = function(cvId){
    const cr=cropRect[cvId]; if(!cr){ termOut('draw a crop first'); return; }
    const m=LIVEIMG.byVal[keyFor(cvId)];
    if (!m){ termOut('no image metadata for crop'); return; }
    const sub=[[Math.round(cr.v0*m.height), Math.round(cr.v1*m.height)],
               [Math.round(cr.u0*m.width),  Math.round(cr.u1*m.width)]];
    cropRect[cvId]=null; updateCropUI(cvId);   // clear the crop overlay/readout post-rerun
    termOut(`rerun with sub_reg rows[${sub[0]}] cols[${sub[1]}] — note: applies to ALL images (per-image crops land later)`);
    startRun({sub_reg:sub});
  };

  /* -- live pinned shape cards: real boundary + reconstruction -- */
  const livePins=[];   // [{key: image value, sid: global sample index}]
  const pinSize={};    // per-pin drag-resized {w,h} (freesize), keyed key|sid
  const pinZoom={};    // per-pin canvas view {z,ox,oy}, keyed key|sid
  const pinKeyOf=pn=>pn.key+'|'+pn.sid;
  function clearLivePins(){ livePins.length=0;
    for (const m of [pinSize,pinZoom]) for (const k in m) delete m[k];
    renderLivePins(); }
  LIVEAPI.livePinList = ()=> livePins.slice();
  LIVEAPI.liveIsPinned = (key,sid)=> livePins.some(p=>p.key===key&&p.sid===sid);
  LIVEAPI.livePinToggle = function(key,sid){
    const ix=livePins.findIndex(p=>p.key===key&&p.sid===sid);
    if (ix>=0){ livePins.splice(ix,1);
      delete pinSize[key+'|'+sid]; delete pinZoom[key+'|'+sid]; }
    else livePins.push({key,sid});
    ensureRecon(livePins.map(p=>p.sid), cardR());   // a pin made while probing loads at r′
    /* drawAll (not just drawImgs) so supplemental tiles that emphasize pinned
       shapes — the witness distribution's labeled verticals in particular —
       update immediately on pin/unpin (bug: they lagged until the next redraw) */
    renderLivePins(); drawAll();
  };
  /* per-card interactions: drag edges/corners to resize (freesize), scroll to
     zoom the figure about the cursor, drag to pan when zoomed; double-click on
     an edge resets the size, on the figure resets the zoom */
  const PIN_EDGE=10;
  function bindPinCard(card,pn){
    const pk=pinKeyOf(pn);
    const cv=card.querySelector('canvas');
    const zoneOf=e=>{
      const r=card.getBoundingClientRect();
      const nearL=e.clientX-r.left<PIN_EDGE, nearR=r.right-e.clientX<PIN_EDGE;
      const nearT=e.clientY-r.top<PIN_EDGE, nearB=r.bottom-e.clientY<PIN_EDGE;
      return {nearL,nearR,nearT,nearB,any:nearL||nearR||nearT||nearB};
    };
    card.addEventListener('mousemove',e=>{
      if (e.buttons) return;                       // mid-drag: keep the drag cursor
      if (e.target.closest('button')){ card.style.cursor=''; return; }
      const z=zoneOf(e);
      card.style.cursor = (z.nearR&&z.nearB)||(z.nearL&&z.nearT) ? 'nwse-resize'
        : (z.nearR&&z.nearT)||(z.nearL&&z.nearB) ? 'nesw-resize'
        : (z.nearL||z.nearR) ? 'ew-resize'
        : (z.nearT||z.nearB) ? 'ns-resize' : '';
    });
    card.addEventListener('mousedown',e=>{
      if (e.button!==0 || e.target.closest('button')) return;
      const z=zoneOf(e);
      if (z.any){                                  // resize from any edge/corner
        e.preventDefault();
        const r0=card.getBoundingClientRect(), x0=e.clientX, y0=e.clientY;
        const tray=document.getElementById('pinTray');
        const tw=tray?tray.getBoundingClientRect().width:640;
        const move=ev=>{
          let w=r0.width, h=r0.height;
          if (z.nearR) w+=ev.clientX-x0; else if (z.nearL) w-=ev.clientX-x0;
          if (z.nearB) h+=ev.clientY-y0; else if (z.nearT) h-=ev.clientY-y0;
          w=clamp(w,150,Math.max(200,tw-4)); h=clamp(h,130,1000);
          card.classList.add('freesize');
          card.style.width=w+'px'; card.style.height=h+'px';
          pinSize[pk]={w,h};
          drawPins();
        };
        const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);};
        addEventListener('mousemove',move); addEventListener('mouseup',up);
        return;
      }
      const v=pinZoom[pk];
      if (e.target===cv && v && v.z>1){            // pan the zoomed figure
        e.preventDefault();
        let lx=e.clientX, ly=e.clientY;
        const r=cv.getBoundingClientRect();
        cv.style.cursor='grabbing';
        const move=ev=>{
          v.ox=clamp(v.ox+ev.clientX-lx, -r.width*v.z/2, r.width*v.z/2);
          v.oy=clamp(v.oy+ev.clientY-ly, -r.height*v.z/2, r.height*v.z/2);
          lx=ev.clientX; ly=ev.clientY; drawPins();
        };
        const up=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',up);
          cv.style.cursor='grab';};
        addEventListener('mousemove',move); addEventListener('mouseup',up);
      }
    });
    card.addEventListener('dblclick',e=>{
      if (e.target.closest('button')) return;
      if (zoneOf(e).any){                          // reset the drag-resize
        delete pinSize[pk];
        card.classList.remove('freesize');
        card.style.width=''; card.style.height='';
        applyPinSizes();
      } else if (e.target===cv){                   // reset the zoom
        pinZoom[pk]={z:1,ox:0,oy:0}; cv.style.cursor=''; drawPins();
      }
    });
    cv.addEventListener('wheel',e=>{
      e.preventDefault();                          // zoom, don't scroll the tray
      const v=pinZoom[pk]||(pinZoom[pk]={z:1,ox:0,oy:0});
      const r=cv.getBoundingClientRect();
      const mx=e.clientX-r.left-r.width/2, my=e.clientY-r.top-r.height/2;
      const z2=clamp(v.z*Math.exp(-e.deltaY*0.0015),1,24);
      const k=z2/v.z;
      v.ox=mx-(mx-v.ox)*k; v.oy=my-(my-v.oy)*k; v.z=z2;
      if (v.z===1){ v.ox=0; v.oy=0; }
      cv.style.cursor=v.z>1?'grab':'';
      drawPins();
    },{passive:false});
  }
  function renderLivePins(){
    const tray=document.getElementById('pinTray'); if(!tray) return;
    const ps=document.getElementById('psplit');
    tray.style.display=livePins.length?'flex':'none';
    if (ps) ps.style.display=livePins.length?'block':'none';
    tray.innerHTML='';
    livePins.forEach(pn=>{
      const meta=LIVEIMG.byVal[pn.key]||{};
      const card=document.createElement('div'); card.className='pin-card';
      card.innerHTML=`<div class="pin-head"><span>#${pn.sid+1} · ${esc(meta.name||'')}</span>`
        +`<button title="unpin">✕</button></div>`
        +`<canvas title="scroll to zoom · drag to pan when zoomed · double-click resets · drag card edges/corners to resize"></canvas>`
        +`<div class="pin-kv"></div>`;
      card.querySelector('button').addEventListener('click',
        ()=>LIVEAPI.livePinToggle(pn.key,pn.sid));
      const sz=pinSize[pinKeyOf(pn)];
      if (sz){ card.classList.add('freesize');
        card.style.width=sz.w+'px'; card.style.height=sz.h+'px'; }
      bindPinCard(card,pn);
      tray.appendChild(card);
    });
    applyPinSizes();          // sizes canvases + triggers drawPins → live draw
  }
  LIVEAPI.renderLivePins = renderLivePins;
  LIVEAPI.drawLivePins = function(){
    const tray=document.getElementById('pinTray'); if(!tray) return;
    tray.querySelectorAll('.pin-card').forEach((card,ix)=>{
      const pn=livePins[ix]; if(!pn) return;
      const o=LIVEDATA.byId[pn.sid];
      const kv=card.querySelector('.pin-kv');
      const rTag = rProbe!=null ? `r′=${cardR()} <i>(probe)</i>` : `r=${cardR()}`;
      kv.innerHTML=`SST approx <b>${rTag}</b> vs original<br>`
        +(o?`d_Gr ${o.dGr.toFixed(3)} · d_SPD ${o.dSPD.toFixed(3)}<br>`
             +`d_Prod <b>${o.dProd.toFixed(3)}</b>`
             +clustTip(o)+witTip(o)
           :'metrics pending…');
      const cv=card.querySelector('canvas');
      const [ctx,W,H]=fitSelf(cv);
      ctx.fillStyle=css('--bg'); ctx.fillRect(0,0,W,H);
      const poly=(LIVEIMG.bndData[pn.key]||{})[pn.sid];
      if (!poly||!poly.length){
        ctx.fillStyle=css('--text-sec'); ctx.font='10px '+css('--font-mono');
        ctx.fillText(pn.key in LIVEIMG.bndData ? 'boundary unavailable'
                                               : 'loading boundary…', 10, H/2);
        /* pinned from a scatter/coords click whose image isn't on screen:
           fetch that image's boundaries once, then repaint the card */
        if (!(pn.key in LIVEIMG.bndData)) prefetch(pn.key).then(()=>drawPins());
        return;
      }
      const rec=(LIVEDATA.recon[cardR()]||{})[pn.sid];
      /* equal-axis autofit over original (+reconstruction) in pixel coords,
         then the card's own zoom/pan view on top (wheel + drag on the canvas) */
      let cx=0,cy=0;
      poly.forEach(p=>{cx+=p[0];cy+=p[1];}); cx/=poly.length; cy/=poly.length;
      let mr=1e-9;
      poly.concat(rec&&rec.length?rec:[]).forEach(p=>{
        mr=Math.max(mr,Math.hypot(p[0]-cx,p[1]-cy)); });
      const v=pinZoom[pinKeyOf(pn)]||{z:1,ox:0,oy:0};
      const sc=Math.min(W,H)/2*0.92/mr*v.z;
      const map=p=>[W/2+(p[0]-cx)*sc+v.ox, H/2+(p[1]-cy)*sc+v.oy];
      trace(ctx,poly.map(map));
      ctx.setLineDash([3,3]); ctx.strokeStyle=css('--text-sec');
      ctx.globalAlpha=0.7; ctx.lineWidth=1.2; ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha=1;
      if (rec && rec.length){
        trace(ctx,rec.map(map));
        ctx.strokeStyle=css('--accent-hover'); ctx.lineWidth=2; ctx.stroke();
      } else {
        ctx.fillStyle=css('--text-sec'); ctx.font='9px '+css('--font-mono');
        ctx.fillText('reconstruction loading…', 8, H-8);
        if (LIVEAPI.probeRecon) LIVEAPI.probeRecon();   // gated + latest-wins (covers run r and r′)
      }
    });
  };

  LIVEAPI.drawLiveImg = function(cvId, ctx, W, H, R, V){
    if (!LIVEIMG.ready) return false;
    const view=S.view;
    const v=keyFor(cvId); const meta=LIVEIMG.byVal[v]; if(!meta) return false;
    ctx.fillStyle=css('--bg'); ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.beginPath(); ctx.rect(R.rx,R.ry,R.rw,R.rh); ctx.clip();
    // image background for raw/seg/sst (fills view drops the photo for clean shapes)
    if (view!=='fill'){
      const img=LIVEIMG.pngObj[v];
      if (img){
        const [x0,y0]=u2s(0,0,R,V), [x1,y1]=u2s(1,1,R,V);
        ctx.imageSmoothingEnabled=false;
        /* per-view brightness (dimming slider); sst defaults dim so the
           original-vs-reconstruction overlays pop */
        ctx.globalAlpha = DIM[view]!=null ? DIM[view] : 1;
        ctx.drawImage(img, x0,y0, x1-x0, y1-y0);
        ctx.globalAlpha=1;
      } else if (meta.has_png===false){
        /* loaded session: the npz stores SST geometry, not source pixels */
        ctx.fillStyle=css('--text-sec'); ctx.font='11px '+css('--font-mono');
        ctx.fillText('no photo in session — boundaries from saved SST', R.rx+10, R.ry+22);
      } else {
        prefetch(v);
        ctx.fillStyle=css('--text-sec'); ctx.font='11px '+css('--font-mono');
        ctx.fillText('loading image…', R.rx+10, R.ry+22);
      }
    }
    imgHit[cvId]=[];
    const bd=LIVEIMG.bndData[v]||{};
    const W0=meta.width, H0=meta.height, dx=meta.dx, dy=meta.dy;
    const norm=p=>u2s((p[0]-dx)/W0,(p[1]-dy)/H0,R,V);
    // fill-view color range over the whole ensemble for the chosen metric
    let dmax=1;
    if (view==='fill'){
      const smp=curSamples();
      const pick=o=>S.fillBy==='dGr'?o.dGr:S.fillBy==='dSPD'?o.dSPD:o.dProd;
      dmax=Math.max(...smp.map(pick))||1;
    }
    const recon = LIVEAPI.reconAt ? LIVEAPI.reconAt(rSel) : {};
    if (view!=='raw'){
      for (const key in bd){
        const sid=+key, poly=bd[key]; if(!poly||!poly.length) continue;
        const screen=poly.map(norm);
        const o=LIVEAPI.liveSampleById?LIVEAPI.liveSampleById(sid):null;
        if (view==='seg'){
          trace(ctx,screen); ctx.strokeStyle=css('--accent-hover'); ctx.lineWidth=2; ctx.stroke();
        } else if (view==='sst'){
          /* original: BRIGHT dashed heading-tan so it reads clearly against
             both the (dimmable) photo and the green reconstruction */
          trace(ctx,screen);
          ctx.setLineDash([4,3]); ctx.strokeStyle=css('--heading');
          ctx.lineWidth=2; ctx.stroke();
          ctx.setLineDash([]);
          const rp=recon[sid];
          if (rp && rp.length){
            const rs=rp.map(norm);
            trace(ctx,rs); ctx.strokeStyle=css('--accent-hover'); ctx.lineWidth=2.2; ctx.stroke();
          }
        } else if (view==='fill'){
          /* fills render the SST approximation boundary at the current r
             (falls back to the original until the reconstruction arrives) */
          const rp=recon[sid];
          const geo=(rp && rp.length) ? rp.map(norm) : screen;
          trace(ctx,geo);
          if (S.fillBy==='clust'){
            if (LIVEAPI.liveNeedClusters) LIVEAPI.liveNeedClusters();
            ctx.fillStyle=(o&&o.clust!=null)?clustColors()[o.clust%CLUST_MAX]:css('--accent-dim');
          } else if (S.fillBy==='wit'){
            const wm=LIVEAPI.liveWitMax?LIVEAPI.liveWitMax():1;
            ctx.fillStyle=(o&&o.wit!=null)?dramp((o.wit/wm+1)/2):css('--accent-dim');
          } else {
            const val=o?((S.fillBy==='dGr'?o.dGr:S.fillBy==='dSPD'?o.dSPD:o.dProd)/dmax):0.5;
            ctx.fillStyle=ramp(clamp(val,0,1));
          }
          ctx.fill();
          ctx.strokeStyle=css('--bg-sec'); ctx.lineWidth=1.5; ctx.stroke();
        }
        if (S.hover.sample===sid){ trace(ctx,screen); ctx.strokeStyle=css('--heading'); ctx.lineWidth=2.5; ctx.stroke(); }
        if (LIVEAPI.liveIsPinned && LIVEAPI.liveIsPinned(v,sid)){
          const [px,py]=screen[0];
          ctx.fillStyle=css('--heading'); ctx.font='9px '+css('--font-mono');
          ctx.fillText('◉',px-3,py+3);
        }
        imgHit[cvId].push({pts:screen, sample:sid, o});
      }
      if ((view==='sst'||view==='fill') && LIVEAPI.ensureReconVisible)
        LIVEAPI.ensureReconVisible(cvId);
    }
    /* crop overlay (was mock-only; now drawn in live too) */
    const cr=cropRect[cvId];
    if (cr){
      const [cx0,cy0]=u2s(cr.u0,cr.v0,R,V), [cx1,cy1]=u2s(cr.u1,cr.v1,R,V);
      ctx.beginPath();
      ctx.rect(R.rx,R.ry,R.rw,R.rh);
      ctx.rect(cx0,cy0,cx1-cx0,cy1-cy0);
      ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fill('evenodd');
      ctx.setLineDash([5,3]); ctx.strokeStyle=css('--warn'); ctx.lineWidth=1.5;
      ctx.strokeRect(cx0,cy0,cx1-cx0,cy1-cy0); ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.strokeStyle=css('--border'); ctx.strokeRect(R.rx,R.ry,R.rw,R.rh);
    ctx.font='10px '+css('--font-mono'); ctx.fillStyle=css('--text-sec');
    const badge = {raw:'raw import', seg:'segmented boundaries',
      sst:`SST reconstruction r=${rSel} (dashed = original)`,
      fill:`fill: ${S.fillBy}`}[view];
    ctx.fillText(badge+(V.z>1?` · zoom ${V.z.toFixed(1)}×`:''), R.rx+8, R.ry+R.rh-8);
    fillColorbar(ctx, R);      // colorbar for d_*/witness fills (cluster uses legend)
    return true;
  };

  /* -- live pipeline log -- */
  const logEl = document.getElementById('log');
  function llog(mark, text){
    const m = mark==='ok' ? '<span class="okm">✓</span>'
            : mark==='warn' ? '<span class="warnm">⚠</span>'
            : mark==='err' ? '<span class="warnm" style="color:var(--err)">✕</span>'
            : mark==='run' ? '<span class="run spin">⠋</span>' : '';
    const div=logLine(`${m}<span class="lv"></span>`);
    div.querySelector('.lv').textContent=text;   // untrusted text stays escaped
    return div;
  }
  /* spinner lifecycle: at most one log line spins, and it is ALWAYS
     finalized (✓ / ·) when its stage completes or the run ends —
     spinners never hang */
  let activeLine=null;
  function startStageLine(text){
    finishActiveLine(false);
    activeLine=llog('run', text);
  }
  function updateActiveLine(text){
    if (activeLine) activeLine.querySelector('.lv').textContent=text;
  }
  function finishActiveLine(ok){
    if (!activeLine) return;
    const sp=activeLine.querySelector('.run');
    if (sp){ sp.classList.remove('spin','run');
             sp.classList.add(ok?'okm':'warnm');
             sp.textContent=ok?'✓':'·'; }
    activeLine=null;
  }
  /* panel-overlay spinners while data is in flight */
  function setLoading(rootSel,on){
    document.querySelectorAll(rootSel+' .panel-body').forEach(el=>
      el.classList.toggle('loading',on));
  }
  function termOut(text, cls){
    const d=document.createElement('div'); d.className=cls||'tl-out';
    d.textContent='      '+text; termScroll.appendChild(d);
    termScroll.scrollTop=termScroll.scrollHeight;
  }

  /* -- stage HUD: rebuild the banner runner (#stageRun) per workflow -- */
  const STAGE_LABEL = {
    import_segment:'import & segment', preview:'preview',
    srqd:'SRQD', pga_gr:'Grassmannian PGA', pga_spd:'SPD PGA',
    reconstruct:'reconstruct & distances', mmd:'MMD grid', sweep:'scale sweep',
  };
  const STAGE_SEQ = {
    g2image:['import_segment','srqd','pga_gr','pga_spd','reconstruct'],
    mmdg2image:['import_segment','mmd'],
  };
  const stageRun = document.getElementById('stageRun');   // top-banner runner
  /* Stage names arrive in engine events. Keep the table prototype-free and
     read it through own keys only, so a name like "__proto__" can neither
     read nor write Object.prototype. */
  const stageEls = Object.create(null);
  const own = (o, k)=> Object.prototype.hasOwnProperty.call(o, k);
  const stageLine = (s)=> own(stageEls, s) ? stageEls[s] : null;
  function buildStageHUD(workflow){
    stageRun.innerHTML='';
    for (const k in stageEls) delete stageEls[k];   // drop nodes of the previous workflow
    (STAGE_SEQ[workflow]||[]).forEach((s,i)=>{
      if (i) stageRun.insertAdjacentHTML('beforeend','<span class="st-sep">›</span>');
      const line=document.createElement('div');
      line.className='stage-line';
      line.innerHTML=`<span class="st-mark">·</span>${STAGE_LABEL[s]||s}`
        +`<span class="st-pct" style="display:none"></span>`
        +`<div class="pbar" style="display:none"><div></div></div>`;
      stageRun.appendChild(line);
      stageEls[s]=line;
    });
    stageRun.hidden=false;
  }
  function stageStart(s){
    if (!stageLine(s) && own(STAGE_LABEL, s)){
      // optional stage not in the workflow's static sequence (e.g. the
      // scale sweep, which only runs when the spec carries scales)
      if (stageRun.children.length)
        stageRun.insertAdjacentHTML('beforeend','<span class="st-sep">›</span>');
      const line=document.createElement('div');
      line.className='stage-line';
      line.innerHTML=`<span class="st-mark">·</span>${STAGE_LABEL[s]}`
        +`<span class="st-pct" style="display:none"></span>`
        +`<div class="pbar" style="display:none"><div></div></div>`;
      stageRun.appendChild(line);
      stageEls[s]=line;
    }
    for (const k in stageEls){
      if (k===s){
        stageEls[k].className='stage-line active';
        stageEls[k].querySelector('.st-mark').textContent='●';
      }
    }
  }
  function stageProgress(s, done, total){
    const line=stageLine(s); if(!line) return;
    const pct = total>0 ? Math.round(done/total*100) : 0;
    const pc=line.querySelector('.st-pct'), bar=line.querySelector('.pbar');
    pc.style.display=''; pc.textContent=pct+'%';
    bar.style.display=''; bar.firstElementChild.style.width=pct+'%';
  }
  function stageDone(s){
    const line=stageLine(s); if(!line) return;
    line.className='stage-line done';
    line.querySelector('.st-mark').textContent='✓';
    const pc=line.querySelector('.st-pct'), bar=line.querySelector('.pbar');
    pc.style.display='none'; bar.style.display='none';
  }

  /* -- view-pill gating: disabled until the backing view is ready -- */
  const VIEW_UNLOCK = {boundaries:['raw','seg'], reconstruction:['sst'],
                       distances:['fill']};
  function setPills(enabled){
    document.querySelectorAll('#viewCtl button').forEach(b=>{
      b.disabled=!enabled;
      b.style.opacity=enabled?'':'0.4';
      b.style.cursor=enabled?'':'not-allowed';
    });
  }
  function unlockView(view){
    (VIEW_UNLOCK[view]||[]).forEach(v=>{
      const b=document.querySelector(`#viewCtl button[data-view="${v}"]`);
      if (b){ b.disabled=false; b.style.opacity=''; b.style.cursor=''; }
    });
  }

  /* -- header / chip -- */
  const chip=document.getElementById('modeChip');
  const hdrDs=document.getElementById('hdrDs');
  function chipState(txt, live){
    chip.innerHTML=(live?'<span class="dot pulse"></span>':'')+txt;
    chip.classList.toggle('live', !!live);
  }
  /* The segmentation chip was static markup ("morph · scale 5") that never
     updated, so it misreported every run whose method or scale differed — and
     on an EBSD run it named a grayscale method that does not apply at all.
     Drive it from the form instead. */
  function segChipUpdate(){
    const el=document.getElementById('segChip');
    if (!el) return;
    el.textContent = isEbsd()
      ? `ebsd · ${FORM.misorientation_threshold}° · min ${FORM.min_pixels}px`
      : `${FORM.seg_type} · scale ${FORM.scale}`;
  }

  /* -- run lifecycle -- */
  let runActive=false, curWorkflow='g2image';
  let hasResults=false, saved=false;
  LIVEAPI.liveStatus = ()=>({running:runActive, hasResults, saved});
  LIVEAPI.liveImgReady = ()=> LIVEIMG.ready;
  LIVEAPI.liveDataReady = ()=> LIVEDATA.ready;
  function onRunStarted(ev){
    runActive=true; curWorkflow=ev.workflow;
    hasResults=false; saved=false;
    RUN_BASELINE=formSig(); markFormDirty();   // snapshot launched params; button back to "run"
    LIVEIMG.ready=false;                 // panels show waiting banners
    resetLiveData();                     // clear stale samples/spectrum/recon
    clearLivePins();
    logEl.innerHTML='';
    buildStageHUD(ev.workflow);
    setPills(false);
    setLoading('#stageWrap', true);
    setLoading('#suppRow', true);
    chipState(`${esc(ev.workflow)} · running`, true);
    startStageLine(`run started (${ev.workflow})`);
    resetCancelState();   // a fresh run is not carrying a stale cancel
    refreshActBtn();
    drawAll();                           // repaint everything as banners NOW
  }
  /* After a saved set runs, record the segmentation it was analysed with, so
     reopening it later restores those settings rather than reverting to
     defaults.  Membership is never touched.  Best-effort: a failure here must
     never affect a completed run, so it only logs. */
  function persistSavedSetSeg(){
    const ds=LIVE_STATE.dataset;
    if (!ds || !LIVE_STATE.savedSet) return;
    const labels=LIVE_STATE.groups||[];
    if (!labels.length) return;
    const perSub=perSubActive();
    const seg={};
    labels.forEach(g=>{ seg[g]=segKwOf(perSub?perLblFor(g):FORM, null); });
    apiPost('/ensembles/seg', {img_dir:ds, seg})
      .then(()=>llog('ok','segmentation stored in this ensemble set'))
      .catch(e=>llog('warn','could not store segmentation in the set: '+e.message));
  }
  function onTerminal(kind, ev){
    runActive=false;
    resetCancelState();   // drop any pending escalation timer
    finishActiveLine(kind==='RunCompleted');
    setLoading('#stageWrap', false);
    setLoading('#suppRow', false);
    for (const k in stageEls){
      if (stageEls[k].classList.contains('active')) stageEls[k].className='stage-line';
    }
    if (kind==='RunCompleted'){
      hasResults=true; saved=false;
      chipState(`✓ ${curWorkflow} · finished — results ready`, false);
      llog('ok', 'run complete — all results loaded (use 🗑 clear results to reset)');
      setPills(true);
      persistSavedSetSeg();   // the set remembers how it was just analysed
    }
    else if (kind==='RunFailed'){ chipState(`✕ ${esc(curWorkflow)} · failed`, false);
      llog('err', ev.error||'run failed'); }
    else { chipState(`${esc(curWorkflow)} · cancelled`, false);
      hasResults = LIVEIMG.ready || LIVEDATA.ready;   // partial results kept
      llog('warn', 'run cancelled'+(hasResults?' — partial results kept':'')); }
    refreshActBtn();
    markFormDirty();     // edits made during the run now surface as "rerun"
  }

  /* -- event dispatch -- */
  let pendingRequest=null;
  function dispatch(ev){
    switch(ev.type){
      case 'RunStarted': onRunStarted(ev); break;
      case 'StageStarted': stageStart(ev.stage);
        startStageLine(STAGE_LABEL[ev.stage]||ev.stage); break;
      case 'Progress':
        stageProgress(ev.stage, ev.done, ev.total);
        updateActiveLine(`${ev.label||STAGE_LABEL[ev.stage]||ev.stage} — `
          +`${ev.done}/${ev.total} (${ev.total?Math.round(ev.done/ev.total*100):0}%)`);
        break;
      case 'Log':
        if (ev.level==='step'){ updateActiveLine(ev.text); break; }
        llog(ev.level==='warning'?'warn':ev.level==='error'?'err':'', ev.text);
        break;
      case 'StageCompleted':
        stageDone(ev.stage);
        finishActiveLine(true);
        llog('ok', `${STAGE_LABEL[ev.stage]||ev.stage} — ` +
          Object.entries(ev.summary||{}).map(([k,v])=>`${k}=${v}`).join(' · '));
        break;
      case 'ViewReady':
        unlockView(ev.view);
        if (ev.view==='boundaries') loadImages();
        if (ev.view==='distances') loadData();   // g2: samples/spectrum/rmse
        break;
      case 'InputRequest':
        pendingRequest=ev;
        termOut(`preview decision needed (${ev.kind}) — type: accept | abort`);
        llog('warn', `awaiting input: ${ev.kind}`);
        break;
      case 'RunCompleted': onTerminal('RunCompleted', ev); convEnd(ev); break;
      case 'RunFailed': onTerminal('RunFailed', ev); convEnd(ev); break;
      case 'Cancelled': onTerminal('Cancelled', ev); convEnd(ev); break;
      case 'Call': convCall(ev); break;
    }
    if (ev.type==='RunStarted') convStart(ev);
  }

  /* -- the conversation: each run's routine calls, read in the terminal --
        `srqd(n_re=500, stype=periodic) → curves=565`, with every routine name
        a link to its help page.  One block per run; a RunStarted for a run
        already shown (a reconnect replays the backlog) rebuilds that block
        rather than duplicating it.  Built with textContent only. -- */
  let convBlock=null;
  const nearBottom=()=>termScroll.scrollHeight-termScroll.scrollTop-termScroll.clientHeight<40;
  const convFmt=v=> typeof v==='number'
      ? (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))))
      : Array.isArray(v) ? '['+v.map(convFmt).join(', ')+']'
      : (v!==null && typeof v==='object') ? JSON.stringify(v) : String(v);
  function convAppend(node){
    if (!convBlock) return;
    const follow=nearBottom();          /* don't yank a reader off a help page */
    convBlock.appendChild(node);
    if (follow) termScroll.scrollTop=termScroll.scrollHeight;
  }
  function convStart(ev){
    const id=String(ev.run_id||'');
    let block=[...termScroll.querySelectorAll('.tl-run')].find(b=>b.dataset.run===id);
    if (block) block.textContent='';
    else {
      block=hEl('div','tl-run'); block.dataset.run=id;
      termScroll.appendChild(block);
      termScroll.scrollTop=termScroll.scrollHeight;
    }
    convBlock=block;
    const s=ev.spec||{}, seg=s.seg_kw||{};
    const where=String(s.img_dir||'').split(/[\\/]/).filter(Boolean).pop()||'';
    const parts=[`run ${ev.workflow}`+(where?` on ${where}`:'')];
    if (seg.seg_type) parts.push(`${seg.seg_type} · scale ${convFmt(seg.scale)} · min_arc ${convFmt(seg.min_arc)}`);
    if (ev.workflow==='g2image') parts.push(`r ${s.r} · n_re ${s.n_re}${s.cut?' · cut':''}`);
    else parts.push(`r ${convFmt(s.r_vals)} × n_re ${convFmt(s.nre_vals)} · α ${s.alpha} · ${s.shuff} permutations${s.cut?' · cut':''}`);
    block.appendChild(hEl('div','r-head',parts.join('  ·  ')));
  }
  function convCall(ev){
    const d=hEl('div','tl-call');
    const link=helpLink(ev.routine, ev.routine);
    link.title=(ev.matlab?`MATLAB: ${ev.matlab} · `:'')+`help ${ev.routine}`;
    d.appendChild(link);
    d.appendChild(hEl('span','c-args','('+Object.entries(ev.args||{})
      .map(([k,v])=>`${k}=${convFmt(v)}`).join(', ')+')'));
    const res=Object.entries(ev.result||{});
    if (res.length){
      d.appendChild(hEl('span','c-arrow',' → '));
      const r=hEl('span','c-res',res.map(([k,v])=>`${k}=${convFmt(v)}`).join(' · '));
      if ((ev.result||{}).decision==='reject') r.classList.add('rej');
      d.appendChild(r);
    }
    convAppend(d);
  }
  function convEnd(ev){
    if (ev.type==='RunCompleted') convAppend(hEl('div','r-end','✓ run complete'));
    else if (ev.type==='RunFailed') convAppend(hEl('div','tl-err','✕ run failed: '+(ev.error||'')));
    else convAppend(hEl('div','r-end','run cancelled'));
    convBlock=null;
  }

  /* -- WebSocket with reconnect-resume -- */
  let ws=null;
  function connect(){
    const proto = location.protocol==='https:'?'wss':'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(TOKEN)}`);
    ws.onmessage = (m)=>{ try{ dispatch(JSON.parse(m.data)); }catch(_){} };
    ws.onclose = ()=>{ if (!ws._bye) setTimeout(connect, 1200); };
    ws.onerror = ()=>{ try{ ws.close(); }catch(_){} };
  }
  connect();

  /* -- help: the corpus in evie.help, the same pages as the TUI's [?] menu and
        `python -m evie --help-topic`.  The server sends typed blocks and they
        are built here with createElement/textContent only, so no page text is
        ever interpreted as markup. -- */
  async function helpGet(path){
    const r = await fetch(api('/api/help'+path), {headers:{'x-evie-token':TOKEN}});
    const data = await r.json().catch(()=>({}));
    return {ok:r.ok, status:r.status, data};
  }
  function hEl(tag, cls, text){
    const e=document.createElement(tag);
    if (cls) e.className=cls;
    if (text!=null) e.textContent=text;
    return e;
  }
  function helpLink(cmd, label, ok){
    const b=hEl('button', ok===false ? 'tl-link bad' : 'tl-link', label);
    b.type='button';
    if (ok===false) b.title='no such page';
    else { b.title='help '+cmd; b.addEventListener('click', ()=>submitCommand('help '+cmd)); }
    return b;
  }
  function helpSpans(parent, spans){
    for (const s of spans){
      if (s.t==='code') parent.appendChild(hEl('code', null, s.v));
      else if (s.t==='bold') parent.appendChild(hEl('b', null, s.v));
      else if (s.t==='link') parent.appendChild(helpLink(s.id, s.v, s.ok));
      else parent.appendChild(document.createTextNode(s.v));
    }
    return parent;
  }
  /* show a help block with its TOP in view: a page is read from the start */
  function helpShow(box){
    termScroll.appendChild(box);
    /* .term-scroll is position:relative, so offsetTop is within it */
    termScroll.scrollTop = Math.max(0, box.offsetTop - 22);
  }
  function helpPage(v){
    const box=hEl('div','tl-help');
    box.appendChild(hEl('div','h-title',v.title));
    const meta=[v.section+' · '+v.category];
    if (v.matlab) meta.push('MATLAB: '+v.matlab);
    if (v.python) meta.push('Python: '+v.python);
    box.appendChild(hEl('div','h-meta',meta.join('   ')));
    box.appendChild(hEl('div','h-short',v.short));
    for (const b of v.blocks){
      if (b.type==='heading') box.appendChild(hEl('div','h-sub',b.text));
      else if (b.type==='para') box.appendChild(helpSpans(hEl('p'), b.spans));
      else if (b.type==='list'){
        const ul=hEl('ul');
        b.items.forEach(it=>ul.appendChild(helpSpans(hEl('li'), it)));
        box.appendChild(ul);
      }
      else if (b.type==='code') box.appendChild(hEl('pre', null, b.text));
      else if (b.type==='table'){
        const t=hEl('table');
        b.rows.forEach((row,i)=>{
          const tr=hEl('tr');
          row.forEach(c=>tr.appendChild(helpSpans(hEl(b.header&&i===0?'th':'td'), c)));
          t.appendChild(tr);
        });
        box.appendChild(t);
      }
      else if (b.type==='values'){
        /* defaults and ranges are read from the code server-side, never typed
           into a page, so this table cannot drift from what runs */
        const t=hEl('table'), hr=hEl('tr');
        ['setting','default','valid values'].forEach(h=>hr.appendChild(hEl('th',null,h)));
        t.appendChild(hr);
        b.rows.forEach(r=>{
          const tr=hEl('tr'), name=hEl('td',null,r.name);
          name.style.color='var(--accent-hover)';
          tr.appendChild(name);
          tr.appendChild(hEl('td',null,r.default));
          tr.appendChild(hEl('td',null,r.valid||'—'));
          t.appendChild(tr);
        });
        box.appendChild(t);
      }
    }
    if (v.see_also.length){
      const p=hEl('p'); p.appendChild(hEl('span','h-meta','see also: '));
      v.see_also.forEach((s,i)=>{
        if (i) p.appendChild(document.createTextNode(', '));
        p.appendChild(helpLink(s.id, s.id, s.ok));
      });
      box.appendChild(p);
    }
    if (v.has_full && !v.blocks.some(b=>b.type==='heading'&&/^Full reference/.test(b.text))){
      const p=hEl('p','h-meta'); p.append('full reference: ');
      p.appendChild(helpLink(v.id+' --full', 'help '+v.id+' --full'));
      box.appendChild(p);
    }
    return box;
  }
  function helpListing(items){
    const ul=hEl('ul');
    items.forEach(p=>{
      const li=hEl('li'); li.appendChild(helpLink(p.id, p.id));
      li.append(' — '+p.short); ul.appendChild(li);
    });
    return ul;
  }
  const HELP_SECTIONS={glossary:'term', terms:'term', params:'param',
                       parameters:'param', routines:'routine'};
  async function helpCommand(words){
    growTerm(true);
    const full = words.includes('--full');
    const rest = words.filter(w=>w!=='--full');
    if (!rest.length){
      const box=hEl('div','tl-help');
      box.appendChild(hEl('div','h-title','evie help'));
      box.appendChild(hEl('div','h-short',
        "The same pages as the terminal UI's [?] menu and python -m evie --help-topic."));
      const ul=hEl('ul');
      [['glossary','terms: manifolds, distances, tests, segmentation methods'],
       ['params','every setting in the run form, with defaults and valid values'],
       ['routines','each pipeline routine, with its MATLAB twin']].forEach(([k,d])=>{
        const li=hEl('li'); li.appendChild(helpLink(k,'help '+k)); li.append(' — '+d);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      box.appendChild(hEl('p',null,
        'help <topic> opens a page (e.g. help srqd, help scale); help search <words> '+
        'searches every page; add --full to a routine for its complete reference. '+
        'Links are clickable, ↑ recalls what you read, and clicking a setting\'s '+
        'name in the run form opens its page.'));
      return helpShow(box);
    }
    const section = rest.length===1 && HELP_SECTIONS[rest[0].toLowerCase()];
    if (section){
      const r=await helpGet('');
      if (!r.ok) return termOut('help unavailable: '+(r.data.detail||r.status), 'tl-err');
      const box=hEl('div','tl-help');
      r.data.sections.filter(s=>s.kind===section).forEach(s=>{
        box.appendChild(hEl('div','h-title',s.title));
        s.categories.forEach(c=>{
          box.appendChild(hEl('div','h-sub',c.title));
          box.appendChild(helpListing(c.pages));
        });
      });
      return helpShow(box);
    }
    if (rest[0].toLowerCase()==='search'){
      const q=rest.slice(1).join(' ');
      if (!q) return termOut('usage: help search <words>');
      const r=await helpGet('/search?q='+encodeURIComponent(q));
      if (!r.ok) return termOut('search failed: '+(r.data.detail||r.status), 'tl-err');
      if (!r.data.results.length) return termOut(`no page mentions "${q}"`);
      const box=hEl('div','tl-help');
      box.appendChild(hEl('div','h-meta',`${r.data.results.length} page(s) for "${q}"`));
      box.appendChild(helpListing(r.data.results));
      return helpShow(box);
    }
    const key=rest.join(' ');
    const r=await helpGet('/page/'+encodeURIComponent(key)+(full?'?full=true':''));
    if (r.ok) return helpShow(helpPage(r.data));
    const d=r.data.detail||{};
    const box=hEl('div','tl-help');
    box.appendChild(hEl('div','tl-err', d.message || `no help topic "${key}"`));
    if (d.suggestions && d.suggestions.length){
      const p=hEl('p'); p.append('did you mean: ');
      d.suggestions.forEach((s,i)=>{ if(i) p.append(', '); p.appendChild(helpLink(s,s)); });
      box.appendChild(p);
    } else {
      box.appendChild(helpSpans(hEl('p'), [{t:'text',v:'try '},
        {t:'link',id:'search '+key,v:'help search '+key,ok:true}]));
    }
    helpShow(box);
  }

  /* -- terminal commands (minimal; full typed registry is 1k) -- */
  LIVEAPI.liveCommand = async function(cmd){
    const parts = cmd.split(/\s+/);
    const verb = parts[0];
    if (verb==='help' || verb==='?'){
      try { await helpCommand(parts.slice(1)); }
      catch(e){ termOut('help failed: '+e.message, 'tl-err'); }
      return;
    }
    if (verb==='run'){
      if (pendingRequest && (cmd==='accept'||cmd==='abort')) return;
      const workflow = parts[1] || 'g2image';
      const dir = parts[2];
      if (!dir){ termOut('usage: run <g2image|mmdg2image> <img_dir> [k=v ...]'); return; }
      const body = {workflow, img_dir:dir, seg_kw:{}};
      for (const kv of parts.slice(3)){
        const [k,v] = kv.split('=');
        if (k==='r'||k==='n_re'||k==='shuff') body[k]=+v;
        /* raw string: the API parses comma lists AND start:step:stop */
        else if (k==='r_vals'||k==='nre_vals') body[k]=v;
        /* `cut` alone or cut=1/true/yes/on turns it on; cut=false/0 turns it
           OFF (it used to turn it on whatever the value) */
        else if (k==='cut') body.cut = v===undefined || /^(1|true|yes|on)$/i.test(v);
        else if (k==='test') body.test=v;
        else if (k==='seg') body.seg_kw.seg_type=v;
        else if (k==='scale') body.seg_kw.scale=+v;
      }
      try { const r=await apiPost('/run', body);
        termOut(`run ${workflow} started (${r.run_id})`); }
      catch(e){ termOut('error: '+e.message); llog('err', e.message); }
      return;
    }
    if (verb==='accept'||verb==='abort'){
      if (!pendingRequest){ termOut('no pending request'); return; }
      const rq=pendingRequest; pendingRequest=null;
      if (ws && ws.readyState===1) ws.send(JSON.stringify({
        type:'respond', request_id:rq.request_id, kind:rq.kind,
        response: verb==='abort' ? {action:'abort'} : {action:'accept'}}));
      termOut(`preview ${verb}ed`);
      return;
    }
    if (verb==='cancel'){
      try { await apiPost('/cancel', {hard: parts[1]==='hard'});
        termOut('cancel requested'); }
      catch(e){ termOut('error: '+e.message); }
      return;
    }
    if (verb==='save'){
      if (!hasResults){ termOut('no results to save'); return; }
      await doSave();
      return;
    }
    if (verb==='clear'){
      if (!hasResults){ termOut('nothing to clear'); return; }
      confirmClear();
      return;
    }
    termOut(`unknown command: ${verb} (try: help, run, cancel, save, clear, accept, abort)`);
  };
  /* headless smoke: #help opens the index, #help=<topic> (or
     #help=search+words) runs that help command */
  if (hashFlag('help') || hashOpt('help')!==null)
    setTimeout(()=>submitCommand(('help '+(hashOpt('help')||'')).replace(/\+/g,' ')), 600);
  /* headless smoke: #tall expands the terminal to show the run's conversation */
  if (hashFlag('tall')) setTimeout(()=>growTerm(true), 600);
  /* headless smoke: #helpk=<topic> clicks that setting's name in the run form
     through the real handler, then gives it keyboard-style focus so the
     screenshot shows its glow (a plain script focus() is not :focus-visible) */
  if (hashOpt('helpk')) setTimeout(()=>{
    const k=document.querySelector(`#paramCard .hk[data-help="${CSS.escape(hashOpt('helpk'))}"]`);
    if (!k){ termOut('smoke: no setting named '+hashOpt('helpk'), 'tl-err'); return; }
    k.click();
    /* headless capture does not reliably advance CSS transitions: draw the
       glow's final state at once */
    k.style.transition='none';
    k.focus({focusVisible:true});
    setTimeout(()=>{
      const lit = k.matches(':focus-visible') && getComputedStyle(k).textShadow!=='none';
      termOut('smoke: glow '+(lit?'on':'OFF'), lit?null:'tl-err');
    }, 1000);
  }, 700);

  /* action button: cancel while running, clear-results (with unsaved-results
     warning, TUI-style save offer) when idle with results */
  const actBtn=document.querySelector('.cancel');
  /* declared before refreshActBtn reads it: `let` has no hoisted initialiser,
     so an early refresh would hit the temporal dead zone */
  let cancelPending=false, cancelTimer=null;
  function refreshActBtn(){
    if (!actBtn) return;
    if (runActive){
      actBtn.textContent = cancelPending ? '… cancelling' : '✕ cancel run';
      actBtn.disabled = false;   /* stays clickable: a 2nd click forces */
    }
    else if (hasResults){
      actBtn.textContent=saved?'🗑 clear results (saved)':'🗑 clear results';
      actBtn.disabled=false;
    }
    else { actBtn.textContent='no results yet'; actBtn.disabled=true; }
  }
  async function doSave(){
    try {
      /* dashboard workspace state travels in the npz (ignored by the CLI) */
      const res=await apiPost('/save',{dashboard:gatherDashboardState()});
      saved=true;
      llog('ok', `results saved → ${res.path} (${res.size_mb} MB, incl. workspace state)`);
      termOut(`saved: ${res.path}`);
      refreshActBtn();
      loadSessions();                      // the new file appears in the drawer
      return true;
    } catch(e){ llog('err','save failed: '+e.message); return false; }
  }
  async function doClear(){
    try { await apiPost('/clear',{}); }
    catch(e){ llog('err','clear failed: '+e.message); return; }
    hasResults=false; saved=false;
    LIVEIMG.ready=false; LIVEIMG.byVal={}; LIVEIMG.pngObj={};
    LIVEIMG.bndData={}; LIVEIMG.pending={}; LIVEIMG.groups=[];
    resetLiveData();
    clearLivePins();
    Object.keys(cropRect).forEach(k=>cropRect[k]=null);
    logEl.innerHTML='';
    stageRun.hidden=true; stageRun.innerHTML='';
    setPills(false);
    chipState('idle — pick a dataset &amp; press run', false);
    llog('', 'results cleared');
    refreshActBtn();
    buildStage(); renderSupp(); drawAll();   // repaint as waiting banners
  }
  /* one modal idiom for every confirmation (plan A3 — quit, load-guard and
     clear all use evieModal; the old sidebar confirm-bar is retired) */
  function confirmClear(){
    if (saved){ doClear(); return; }
    evieModal(`<h2>Clear results?</h2>`
      +`<p class="warn-line">⚠ Displayed results are not saved.</p>`
      +`<div class="modal-actions"><button id="cbSave">save &amp; clear</button>`
      +`<button id="cbDiscard" class="danger">discard</button>`
      +`<button id="cbKeep">keep</button></div>`);
    document.getElementById('cbSave').addEventListener('click', async ()=>{
      evieModalHide();
      if (await doSave()) doClear();
    });
    document.getElementById('cbDiscard').addEventListener('click',
      ()=>{ evieModalHide(); doClear(); });
    document.getElementById('cbKeep').addEventListener('click', evieModalHide);
  }
  /* Cancel is cooperative: the engine stops where it next looks at the flag.
     A single unescalated request is what made cancel look broken -- during a
     long stage nothing visibly happened, and in process mode the heavy work
     lives in pool children the flag never reaches.  So: request politely,
     say so immediately, and escalate to a hard stop if the run is still alive
     after the grace period.  A second click escalates at once. */
  const CANCEL_GRACE_MS=5000;
  function resetCancelState(){
    cancelPending=false;
    if (cancelTimer){ clearTimeout(cancelTimer); cancelTimer=null; }
  }
  async function hardCancel(reason){
    if (!runActive) return;
    llog('warn', `still running ${reason} — forcing a hard stop`);
    try { await apiPost('/cancel',{hard:true}); } catch(e){}
  }
  function requestCancel(){
    if (!cancelPending){
      cancelPending=true; refreshActBtn();
      llog('warn','cancel requested — stopping at the next checkpoint '
                 +`(forces a hard stop after ${CANCEL_GRACE_MS/1000}s)`);
      apiPost('/cancel',{hard:false}).catch(()=>{});
      cancelTimer=setTimeout(()=>hardCancel(`after ${CANCEL_GRACE_MS/1000}s`),
                             CANCEL_GRACE_MS);
    } else {
      resetCancelState(); cancelPending=true; refreshActBtn();
      hardCancel('(forced by second click)');
    }
  }
  if (actBtn) actBtn.addEventListener('click', ()=>{
    if (runActive) requestCancel();
    else if (hasResults) confirmClear();
  });

  /* -- dataset picker: populate #dsSec from /api/datasets -- */
  const LIVE_STATE = {dataset:null, groups:[], savedSet:false};
  /* pre-fill the run form from a resolved .evierc (the read side of the
     config loop: --config > results/evie_config_<ds>.evierc > ./.evierc >
     ~/.evierc).  Only keys the config actually specifies are overlaid. */
  async function prefillFromConfig(dir){
    try {
      const res=await apiGet('/config_defaults?img_dir='+encodeURIComponent(dir));
      if (!res || !res.source) return;
      const d=res.defaults||{};
      if (d.seg_type!=null) FORM.seg_type=d.seg_type;
      for (const k of ['scale','min_arc','tol_int','frame_frac_warn'])
        if (d[k]!=null) FORM[k]=d[k];
      if (d.keep_border!=null) FORM.keep_border=!!d.keep_border;
      FORM.sub_reg = d.sub_reg!=null ? JSON.stringify(d.sub_reg) : FORM.sub_reg;
      (METHOD_FIELDS[FORM.seg_type]||[]).forEach(([k])=>{
        if (d[k]!=null) methodParams(FORM.seg_type)[k]=d[k]; });
      if (d.r!=null) FORM.r=d.r;
      if (d.n_re!=null) FORM.n_re=d.n_re;
      const m=res.mmd||{};
      if (d.cut!=null) FORM.cut=!!d.cut;
      if (m.cut!=null) FORM.cut=!!m.cut;
      if (m.r_vals) FORM.r_vals=[].concat(m.r_vals).join(',');
      if (m.nre_vals) FORM.nre_vals=[].concat(m.nre_vals).join(',');
      if (m.test!=null) FORM.test=m.test;
      if (m.shuff!=null) FORM.shuff=m.shuff;
      buildRunForm(S.mode);
      llog('ok', `run form pre-filled from ${esc(res.source)}`);
      termOut(`config: ${res.source} → run form pre-filled`);
    } catch(_){ /* no config is the normal case */ }
  }
  /* ---- pre-run image browser ----------------------------
     "Pick dataset then immediately scroll through image selections to verify
     prior to running a workflow."  Deliberately NOT the segmentation-preview
     round-trip: nothing is segmented and no run is started, so it
     stays available before any engine work exists.  File order comes from the
     same discovery the run uses, so index i here is index i there. */
  async function browseDataset(path, name){
    let files=[];
    try {
      const res=await apiGet(`/dataset_files?img_dir=${encodeURIComponent(path)}`);
      files=res.files||[];
    } catch(e){ llog('err', `cannot list images: ${e.message}`); return; }
    if (!files.length){ llog('warn','no images found in that dataset'); return; }
    let i=0;
    evieModal(`<h2>${esc(name)}/ — source images</h2>`
      +`<p class="side-note">Unsegmented source images, in the order a run reads them.</p>`
      +`<div class="dsprev-wrap"><img id="dsPrevImg" alt="source image preview"></div>`
      +`<div class="dsprev-bar">`
        +`<button id="dsPrev" title="previous image">◀</button>`
        +`<input type="range" id="dsRange" min="0" max="${files.length-1}" value="0">`
        +`<button id="dsNext" title="next image">▶</button>`
      +`</div>`
      +`<p class="dsprev-cap" id="dsCap"></p>`
      +`<div class="modal-actions"><button id="dsClose">close</button></div>`, 'wide');
    const imgEl=document.getElementById('dsPrevImg');
    const capEl=document.getElementById('dsCap');
    const rng=document.getElementById('dsRange');
    function show(k){
      i=Math.max(0, Math.min(files.length-1, k));
      rng.value=i;
      const f=files[i];
      /* api() appends the ?t= token an <img> cannot send as a header */
      imgEl.src=api(`/api/dataset_image?img_dir=${encodeURIComponent(path)}`
                    +`&index=${i}`);
      capEl.innerHTML=`<b>${i+1}/${files.length}</b> · ${esc(f.name)}`
        +(f.label?` · group <b>${esc(f.label)}</b>`:'');
    }
    document.getElementById('dsPrev').addEventListener('click',()=>show(i-1));
    document.getElementById('dsNext').addEventListener('click',()=>show(i+1));
    rng.addEventListener('input',()=>show(+rng.value));
    document.getElementById('dsClose').addEventListener('click', evieModalHide);
    show(0);
  }

  /* ---- register a data directory -----------------------
     "Not clear how to add new data. We need the ability to identify and
     remember user-specific data paths as they are added."  Typed, not browsed:
     a server-side filesystem browser is a much larger attack surface for a
     service whose whole security story is "loopback + token", and the path is
     validated through the same gate a run uses. */
  function addDataPathDialog(){
    evieModal(`<h2>Add a data directory</h2>`
      +`<p class="side-note">Type a folder containing images. It is remembered `
      +`in your .evierc, so it comes back next time.</p>`
      +`<div class="cfg-rows" style="grid-template-columns:1fr">`
        +`<div class="kv"><span class="k">path</span>`
        +`<input class="pinp" id="dpPath" type="text" placeholder="D:/scans/batch7"></div>`
        +`<div class="kv"><span class="k">display name</span>`
        +`<input class="pinp" id="dpName" type="text" placeholder="(folder name)"></div>`
      +`</div>`
      +`<p class="side-note" id="dpErr" hidden></p>`
      +`<div class="modal-actions"><button id="dpCancel">cancel</button>`
      +`<button id="dpAdd">add</button></div>`, 'wide');
    const err=document.getElementById('dpErr');
    document.getElementById('dpCancel').addEventListener('click', evieModalHide);
    document.getElementById('dpAdd').addEventListener('click', async ()=>{
      const path=document.getElementById('dpPath').value.trim();
      const name=document.getElementById('dpName').value.trim();
      if (!path){ err.hidden=false; err.textContent='a path is required'; return; }
      try {
        const res=await apiPost('/data_paths', {path, name});
        evieModalHide();
        llog('ok', `data path added: ${res.name} → ${res.path} (saved in ${res.config})`);
        termOut(`data path: ${res.name} → ${res.path}`);
        loadDatasets();
      } catch(e){
        err.hidden=false;
        err.textContent=e.message
          +(/outside/i.test(e.message||'')
            ? ' — restart with --allow-external to use directories outside the data root'
            : '');
      }
    });
  }

  /* ---- custom ensemble builder --------------------------------
     For data with no usable subfolder split — the common case where every
     dataset is a single group.  Assigns individual images, or whole
     directories in bulk, to one of two ensembles that may span directories.
     Membership is explicit, so the engine skips group inference entirely. */
  const CE = {names:['A','B'], setName:'', pick:{}, files:{}, open:{}};
  /* Click a dataset row by its path — used to auto-select a set right after it
     is saved, so the builder hands straight over to the normal run flow. */
  function selectDatasetByPath(path){
    const sec=document.getElementById('dsSec'); if(!sec) return false;
    for (const b of sec.querySelectorAll('.side-item')){
      if (b.dataset.path===path){ b.click(); return true; }
    }
    return false;
  }
  function ceCount(side){
    let n=0;
    for (const dir in CE.pick)
      for (const i in CE.pick[dir]) if (CE.pick[dir][i]===side) n++;
    return n;
  }
  function ceSet(dir, idx, side){
    CE.pick[dir]=CE.pick[dir]||{};
    if (CE.pick[dir][idx]===side) delete CE.pick[dir][idx];   // click again = unassign
    else CE.pick[dir][idx]=side;
  }
  function cePayload(){
    /* Every ensemble is born carrying the segmentation currently in effect,
       not null.  A set that remembers WHICH images it compares but not HOW
       they were segmented sends the user back to defaults the next time they
       open it — settings they would reasonably expect to persist. */
    const born = segKwOf(FORM, null);
    const mk=(side,label)=>{
      const sources=[];
      for (const dir in CE.pick){
        const indices=Object.keys(CE.pick[dir])
          .filter(i=>CE.pick[dir][i]===side).map(Number).sort((a,b)=>a-b);
        if (indices.length) sources.push({dir, indices});
      }
      return {label, sources, seg:born};
    };
    return [mk('A', CE.names[0]||'A'), mk('B', CE.names[1]||'B')];
  }
  function ceSummary(){
    const a=ceCount('A'), b=ceCount('B');
    return a&&b ? `${esc(CE.names[0])} ${a} img · ${esc(CE.names[1])} ${b} img` : null;
  }
  async function ceRenderBody(datasets){
    const host=document.getElementById('ceList'); if(!host) return;
    let html='';
    for (const d of datasets){
      const open=!!CE.open[d.path];
      const mine=CE.pick[d.path]||{};
      const nA=Object.values(mine).filter(v=>v==='A').length;
      const nB=Object.values(mine).filter(v=>v==='B').length;
      html+=`<div class="ce-ds">`
        +`<div class="ce-dshead">`
          +`<button class="ce-exp" data-dir="${esc(d.path)}">${open?'▾':'▸'}</button>`
          +`<span class="ce-name" title="${esc(d.path)}">${esc(d.name)}</span>`
          +`<span class="ce-cnt">${d.n_images} img`
            +(nA?` · <b class="ce-a">${nA}→${esc(CE.names[0])}</b>`:'')
            +(nB?` · <b class="ce-b">${nB}→${esc(CE.names[1])}</b>`:'')+`</span>`
          +`<span class="ce-bulk">`
            +`<button data-bulk="A" data-dir="${esc(d.path)}" title="Assign every image in this directory">all→${esc(CE.names[0])}</button>`
            +`<button data-bulk="B" data-dir="${esc(d.path)}" title="Assign every image in this directory">all→${esc(CE.names[1])}</button>`
            +`<button data-bulk="x" data-dir="${esc(d.path)}" title="Unassign this directory">clear</button>`
          +`</span>`
        +`</div>`;
      if (open){
        const files=CE.files[d.path]||[];
        html+=`<div class="ce-imgs">`+ (files.length?files.map(f=>{
          const s=mine[f.index];
          return `<div class="ce-img">`
            +`<span class="ce-fn" title="${esc(f.name)}">${esc(f.name)}</span>`
            +(f.label?`<span class="ce-grp">${esc(f.label)}</span>`:'')
            +`<button class="ce-tog${s==='A'?' on-a':''}" data-dir="${esc(d.path)}" data-i="${f.index}" data-side="A">${esc(CE.names[0])}</button>`
            +`<button class="ce-tog${s==='B'?' on-b':''}" data-dir="${esc(d.path)}" data-i="${f.index}" data-side="B">${esc(CE.names[1])}</button>`
            +`</div>`;
        }).join(''):`<p class="side-note">loading…</p>`)+`</div>`;
      }
      html+=`</div>`;
    }
    host.innerHTML=html;

    host.querySelectorAll('.ce-exp').forEach(b=>b.addEventListener('click',async ()=>{
      const dir=b.dataset.dir;
      CE.open[dir]=!CE.open[dir];
      if (CE.open[dir] && !CE.files[dir]){
        await ceRenderBody(datasets);                       // show "loading…"
        try {
          const res=await apiGet(`/dataset_files?img_dir=${encodeURIComponent(dir)}`);
          CE.files[dir]=res.files||[];
        } catch(e){ CE.files[dir]=[]; llog('warn','cannot list images: '+e.message); }
      }
      ceRenderBody(datasets); ceSyncFoot();
    }));
    host.querySelectorAll('[data-bulk]').forEach(b=>b.addEventListener('click',async ()=>{
      const dir=b.dataset.dir, side=b.dataset.bulk;
      if (side==='x'){ delete CE.pick[dir]; }
      else {
        if (!CE.files[dir]){                     // bulk without expanding first
          try {
            const res=await apiGet(`/dataset_files?img_dir=${encodeURIComponent(dir)}`);
            CE.files[dir]=res.files||[];
          } catch(e){ llog('warn','cannot list images: '+e.message); return; }
        }
        CE.pick[dir]={};
        CE.files[dir].forEach(f=>{ CE.pick[dir][f.index]=side; });
      }
      ceRenderBody(datasets); ceSyncFoot();
    }));
    host.querySelectorAll('.ce-tog').forEach(b=>b.addEventListener('click',()=>{
      ceSet(b.dataset.dir, +b.dataset.i, b.dataset.side);
      ceRenderBody(datasets); ceSyncFoot();
    }));
  }
  function ceSyncFoot(){
    const f=document.getElementById('ceFoot'); if(!f) return;
    const a=ceCount('A'), b=ceCount('B');
    f.innerHTML=`<b class="ce-a">${esc(CE.names[0])}</b>: ${a} image${a===1?'':'s'}`
      +` · <b class="ce-b">${esc(CE.names[1])}</b>: ${b} image${b===1?'':'s'}`
      +(a&&b?'':` <span class="warn-line">— both ensembles need at least one image</span>`);
    const ok=document.getElementById('ceOk'); if(ok) ok.disabled=!(a&&b);
  }
  async function customEnsembleDialog(){
    let datasets=[];
    try { datasets=await apiGet('/datasets'); }
    catch(e){ llog('err','cannot list datasets: '+e.message); return; }
    evieModal(`<h2>Build custom ensembles</h2>`
      +`<p class="side-note">Assign images to two ensembles. They may span `
      +`directories, so this works when no dataset has two subfolders of its own. `
      +`Saving creates a <b>new dataset</b> you can pick like any other — including `
      +`setting segmentation per ensemble, and reopening it later.</p>`
      +`<div class="ce-names">`
        +`<label>set name <input class="pinp" id="ceSet" type="text" `
        +`value="${esc(CE.setName)}" placeholder="e.g. batch7 vs archive"></label>`
      +`</div>`
      +`<div class="ce-names">`
        +`<label>name A <input class="pinp" id="ceNa" type="text" value="${esc(CE.names[0])}"></label>`
        +`<label>name B <input class="pinp" id="ceNb" type="text" value="${esc(CE.names[1])}"></label>`
      +`</div>`
      +`<div class="ce-list" id="ceList"></div>`
      +`<p class="ce-foot" id="ceFoot"></p>`
      +`<div class="modal-actions"><button id="ceCancel">cancel</button>`
      +`<button id="ceClear">clear all</button>`
      +`<button id="ceOk">save as dataset</button></div>`, 'wide');
    const na=document.getElementById('ceNa'), nb=document.getElementById('ceNb');
    const rename=()=>{ CE.names=[na.value.trim()||'A', nb.value.trim()||'B'];
                       ceRenderBody(datasets); ceSyncFoot(); };
    na.addEventListener('change',rename); nb.addEventListener('change',rename);
    document.getElementById('ceCancel').addEventListener('click', evieModalHide);
    document.getElementById('ceClear').addEventListener('click',()=>{
      CE.pick={}; ceRenderBody(datasets); ceSyncFoot(); });
    document.getElementById('ceOk').addEventListener('click',async ()=>{
      if (CE.names[0]===CE.names[1]){
        llog('warn','the two ensembles need different names'); return; }
      const setEl=document.getElementById('ceSet');
      const setName=(setEl.value||'').trim();
      if (!setName){ llog('warn','give the set a name — it becomes the dataset');
        setEl.focus(); return; }
      CE.setName=setName;
      try {
        const res=await apiPost('/ensembles',
                                {name:setName, ensembles:cePayload()});
        evieModalHide();
        llog('ok', `saved ensemble set "${res.name}" (${res.n_images} images)`
                  +(res.replaced?' — replaced an existing set':''));
        termOut(`ensemble set saved: ${res.name} → ${res.path}`);
        /* auto-select it: the whole point of persisting is that the set is now
           an ordinary dataset, so drop the user straight into the normal flow */
        await loadDatasets();
        selectDatasetByPath(res.path);
      } catch(e){ llog('err','could not save set: '+e.message); }
    });
    await ceRenderBody(datasets); ceSyncFoot();
  }

  /* A saved set is self-describing: it stores the segmentation each ensemble
     was analysed with, so reopening it restores those settings instead of
     silently reverting to defaults.  Falls back to the normal .evierc pre-fill
     when the set predates stored settings. */
  async function prefillFromSavedSet(path){
    let doc;
    try { doc=await apiGet(`/ensembles?img_dir=${encodeURIComponent(path)}`); }
    catch(e){ prefillFromConfig(path); return; }
    const withSeg=(doc.ensembles||[]).filter(e=>e.seg);
    if (!withSeg.length){ prefillFromConfig(path); return; }

    const sigOf=e=>JSON.stringify(segSig(applySegInto({}, e.seg)));
    const allSame = withSeg.length===(doc.ensembles||[]).length
                    && new Set(withSeg.map(sigOf)).size===1;
    if (allSame){
      applySegInto(FORM, withSeg[0].seg);       /* one setting for the whole set */
      FORM.perSub=false;
    } else {
      (doc.ensembles||[]).forEach(e=>{
        if (e.seg) applySegInto(perLblFor(e.label), e.seg);
      });
      FORM.perSub=true;                          /* they genuinely differ */
    }
    buildRunForm(S.mode); markFormDirty();
    llog('ok', `restored segmentation stored in "${esc(doc.name||'set')}"`
              +(allSame?'' : ' (per ensemble)'));
  }
  /* copy a stored seg block onto a form state object */
  function applySegInto(target, seg){
    if (!seg) return target;
    for (const k of ['seg_type','scale','min_arc','tol_int','keep_border',
                     'frame_frac_warn','sub_reg']){
      if (seg[k]!==undefined && seg[k]!==null) target[k]=seg[k];
    }
    target.mp=target.mp||{};
    for (const k in seg){
      if (['seg_type','scale','min_arc','tol_int','keep_border',
           'frame_frac_warn','sub_reg'].indexOf(k)<0 && seg[k]!==null)
        target.mp[k]=seg[k];
    }
    return target;
  }

  async function loadDatasets(){
    const sec=document.getElementById('dsSec'); if(!sec) return;
    try {
      const ds=await apiGet('/datasets');
      sec.innerHTML='<h3>Datasets</h3>';
      const addBtn=()=>{
        const b=document.createElement('button');
        b.className='ds-add'; b.textContent='+ add data directory';
        b.title='Register a folder of images outside the data root';
        b.addEventListener('click', addDataPathDialog);
        sec.appendChild(b);
      };
      /* mmd only: the escape hatch when no dataset has two groups of its own.
         Placed ABOVE the list, not below it — a long dataset list pushed it off
         the fold, and it is needed most in exactly the case where every entry
         in that list is dimmed and unusable. */
      const ceBtn=()=>{
        if (S.mode!=='mmd') return;
        const c=document.createElement('button');
        c.className='ds-add ce-open';
        c.textContent = '⊞ build custom ensembles';
        c.title='Group images across directories into two ensembles, saved as '
               +'a new dataset you can pick like any other';
        c.addEventListener('click', customEnsembleDialog);
        sec.appendChild(c);
      };
      ceBtn();
      if (!ds.length){ sec.insertAdjacentHTML('beforeend',
        '<p class="side-note">no datasets under the data root — add one below, or use the terminal `run <workflow> <path>`</p>');
        addBtn(); return; }
      ds.forEach(d=>{
        const row=document.createElement('div');
        row.className='ds-row';
        const btn=document.createElement('button');
        btn.className='side-item';
        btn.dataset.path=d.path;
        const grp = d.groups.length ? `${d.groups.length} groups` : 'flat';
        const src = d.source==='registered' ? ' · added' : '';
        const kind = d.saved_set ? ' · ⊞ set' : '';
        if (d.broken){
          btn.classList.add('broken');
          btn.innerHTML=`${esc(d.name)}<small>⚠ saved set cannot resolve — `
            +`a source moved or changed</small>`;
          btn.title='Reopen the set and rebuild it; running it as-is could '
                   +'compare different images than intended.';
        } else {
          btn.innerHTML=`${esc(d.name)}<small>${d.n_images} images · ${grp}${src}${kind}</small>`;
        }
        if (d.source==='registered' || d.saved_set) btn.title=btn.title||d.path;
        /* mmd needs two ensembles, so a single-group dataset cannot be run as
           a two-sample test at all.  Dim it rather than let it be selected and
           fail at run time; the custom-ensemble builder below is the way to
           use such data. */
        const unusable = S.mode==='mmd' && (d.groups||[]).length<2;
        if (unusable){
          btn.classList.add('disabled');
          btn.setAttribute('aria-disabled','true');
          btn.title=`${d.name} has a single group — a two-sample test needs two. `
                   +`Use "build custom ensembles" to combine directories.`;
        }
        const eye=document.createElement('button');
        eye.className='ds-peek'; eye.textContent='◉';
        eye.title=`Browse ${d.name}/ source images before running`;
        eye.setAttribute('aria-label', `Browse ${d.name} source images`);
        eye.addEventListener('click', ev=>{
          ev.stopPropagation();          // browsing must not select the dataset
          browseDataset(d.path, d.name);
        });
        btn.addEventListener('click',()=>{
          if (unusable){ termOut(`${d.name}: single group — a two-sample test `
            +`needs two. Use "build custom ensembles" to combine directories.`);
            return; }
          const changed = LIVE_STATE.dataset && LIVE_STATE.dataset!==d.path;
          const wasSame = LIVE_STATE.dataset===d.path;
          LIVE_STATE.dataset=d.path;
          LIVE_STATE.groups=d.groups||[];
          LIVE_STATE.savedSet=!!d.saved_set;
          /* modality decides which parameter block the run form shows.  Taken
             from the server's own classification, never guessed from filenames
             here, so the form and the engine cannot disagree about what this
             directory is. */
          LIVE_STATE.modality=d.modality||'grayscale';
          segChipUpdate();          /* modality changes what the chip should say */
          /* ensembles belong to the dataset, so a switch must not carry the
             previous dataset's choice over (same rule as per-label seg) */
          if (changed || !wasSame){ FORM.group_a=''; FORM.group_b=''; }
          sec.querySelectorAll('.side-item').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          hdrDs.textContent=d.name+'/';
          termOut(`dataset: ${d.name} — ${d.n_images} images` +
            (d.groups.length>=2?` (${d.groups.join(', ')})`:''));
          if (changed && hasResults){
            termOut(`note: displayed results are from the previous run — press ▶ run to analyze ${d.name} (or 🗑 clear results)`);
            /* the image viewer showing another dataset's pixels under the
               new dataset's name is misleading: drop the
               cached image layer so the panels show waiting banners.  Kept:
               bndData (pinned cards stay coherent) and the plot data (the
               provenance note above covers them until the rerun). */
            LIVEIMG.ready=false; LIVEIMG.pngObj={};
            buildStage(); drawImgs();
          }
          /* pre-fill only on an actual dataset switch: re-clicking the active
             dataset must not silently revert hand-tuned form values */
          if (!wasSame){
            FORM.perSub=false; FORM.perLbl={};   /* per-label states are keyed by
                                                    THIS dataset's subdir names */
            buildRunForm(S.mode);                /* per-subdir toggle availability
                                                    follows the new groups */
            if (d.saved_set) prefillFromSavedSet(d.path);
            else prefillFromConfig(d.path);
          }
        });
        row.appendChild(btn); row.appendChild(eye);
        sec.appendChild(row);
      });
      addBtn();
      if (hashFlag('customens')){   // headless smoke: custom ensemble builder
        setTimeout(async ()=>{
          await customEnsembleDialog();
          // expand the first dataset so the per-image rows are exercised too,
          // not just the collapsed bulk view
          const ex=document.querySelector('#ceList .ce-exp');
          if (ex) ex.click();
        }, 400);
      }
      if (hashFlag('cfgexport')){   // headless smoke: open the export overlay
        const first=sec.querySelector('.side-item'); if(first) first.click();
        setTimeout(()=>openConfigExport(), 400);
      }
      if (hashFlag('dsswitch')){    // headless smoke: dataset switch clears the
        const items=sec.querySelectorAll('.side-item');   // stale image layer (6d)
        if (items.length>=2){
          items[0].click();
          setTimeout(()=>items[1].click(), 400);
        }
      }
      if (hashFlag('ebsd')){        // headless smoke: EBSD dataset selected, so
        const i=ds.findIndex(d=>d.modality==='ebsd');   // the run form shows the
        const items=sec.querySelectorAll('.side-item'); // orientation-map block
        if (i>=0 && items[i]) items[i].click();
      }
      if (hashFlag('persub')){      // headless smoke: per-subdir seg form (5d)
        const i=ds.findIndex(d=>(d.groups||[]).length>=2);
        const items=sec.querySelectorAll('.side-item');
        if (i>=0 && items[i]){
          items[i].click();
          FORM.perSub=true; buildRunForm(S.mode);
          const pc=document.getElementById('paramCard');
          if (pc) pc.scrollIntoView({block:'start'});   // shot must show the sections
        }
      }
    } catch(e){
      /* Datasets are optional -- a terminal `run` still works -- but the catch
         has to SAY so.  The await above precedes the innerHTML wipe, so a
         failure here leaves the section exactly as the markup shipped it; that
         used to be three hardcoded sample datasets which looked live, carried
         no dataset.path, never got a click handler, and named a dataset the
         export deliberately does not ship.  "could not reach the server" and
         "there are no datasets" are different facts and must not render the
         same. */
      sec.innerHTML = '<h3>Datasets</h3>'
        + '<p class="side-note">could not load datasets — the dashboard '
        + 'server did not answer. Reload the page, or run from the terminal: '
        + '<code>run &lt;workflow&gt; &lt;path&gt;</code></p>';
    }
  }

  /* -- session drawer: list, load, restore workspace state -- */
  function gatherDashboardState(){
    return {view:S.view, fillBy:S.fillBy, clustK:S.clustK,
            clustBasis:S.clustBasis, witCol:S.witCol,
            dlandScale:S.dlandScale,
            cmap:Object.assign({},S.cmap),
            tiles:suppList.slice(), suppFolded:suppFolded,
            pins:(LIVEAPI.livePinList?LIVEAPI.livePinList():[])
                  .map(p=>({key:p.key, sid:p.sid})),
            rProbe:rProbe};
  }
  /* Parse a session filename into its display parts.  Convention:
     evie_<workflow>_<dataset>_<YYYYMMDD>_<HHMMSS>.npz.  Files written before the
     dataset name was part of the filename leave nothing but the timestamp — say
     so rather than headlining a bare number. */
  function sessionMeta(s){
    /* LOCAL time — the filename timestamp is local (strftime), so UTC
       here made the sidebar disagree with the file by the TZ offset */
    const d=new Date(s.mtime*1000), p2=x=>String(x).padStart(2,'0');
    const day=`${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
    const time=`${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const stem=s.name.replace(/^evie_/,'').replace(/\.npz$/,'');
    /* match the workflow PREFIX so a dataset name containing "mmd" can't
       mislabel a g2 session (mirrors the /sessions route) */
    const wf = stem.startsWith('mmd_g2_image_') ? 'mmd' : 'g2';
    let ds = stem.replace(/^(mmd_)?g2_image_/,'').replace(/_\d{8}_\d{6}$/,'');
    if (!ds || /^\d{8}_\d{6}$/.test(ds)) ds='(unnamed)';
    return {ds, wf, day, time, when:`${d.getFullYear()}-${day} ${time}`};
  }
  async function loadSessions(){
    const sec=document.getElementById('sessSec'); if(!sec) return;
    try {
      const ss=await apiGet('/sessions');
      sec.innerHTML='<h3>Sessions</h3>';
      if (!ss.length){
        sec.insertAdjacentHTML('beforeend',
          '<p class="side-note">no saved sessions yet — 💾 save writes one</p>');
        return;
      }
      /* Headline the DATASET and demote workflow/time/size to the small line —
         raw filenames overflowed the sidebar.  Two saves of the
         SAME dataset then render two identical headlines, which reads as a
         duplicate entry, so colliding headlines get
         progressively disambiguated by date, then by time. */
      const shown=ss.slice(0,8).map(s=>({s, m:sessionMeta(s)}));
      const nWith=(keyOf,key)=>shown.reduce((n,x)=>n+(keyOf(x)===key?1:0),0);
      shown.forEach(({s,m})=>{
        const btn=document.createElement('button');
        btn.className='side-item';
        let head=m.ds;
        if (nWith(x=>x.m.ds, m.ds)>1){
          head=`${m.ds} · ${m.day}`;
          if (nWith(x=>`${x.m.ds} · ${x.m.day}`, head)>1) head=`${head} ${m.time}`;
        }
        btn.innerHTML=`${esc(head)}<small>${m.wf} · ${m.when} · ${s.size_mb} MB</small>`;
        btn.title='load '+s.name;   /* plain-text attribute — no HTML escaping */
        btn.addEventListener('click',()=>confirmLoadSession(s));
        sec.appendChild(btn);
      });
    } catch(e){
      /* Same shape as loadDatasets' catch above, and the same reason: the
         await precedes the wipe, so silence here left two hardcoded sample
         sessions on screen -- dated, plausible, and not real. */
      sec.innerHTML = '<h3>Sessions</h3>'
        + '<p class="side-note">could not load the session list — the '
        + 'dashboard server did not answer. Reload the page to retry.</p>';
    }
  }
  function confirmLoadSession(s){
    if (runActive){ termOut('cannot load a session while a run is active'); return; }
    if (hasResults && !saved){
      evieModal(`<h2>Load session?</h2>`
        +`<p class="warn-line">⚠ Displayed results are not saved — loading replaces them.</p>`
        +`<p class="side-note">${esc(s.name)}</p>`
        +`<div class="modal-actions"><button id="lsCancel">cancel</button>`
        +`<button id="lsGo" class="danger">load — discard current</button></div>`);
      document.getElementById('lsCancel').addEventListener('click', evieModalHide);
      document.getElementById('lsGo').addEventListener('click', ()=>{ evieModalHide(); doLoadSession(s); });
      return;
    }
    doLoadSession(s);
  }
  async function doLoadSession(s){
    try {
      setLoading('#stageWrap', true); setLoading('#suppRow', true);
      const meta=await apiPost('/load',{path:s.path});
      hasResults=true; saved=true;          // it IS the on-disk copy
      RUN_BASELINE=null;
      clearLivePins(); resetLiveData();
      LIVEIMG.ready=false; LIVEIMG.byVal={}; LIVEIMG.pngObj={};
      LIVEIMG.bndData={}; LIVEIMG.pending={};
      const mode = meta.workflow==='mmd_g2_image' ? 'mmd' : 'g2';
      if (S.mode!==mode) setMode(mode);
      logEl.innerHTML='';
      llog('ok', `session loaded: ${s.name} — ${meta.n_shapes} shapes, ${meta.workflow}`);
      if (meta.partial)
        llog('warn', 'pre-v2.1.0 session: no per-image metadata in this file — image panel'
          +(meta.workflow==='mmd_g2_image'?' and per-sample views are':' is')+' unavailable (re-run to regenerate)');
      else
        llog('', 'source images are not stored in sessions; boundaries come from the saved SST');
      chipState(`✓ session loaded — ${esc(s.name)}`, false);   // chipState writes HTML
      hdrDs.textContent=(meta.img_dir?meta.img_dir.split(/[\\/]/).filter(Boolean).pop():'?')+'/ (session)';
      stageRun.innerHTML='<div class="stage-line done"><span class="st-mark">✓</span>'
        +'loaded from '+esc(s.name)+'</div>';
      stageRun.hidden=false;
      await loadImages();
      await loadData();
      applyDashboardState(meta.dashboard);
      refreshActBtn();
      termOut(`session loaded: ${s.path}`);
    } catch(e){
      setLoading('#stageWrap', false); setLoading('#suppRow', false);
      llog('err','session load failed: '+e.message); termOut('load failed: '+e.message);
    }
  }
  function applyDashboardState(db){
    if (!db) return;
    if (db.view) S.view=db.view;
    if (db.fillBy) S.fillBy=db.fillBy;
    if (db.clustK) S.clustK=db.clustK;
    if (db.clustBasis) S.clustBasis=db.clustBasis;
    if (db.witCol!=null) S.witCol=db.witCol;
    if (db.dlandScale!=null) S.dlandScale=db.dlandScale;
    if (db.cmap) for (const k in S.cmap)
      if (db.cmap[k] && CMAPS[k] && CMAPS[k][db.cmap[k]]) S.cmap[k]=db.cmap[k];
    /* no `.length` guard: a session saved with every tile removed must restore
       as no tiles, not silently fall back to the defaults */
    if (Array.isArray(db.tiles)){
      suppList=db.tiles.filter(t=>PLOTS[t]); renderSupp();
    }
    if (db.suppFolded!=null) setSuppFold(db.suppFolded);
    document.querySelectorAll('#viewCtl button').forEach(
      x=>x.classList.toggle('on',x.dataset.view===S.view));
    const fb=document.getElementById('fillBy');
    if (fb){ fb.hidden=S.view!=='fill'; fb.value=S.fillBy; }
    syncFillCtls(); syncDimSliders();
    (db.pins||[]).forEach(p=>{
      if (LIVEAPI.livePinToggle && !(LIVEAPI.liveIsPinned&&LIVEAPI.liveIsPinned(p.key,p.sid)))
        LIVEAPI.livePinToggle(p.key,p.sid);
    });
    if (db.rProbe!=null) setProbe(db.rProbe,true);
    drawAll();
    llog('', 'workspace restored from session (view, tiles, pins'+(db.rProbe!=null?', probe':'')+')');
  }

  /* -- run parameter form: global vs method-specific sections.
        Method params rebuild on method change; mirrors SegParams fields.
        In mmd mode with a 2+-group dataset a "per-subdir seg" toggle mirrors
        the TUI's "Different segmentation per subdirectory?" flow:
        one full segmentation section per subfolder → RunSpec.seg_kw_per_label. -- */
  /* scale/min_arc must equal SegParams' defaults; test_seg_defaults.py pins
     these two literals to the Python source so the form cannot drift */
  const FORM={seg_type:'morph',scale:2,min_arc:5,tol_int:'1e-8',
              keep_border:false,frame_frac_warn:0.15,
              /* EBSD modality; inert unless the dataset is .ctf/.ang */
              misorientation_threshold:10,min_pixels:10,
              ci_floor:null,phase:null,two_pass:false,drop_irregular:true,
              sub_reg:'',                 /* '[[r0,r1],[c0,c1]]' or empty */
              r:40,n_re:500,cut:false,
              r_vals:'10,50,100',nre_vals:'250,500,750',test:'both',shuff:200,
              scales:'',                  /* optional scale sweep: '' = none */
              group_a:'', group_b:'',     /* mmd ensembles; '' = not chosen yet */
              mp:{},
              perSub:false, perLbl:{}};   /* per-subdir seg states, keyed by label */
  const SEG_METHODS=['morph','mask','multi_otsu','watershed','edge','adapt',
                     'slic','felzenszwalb','chan_vese'];
  /* per-method SegParams fields: [name, default] (defaults from SegParams) */
  const METHOD_FIELDS={
    morph:[['morph_radius',50],['erosion_radius',2]],
    mask:[], watershed:[],
    multi_otsu:[['multi_otsu_classes',3]],
    edge:[['canny_sigma',1.0]],
    adapt:[['adapt_block',35]],
    slic:[['slic_n_segments',200],['slic_compactness',0.1],['slic_rag_thresh',0.08]],
    felzenszwalb:[['fz_scale',100],['fz_min_size',50]],
    chan_vese:[['cv_iterations',200],['cv_mu',0.25]],
  };
  /* method-specific params of a seg-state (FORM itself, or a per-label clone) */
  function mpOf(st){
    if (!st.mp[st.seg_type]){
      st.mp[st.seg_type]={};
      (METHOD_FIELDS[st.seg_type]||[]).forEach(([k,d])=>st.mp[st.seg_type][k]=d);
    }
    return st.mp[st.seg_type];
  }
  /* per-label seg state: initialized as a clone of the global section so the
     config pre-fill still seeds it (mirrors the TUI using cfg_defaults per subdir) */
  function perLblFor(lbl){
    if (!FORM.perLbl[lbl])
      FORM.perLbl[lbl]={seg_type:FORM.seg_type, scale:FORM.scale,
        min_arc:FORM.min_arc, tol_int:FORM.tol_int,
        keep_border:FORM.keep_border, frame_frac_warn:FORM.frame_frac_warn,
        sub_reg:FORM.sub_reg, mp:JSON.parse(JSON.stringify(FORM.mp))};
    return FORM.perLbl[lbl];
  }
  /* subGroups() (hoisted) excludes 'root' — per-subdir seg needs real dirs */
  const perSubActive = ()=> S.mode==='mmd' && FORM.perSub
                           && subGroups().length>=2;
  /* one kv-row builder for every label+control row: the run form
     (fld/sel/checkbox rows) and the config-export overlay both go through
     kvRow, so layout and escaping cannot drift */
  /* a setting's name is its own help link: it glows on hover or keyboard
     focus, and a click opens its page in the terminal. Plain setting names
     are help topics themselves (method settings such as morph_radius are
     aliases of their method's page); the rest are mapped. */
  const HELP_FOR={'method':'seg_type', 'ensemble A':'groups',
                  'ensemble B':'groups', 'per-subdir seg':'seg_kw_per_label'};
  function helpKey(label){
    return HELP_FOR[label] || (/^[a-z_]+$/.test(label) ? label : null);
  }
  /* `noHelp`: rows inside a modal, whose scrim hides the terminal the page
     would open in */
  function kvRow(label, inner, title, noHelp){
    const key = noHelp ? null : helpKey(label);
    const tip = key ? (title ? title+'. ' : '')+'Click for its help page.' : title;
    const attrs = key
      ? ` class="k hk" role="button" tabindex="0" data-help="${esc(key)}"`
      : ` class="k"`;
    return `<div class="kv"><span${attrs}${tip?` title="${esc(tip)}"`:''}>`
      +`${label}</span>${inner}</div>`;
  }
  /* `val` is escaped: it can arrive from a .evierc profile, and an unescaped
     quote in a config value would break out of the value attribute */
  function fld(label,id,val,type,title){
    return kvRow(label,
      `<input class="pinp" id="${id}" type="${type||'number'}" step="any" value="${esc(val)}">`,
      title);
  }
  function chk(label,id,checked){
    return kvRow(label,
      `<input type="checkbox" id="${id}" class="fchk"${checked?' checked':''}>`);
  }
  function sel(id,val,opts){
    return `<select class="mini-sel" id="${id}">`+
      opts.map(o=>`<option ${o===val?'selected':''}>${o}</option>`).join('')+`</select>`;
  }
  /* one full segmentation section (method + globals + method params) bound to a
     seg-state object; `pfx` namespaces the element ids */
  /* true when the selected dataset holds .ctf/.ang orientation maps */
  function isEbsd(){ return (LIVE_STATE.modality||'grayscale')==='ebsd'; }

  function segSectionHTML(st, pfx, title){
    /* EBSD: an orientation map carries a crystal orientation per point, not an
       intensity, so the grayscale methods are meaningless on it.  The method
       selector and method-parameter block are replaced rather than merely
       disabled — a greyed-out control still reads as "this applies here". */
    if (isEbsd()){
      let rows=`<div class="form-sub">${esc(title)} · orientation map</div>`;
      rows+=fld('misorientation_threshold',pfx+'misor',st.misorientation_threshold)
        +fld('min_pixels',pfx+'minpx',st.min_pixels)
        +fld('ci_floor',pfx+'cifloor',st.ci_floor==null?'':st.ci_floor,'text')
        +fld('phase',pfx+'phase',st.phase==null?'':st.phase,'text')
        +chk('two_pass',pfx+'twopass',st.two_pass)
        +chk('drop_irregular',pfx+'dropirr',st.drop_irregular);
      rows+=`<div class="form-sub">${esc(title)} · shared</div>`;
      rows+=fld('scale',pfx+'scale',st.scale)
        +fld('min_arc',pfx+'minarc',st.min_arc)
        +fld('tol_int',pfx+'tolint',st.tol_int,'text')
        +chk('keep_border',pfx+'keepb',st.keep_border)
        +fld('sub_reg',pfx+'subreg',st.sub_reg,'text');
      return rows;
    }
    const mp=mpOf(st), mfields=METHOD_FIELDS[st.seg_type]||[];
    let rows=`<div class="form-sub">${esc(title)}</div>`;
    rows+=kvRow('method', sel(pfx+'seg',st.seg_type,SEG_METHODS))
      +fld('scale',pfx+'scale',st.scale)
      +fld('min_arc',pfx+'minarc',st.min_arc)
      +fld('tol_int',pfx+'tolint',st.tol_int,'text')
      +chk('keep_border',pfx+'keepb',st.keep_border)
      +fld('frame_frac_warn',pfx+'ffw',st.frame_frac_warn)
      +fld('sub_reg',pfx+'subreg',st.sub_reg,'text');
    rows+=`<div class="form-sub">${esc(title)} · ${esc(st.seg_type)}</div>`;
    rows+= mfields.length
      ? mfields.map(([k])=>fld(k,pfx+'mp_'+k,mp[k])).join('')
      : kvRow('<span style="opacity:0.6">no extra parameters</span>','<span></span>');
    return rows;
  }
  function bindSegSection(st, pfx, mode){
    const on=(id,fn)=>{const el=document.getElementById(id); if(el) el.addEventListener('change',()=>{fn(el.value); markFormDirty();});};
    on(pfx+'seg',v=>{st.seg_type=v; buildRunForm(mode);});   // method section rebuilds
    on(pfx+'scale',v=>st.scale=v); on(pfx+'minarc',v=>st.min_arc=v);
    on(pfx+'tolint',v=>st.tol_int=v);
    const kb=document.getElementById(pfx+'keepb');
    if (kb) kb.addEventListener('change',()=>{st.keep_border=kb.checked; markFormDirty();});
    on(pfx+'ffw',v=>st.frame_frac_warn=v);
    on(pfx+'subreg',v=>st.sub_reg=v.trim());
    (METHOD_FIELDS[st.seg_type]||[]).forEach(([k])=>on(pfx+'mp_'+k, v=>{ mpOf(st)[k]=v; }));
    /* EBSD block; blank means "unset", which must reach the server as null
       rather than 0 — a ci_floor of 0 is a real filter, absent is not */
    const num=v=>{const t=String(v).trim(); return t===''?null:t;};
    on(pfx+'misor',v=>st.misorientation_threshold=v);
    on(pfx+'minpx',v=>st.min_pixels=v);
    on(pfx+'cifloor',v=>st.ci_floor=num(v));
    on(pfx+'phase',v=>st.phase=num(v));
    [['twopass','two_pass'],['dropirr','drop_irregular']].forEach(([id,key])=>{
      const el=document.getElementById(pfx+id);
      if (el) el.addEventListener('change',()=>{st[key]=el.checked; markFormDirty();});
    });
  }
  /* one segmentation-state signature, shared by formSig (rerun detection) and
     the run form's "edited" marker, so the two cannot disagree about what
     counts as a change */
  const segSig=st=>[st.seg_type, ''+st.scale, ''+st.min_arc, ''+st.tol_int,
                    !!st.keep_border, ''+st.frame_frac_warn, ''+st.sub_reg,
                    mpOf(st),
                    /* EBSD fields belong in the signature too, or changing a
                       misorientation threshold would not mark the run stale */
                    ''+st.misorientation_threshold, ''+st.min_pixels,
                    ''+st.ci_floor, ''+st.phase,
                    !!st.two_pass, !!st.drop_irregular];
  const segSigEq=(a,b)=>JSON.stringify(segSig(a))===JSON.stringify(segSig(b));
  /* signature of the run-relevant form state; when it drifts from what was last
     launched (RUN_BASELINE) after a run has produced results, the run button
     becomes "rerun" and flashes gently so stale displayed results are obvious. */
  function formSig(){
    const per = perSubActive()
      ? subGroups().map(g=>[g, segSig(perLblFor(g))]) : null;
    return JSON.stringify([S.mode, LIVE_STATE.dataset, segSig(FORM), per, !!FORM.cut,
      S.mode==='g2' ? [''+FORM.r, ''+FORM.n_re]
                    : [''+FORM.r_vals, ''+FORM.nre_vals, FORM.test, ''+FORM.shuff,
                       ''+FORM.scales]]);
  }
  let RUN_BASELINE=null;
  function markFormDirty(){
    segChipUpdate();      /* the header must track the form, not a fixed string */
    const btn=document.getElementById('runBtn'); if(!btn) return;
    const mode=S.mode==='g2'?'g2image':'mmdg2image';
    const dirty = !runActive && hasResults && RUN_BASELINE!=null && formSig()!==RUN_BASELINE;
    btn.textContent = `▶ ${dirty?'rerun':'run'} ${mode}`;
    btn.classList.toggle('stale', dirty);
  }
  /* Real subdirectories only.  'root' is a label for loose top-level images,
     not a directory — per-subdir segmentation joins each group onto img_dir,
     so including it would look for a folder that does not exist. */
  function subGroups(){ return (LIVE_STATE.groups||[]).filter(g=>g!=='root'); }
  function buildRunForm(mode){
    const card=document.getElementById('paramCard'); if(!card) return;
    const groups=LIVE_STATE.groups||[];
    const subs=subGroups();
    const canPerSub = mode==='mmd' && subs.length>=2;
    let rows='';
    if (mode==='mmd' && groups.length>=2){
      /* Explicit ensemble choice.  The engine no longer takes
         "the first two groups" — with a lone subfolder next to loose top-level
         images that silently compared the subfolder against 'root'.  Defaults
         are pre-filled ONLY when the pair is unambiguous. */
      const unambiguous = groups.length===2 && groups.indexOf('root')<0;
      if (!FORM.group_a && unambiguous){ FORM.group_a=groups[0]; FORM.group_b=groups[1]; }
      const gsel=(id,val)=>`<select class="pinp" id="${id}">`
        +`<option value=""${val?'':' selected'}>— choose —</option>`
        +groups.map(g=>`<option value="${esc(g)}"${g===val?' selected':''}>${esc(g)}</option>`).join('')
        +`</select>`;
      rows+=`<div class="form-sub">ensembles</div>`
        +kvRow('ensemble A', gsel('f_ga',FORM.group_a),
               'First sample of the two-sample test')
        +kvRow('ensemble B', gsel('f_gb',FORM.group_b),
               'Second sample. Must differ from ensemble A.');
      if (groups.indexOf('root')>=0)
        rows+=`<p class="side-note">'root' = loose images in the dataset root, `
          +`not a subfolder. Comparing a subfolder against it is rarely intended.</p>`;
    }
    if (canPerSub)
      rows+=kvRow('per-subdir seg',
        `<input type="checkbox" id="f_persub" class="fchk"${FORM.perSub?' checked':''}>`,
        "Mirror of the TUI's 'Different segmentation per subdirectory?' flow");
    if (canPerSub && FORM.perSub){
      /* Round-8 note 6: which section governs which files was not obvious.
         Name the scope in the heading, say where these values came from, and
         mark the ones that have actually been changed away from the global
         settings — an unedited copy and a deliberate override looked identical. */
      rows+=`<p class="side-note scope-note">Each subfolder is segmented with its `
        +`own settings below. They started as copies of the global settings; `
        +`<b>edited</b> marks one you have changed.</p>`;
      subs.forEach((g,i)=>{
        const diverged = !segSigEq(perLblFor(g), FORM);
        rows+=segSectionHTML(perLblFor(g), `f_g${i}_`,
                             `seg · ${g}/ only${diverged?'  · edited':''}`);
      });
    } else {
      rows+=segSectionHTML(FORM, 'f_', mode==='mmd'
        ? 'segmentation · all subfolders'
        : 'segmentation · all images');
      if (canPerSub)
        rows+=`<p class="side-note scope-note">One setting applies to every `
          +`subfolder. Tick <b>per-subdir seg</b> above to give each its own.</p>`;
    }
    rows+=`<div class="form-sub">pipeline</div>`;
    /* cut-locus removal, both workflows: in mmd it prunes the POOLED ensembles */
    rows+=kvRow('cut',
      `<input type="checkbox" id="f_cut" class="fchk"${FORM.cut?' checked':''}>`,
      'Remove shapes beyond the convexity radius pi/4 of the Grassmannian mean');
    if (mode==='g2') rows+=fld('r','f_r',FORM.r)+fld('n_re','f_nre',FORM.n_re);
    else rows+=fld('r_vals','f_rvals',FORM.r_vals,'text',
        'Grassmannian truncations to test: comma list (10,50,100) or start:step:stop (10:20:90)')
      +fld('nre_vals','f_nrevals',FORM.nre_vals,'text',
        'Landmark counts to test: comma list (250,500,750) or start:step:stop (250:250:1000)')
      +kvRow('test', sel('f_test',FORM.test,['both','gr','spd']))
      +fld('shuff','f_shuff',FORM.shuff)
      +kvRow('scales',
        `<input class="pinp" id="f_scales" type="text" placeholder="none" value="${esc(FORM.scales)}">`,
        'Optional scale-sweep parameter study: re-runs the MMD grid at each smoothing scale (comma list or start:step:stop, >= 2 values). Empty = no sweep.');
    card.innerHTML=`<h3>Run parameters</h3>${rows}`
      +`<button class="run-btn" id="runBtn">▶ run ${mode==='g2'?'g2image':'mmdg2image'}</button>`
      +`<button class="cfg-btn" id="cfgBtn" title="Write these settings as a .evierc: python -m evie --headless runs it unattended on another machine">⬇ Save Config</button>`;
    const ps=document.getElementById('f_persub');
    if (ps) ps.addEventListener('change',()=>{FORM.perSub=ps.checked; buildRunForm(mode); markFormDirty();});
    if (canPerSub && FORM.perSub)
      subs.forEach((g,i)=>bindSegSection(perLblFor(g), `f_g${i}_`, mode));
    else
      bindSegSection(FORM, 'f_', mode);
    const on=(id,fn)=>{const el=document.getElementById(id); if(el) el.addEventListener('change',()=>{fn(el.value); markFormDirty();});};
    on('f_r',v=>FORM.r=v); on('f_nre',v=>FORM.n_re=v);
    on('f_rvals',v=>FORM.r_vals=v); on('f_nrevals',v=>FORM.nre_vals=v);
    on('f_test',v=>FORM.test=v); on('f_shuff',v=>FORM.shuff=v);
    on('f_scales',v=>FORM.scales=v.trim());
    on('f_ga',v=>FORM.group_a=v); on('f_gb',v=>FORM.group_b=v);
    const cutEl=document.getElementById('f_cut');
    if (cutEl) cutEl.addEventListener('change',()=>{FORM.cut=cutEl.checked; markFormDirty();});
    document.getElementById('runBtn').addEventListener('click',()=>startRun());
    const cb=document.getElementById('cfgBtn');
    if (cb) cb.addEventListener('click',()=>openConfigExport());
    markFormDirty();     // set label/flash to reflect current form vs last run
  }
  /* the dataset list is mode-dependent now (single-group datasets are dimmed
     in mmd, and the custom-ensemble button is mmd-only), so it must rebuild */
  LIVEAPI.onModeChange = (m)=>{ buildRunForm(m); loadDatasets(); };

  /* ---------- config export: dial in on the dashboard, run headless (HPC) ----------
     Opens an overlay listing exactly which settings will be written, editable,
     with a live server-rendered TOML preview (dry_run), then writes an .evierc
     consumable by `python -m evie --quick|--quick_compare --dir <data> --config <file>`. */
  function openConfigExport(){
    if (!LIVE_STATE.dataset){ termOut('select a dataset first — the config binds to it'); return; }
    const base=formPayload(LAST_SUBREG?{sub_reg:LAST_SUBREG}:null);
    const dsName=(LIVE_STATE.dataset.split(/[\\/]/).filter(Boolean).pop())||'dataset';
    /* editable rows: every key that will be written */
    const rowsOf=b=>{
      const out=[['profile', dsName, 'text'], ['path', '', 'text']];
      for (const k in b.seg_kw){
        const v=b.seg_kw[k];
        out.push(['seg.'+k, (v!==null&&typeof v==='object')?JSON.stringify(v):v,
                  typeof v==='boolean'?'bool':'text']);
      }
      if (b.workflow==='g2image'){ out.push(['r',b.r,'text'],['n_re',b.n_re,'text'],['cut',!!b.cut,'bool']); }
      /* r_vals/nre_vals reach the payload as raw strings (the API parses them);
         older payload shapes carried arrays, so accept both here */
      else { const grid=v=>Array.isArray(v)?v.join(','):String(v==null?'':v);
             out.push(['r_vals',grid(b.r_vals),'text'],['nre_vals',grid(b.nre_vals),'text'],
             ['test',b.test,'text'],['shuff',b.shuff,'text'],['alpha',b.alpha!=null?b.alpha:0.05,'text'],
             ['cut',!!b.cut,'bool']); }
      return out;
    };
    const rows=rowsOf(base).map(([k,v,t])=>
      kvRow(esc(k), t==='bool'
        ?`<input type="checkbox" class="cfg-f fchk" data-key="${esc(k)}"${v?' checked':''}>`
        :`<input class="pinp cfg-f" data-key="${esc(k)}" value="${esc(v)}" `+
          `placeholder="${k==='path'?'default: results/evie_config_'+esc(dsName)+'.evierc':''}">`,
        null, true)
      ).join('');
    /* per-subdir segmentation, scale sweep and ensemble choice have no rows
       here but are carried whole in the file's [run] table */
    const carried=[perSubActive()?'per-subdirectory segmentation':null,
                   base.scales?`scale sweep (${esc(base.scales)})`:null,
                   base.group_a?`ensembles ${esc(base.group_a)} vs ${esc(base.group_b||'')}`:null]
                  .filter(Boolean);
    const carriedNote = carried.length
      ? `<p class="side-note">Also written, in <b>[run]</b>: ${carried.join(', ')}.</p>`
      : '';
    evieModal(`<h2>Save run configuration (.evierc)</h2>`
      +`<p class="side-note">These exact settings will be written — adjust before saving. `
      +`The file is a complete description of this run: <code>python -m evie --headless `
      +`--config &lt;file&gt; --dir &lt;data&gt;</code> runs it unattended, wherever the `
      +`data lives (HPC). The data path itself is not stored.</p>`+carriedNote
      +`<div class="cfg-rows">${rows}</div>`
      +`<p class="warn-line" id="cfgErr" hidden></p>`
      +`<details class="cfg-prev"><summary>file preview (exact TOML)</summary><pre id="cfgToml">…</pre></details>`
      +`<div class="modal-actions"><button id="cfgCancel">cancel</button>`
      +`<button id="cfgWrite">⬇ write .evierc</button></div>`, 'wide');
    const readOverlay=()=>{
      const b=JSON.parse(JSON.stringify(base));   // deep copy
      let profile=dsName, path=null;
      document.querySelectorAll('.cfg-f').forEach(el=>{
        const k=el.dataset.key;
        const val=el.type==='checkbox'?el.checked:el.value.trim();
        if (k==='profile'){ profile=val||dsName; return; }
        if (k==='path'){ path=val||null; return; }
        if (k.startsWith('seg.')){
          const sk=k.slice(4);
          b.seg_kw[sk]= el.type==='checkbox'?val : (sk==='seg_type'?val:
            (sk==='sub_reg'? (val?JSON.parse(val):null) : +val));
          if (b.seg_kw[sk]==null) delete b.seg_kw[sk];
        }
        else if (k==='r') b.r=+val; else if (k==='n_re') b.n_re=+val;
        else if (k==='cut') b.cut=val;
        /* raw strings: parsed (and validated) server-side, so range notation
           typed into the overlay reaches the .evierc expanded, not as NaN */
        else if (k==='r_vals') b.r_vals=String(val);
        else if (k==='nre_vals') b.nre_vals=String(val);
        else if (k==='test') b.test=val; else if (k==='shuff') b.shuff=+val;
        else if (k==='alpha') b.alpha=+val;
      });
      return Object.assign(b,{profile, path});
    };
    const preview=async()=>{
      const err=document.getElementById('cfgErr'), pre=document.getElementById('cfgToml');
      try {
        const body=Object.assign(readOverlay(),{dry_run:true});
        const res=await apiPost('/export_config', body);
        if (pre) pre.textContent=res.toml;
        if (err) err.hidden=true;
        return true;
      } catch(e){ if(err){err.textContent='⚠ '+e.message; err.hidden=false;} return false; }
    };
    document.querySelectorAll('.cfg-f').forEach(el=>el.addEventListener('change',preview));
    preview();
    document.getElementById('cfgCancel').addEventListener('click', evieModalHide);
    document.getElementById('cfgWrite').addEventListener('click', async()=>{
      try {
        const res=await apiPost('/export_config', readOverlay());
        evieModalHide();
        llog('ok', `config written → ${res.path} (profile ${res.profile})`);
        termOut(`config saved: ${res.path}`);
        termOut(`headless: ${res.command}`);
      } catch(e){
        const err=document.getElementById('cfgErr');
        if(err){err.textContent='⚠ '+e.message; err.hidden=false;}
      }
    });
  }

  /* the run/export payload built from the current form (shared by startRun and
     the config export so what you save is exactly what would run) */
  function segKwOf(st, extraSeg){
    const seg_kw={scale:+st.scale,
                  min_arc:+st.min_arc, tol_int:+st.tol_int,
                  keep_border:!!st.keep_border};
    if (st.sub_reg){          /* '[[r0,r1],[c0,c1]]' from config pre-fill or hand-set */
      try { seg_kw.sub_reg=JSON.parse(st.sub_reg); }
      catch(_){ termOut(`sub_reg ignored — not valid JSON: ${st.sub_reg}`); }
    }
    if (isEbsd()){
      /* Send ONLY the EBSD block.  Shipping seg_type/morph_radius alongside an
         orientation map is refused server-side by design (a discarded setting
         is a silent wrong answer), so the form must not send what it is not
         showing. */
      const opt=v=>{const t=(v==null?'':String(v)).trim(); return t===''?null:+t;};
      seg_kw.misorientation_threshold=+st.misorientation_threshold;
      seg_kw.min_pixels=Math.round(+st.min_pixels);
      seg_kw.ci_floor=opt(st.ci_floor);
      const ph=opt(st.phase);
      seg_kw.phase = ph==null ? null : Math.round(ph);
      seg_kw.two_pass=!!st.two_pass;
      seg_kw.drop_irregular=!!st.drop_irregular;
      Object.assign(seg_kw, extraSeg||{});
      return seg_kw;
    }
    seg_kw.seg_type=st.seg_type;
    seg_kw.frame_frac_warn=+st.frame_frac_warn;
    const mp=mpOf(st);
    for (const k in mp) seg_kw[k]=+mp[k];
    Object.assign(seg_kw, extraSeg||{});   /* a crop-rerun's sub_reg wins for that run */
    return seg_kw;
  }
  function formPayload(extraSeg){
    const workflow = S.mode==='g2'?'g2image':'mmdg2image';
    const perSub = perSubActive();
    /* per-sub: the representative seg_kw is the FIRST subdir's (mirrors the
       TUI: seg_kw = dict(seg_kw_per_label[subdir_labels[0]])) */
    const subs=subGroups();
    const seg_kw = segKwOf(perSub ? perLblFor(subs[0]) : FORM, extraSeg);
    const body={workflow, img_dir:LIVE_STATE.dataset, seg_kw};
    if (perSub){
      body.seg_kw_per_label={};
      subs.forEach(g=>{
        body.seg_kw_per_label[g]=segKwOf(perLblFor(g), extraSeg); });
    }
    body.cut=!!FORM.cut;
    if (workflow==='g2image'){ body.r=+FORM.r; body.n_re=+FORM.n_re; }
    /* raw strings: the API parses comma lists AND start:step:stop for the
       r/n_re grids, same as the TUI prompts.  Parsing client-side turned
       range notation into NaN. */
    else { body.r_vals=String(FORM.r_vals).trim();
           body.nre_vals=String(FORM.nre_vals).trim();
           body.test=FORM.test; body.shuff=+FORM.shuff;
           /* raw string: the API parses comma lists AND start:step:stop */
           if (String(FORM.scales).trim()) body.scales=String(FORM.scales).trim();
           /* explicit ensembles; omitted when unset so the engine applies its
              own guardrail rather than the frontend inventing a pair */
           if (FORM.group_a) body.group_a=FORM.group_a;
           if (FORM.group_b) body.group_b=FORM.group_b; }
    return body;
  }
  let LAST_SUBREG=null;   // sub_reg of the most recent run (crop-rerun provenance)
  async function startRun(extraSeg){
    if (runActive){ termOut('a run is already active'); return; }
    if (!LIVE_STATE.dataset){
      termOut('select a dataset first (or use the terminal `run`)'); return; }
    LAST_SUBREG = (extraSeg && extraSeg.sub_reg) ? extraSeg.sub_reg : null;
    const body=Object.assign(formPayload(extraSeg), {execution:'process'});
    try { await apiPost('/run', body); }
    catch(e){ termOut('error: '+e.message); llog('err', e.message); }
  }

  /* live startup state: clear the mock transcript, lock pills, idle chip */
  logEl.innerHTML='';
  termScroll.innerHTML='';
  setPills(false);
  chipState('idle — pick a dataset &amp; press run', false);
  /* stale server: this page comes from disk, the server's Python from launch
     time.  After a pull into an editable install (or a reinstall into this
     venv), a reload brings the NEW page to the OLD server and features go
     missing without a word.  /api/build says so; a server too old to have
     the route answers 404, which means the same thing. */
  fetch(api('/api/build'), {headers:{'x-evie-token':TOKEN}})
    .then(async r=>{
      if (!(r.status===404 || (r.ok && (await r.json()).stale))) return;
      termOut('EVIE changed on disk after this dashboard started (a pull or a '+
        'reinstall), so its server is still running the old code. Quit with ⏻ '+
        'and launch again to load the new version.', 'tl-err');
      llog('warn', 'dashboard out of date: quit and relaunch (see terminal)');
    })
    .catch(()=>{ /* no answer: nothing to report */ });
  loadDatasets();
  /* clustering registry: capability, not results — fetched once at startup so
     the method dropdown is populated before any run exists */
  apiGet('/store/cluster_methods')
    .then(res=>{ CLUST_METHODS=res.methods||[];
                 if (window.renderClustMethods) window.renderClustMethods();
                 else renderClustMethods(); })
    .catch(()=>{ /* older server: dropdown stays hidden, default method used */ });
  loadSessions().then(()=>{
    if (hashFlag('loadsession')){   // headless smoke: load newest session
      const first=document.querySelector('#sessSec .side-item');
      if (first) setTimeout(()=>{ first.click();
        // auto-confirm the unsaved-results guard so the shot shows the loaded state
        setTimeout(()=>{ const go=document.getElementById('lsGo'); if(go) go.click(); }, 300);
      }, 300);
    }
  });
  buildRunForm(S.mode);
  if (hashFlag('showform')){   // headless smoke: run form in view
    const pc=document.getElementById('paramCard');
    if (pc) setTimeout(()=>pc.scrollIntoView({block:'end'}), 600);
  }
  refreshActBtn();
  hdrDs.textContent='—';
  buildStage();                       // rebuild dropdowns without mock names
  stageRun.hidden=true; stageRun.innerHTML='';   // banner runner appears on RunStarted
  termOut('live mode — pick a dataset and press ▶ run (or type `run <workflow> <path>`)');
  llog('', 'engine connected; run a workflow to populate views');
})();
