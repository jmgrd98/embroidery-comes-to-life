'use strict';
// The digitiser: turns shapes into stitches, and the scene into a list of stitches for a time t.
// One stitch = 16 floats: ax,ay,bx,by | cx,cy,width,lift | r,g,b,type | birth,dur,death,seed
const TAU = Math.PI * 2, NG = 8, LOOP = 30, SEW_END = 8, UNRAVEL = 28;
function hsh(n){ n|=0; n=Math.imul(n^(n>>>16),0x45d9f3b); n=Math.imul(n^(n>>>16),0x45d9f3b); n^=n>>>16; return (n>>>0)/4294967296; }
function srgb(hex){ return [(hex>>16)&255,(hex>>8)&255,hex&255].map(c=>Math.pow(c/255,2.2)); }
const ss=(a,b,x)=>{ x=Math.min(1,Math.max(0,(x-a)/(b-a))); return x*x*(3-2*x); };
const lerp=(a,b,u)=>a+(b-a)*u;
const C = {
  pen:srgb(0x5F93D6),
  rust:srgb(0xCC5A1E), rustD:srgb(0x9A3E15), rustL:srgb(0xE07A33), dark:srgb(0x35211A), white:srgb(0xE9E1D0),
  g1:srgb(0x5C7F38), g2:srgb(0x7C9C42), g3:srgb(0x41683A), g4:srgb(0x98B257), g5:srgb(0x2E5A41), olive:srgb(0x8A8A3C),
  sun:srgb(0xF4B92A), orange:srgb(0xEA8420), gold:srgb(0xFFD25E),
  red:srgb(0xC9382F), cream:srgb(0xF1DCA6), teal:srgb(0x2C8088), tealD:srgb(0x1F5F6B), navy:srgb(0x263F5F),
  skin:srgb(0xE9B690), hair:srgb(0x4B2D1D), mustard:srgb(0xDDA52B), pink:srgb(0xE58BA0),
  blue:srgb(0x3F78BC), blueD:srgb(0x274C86), blueL:srgb(0x8FB8E0), string:srgb(0x3A3840), brown:srgb(0x7A5232),
  lav:srgb(0xA58AD0), coral:srgb(0xEE7355)
};

function resample(pts, step){
  const seg=[]; let L=0;
  for(let i=0;i<pts.length-1;i++){ const d=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]); seg.push(d); L+=d; }
  if(L<1e-6) return [];
  const n=Math.max(1,Math.round(L/step)), out=[]; let si=0, acc=0;
  for(let k=0;k<=n;k++){
    const s=L*k/n;
    while(si<seg.length-1 && acc+seg[si]<s){ acc+=seg[si]; si++; }
    const f=seg[si]>0 ? Math.min(1,(s-acc)/seg[si]) : 0, a=pts[si], b=pts[si+1];
    out.push([a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, 0, 0, k/n]);
  }
  for(let k=0;k<=n;k++){
    const a=out[Math.max(k-1,0)], b=out[Math.min(k+1,n)];
    const dx=b[0]-a[0], dy=b[1]-a[1], l=Math.hypot(dx,dy)||1; out[k][2]=dx/l; out[k][3]=dy/l;
  }
  return out;
}
function curve(pts, sub){
  sub=sub||6; const out=[], n=pts.length;
  for(let i=0;i<n-1;i++){
    const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,n-1)];
    for(let j=0;j<sub;j++){
      const t=j/sub, t2=t*t, t3=t2*t, o=[0,0];
      for(let k=0;k<2;k++) o[k]=0.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3);
      out.push(o);
    }
  }
  out.push(pts[n-1]); return out;
}
function ellipse(cx,cy,rx,ry,rot,n){
  const out=[], c=Math.cos(rot||0), s=Math.sin(rot||0); n=n||16;
  for(let i=0;i<n;i++){ const a=i/n*TAU, x=Math.cos(a)*rx, y=Math.sin(a)*ry; out.push([cx+x*c-y*s, cy+x*s+y*c]); }
  return out;
}

class Sew {
  constructor(){ this.g=[]; for(let i=0;i<NG;i++) this.g.push([]); this.n=0; this.boil=0; this.pen=false; this.el=null; this.needle=[]; }
  begin(id,t0,t1,boil,keep){ this.el={t0,t1,keep,items:[]}; this.n=id*100000; this.boil=boil|0; }
  end(){
    const it=this.el.items, n=it.length, t0=this.el.t0, t1=this.el.t1, dt=(t1-t0)/Math.max(n,1);
    for(let i=0;i<n;i++){
      const arr=it[i][0], off=it[i][1], ob=it[i][2];
      const ord=t0+dt*i; let birth=ord, dur=Math.max(dt*2.5,0.07);
      if(ob!==undefined){ birth=ob; dur=it[i][3]||0.2; }
      arr[off+12]=birth; arr[off+13]=dur;
      arr[off+14]=this.el.keep ? 1e9 : UNRAVEL+(1-Math.min(ord,SEW_END)/SEW_END)*1.75;
      this.needle.push([birth,dur,arr[off],arr[off+1],arr[off+2],arr[off+3]]);
    }
    this.el=null;
  }
  raw(g,ax,ay,cx,cy,bx,by,w,col,type,lift,o){
    if(this.pen){ g=0; type=3; w=0.36; col=C.pen; lift=0; }
    const arr=this.g[g], off=arr.length;
    arr.push(ax,ay,bx,by,cx,cy,w,lift,col[0],col[1],col[2],type,-1,0.01,1e9,hsh(this.n*7+13));
    if(this.el && !this.pen) this.el.items.push([arr,off,o?o.birth:undefined,o?o.dur:0]);
    this.n++;
  }
  jit(k){ return hsh(this.n*31+k*7919+this.boil*104729)-0.5; }
  st(g,ax,ay,bx,by,w,col,o){
    o=o||{}; const j=o.j===undefined?0.2:o.j;
    ax+=this.jit(1)*j; ay+=this.jit(2)*j; bx+=this.jit(3)*j; by+=this.jit(4)*j;
    this.raw(g,ax,ay,(ax+bx)/2,(ay+by)/2,bx,by,w,col,o.type||0,o.lift===undefined?0.12:o.lift,o);
  }
  cv(g,ax,ay,cx,cy,bx,by,w,col,o){
    o=o||{}; const j=o.j===undefined?0.12:o.j;
    cx+=this.jit(5)*j*2; cy+=this.jit(6)*j*2;
    this.raw(g,ax,ay,cx,cy,bx,by,w,col,o.type===undefined?1:o.type,o.lift===undefined?0.15:o.lift,o);
  }
  outline(pts,closed){
    const n=pts.length;
    for(let i=0;i<(closed?n:n-1);i++){ const a=pts[i], b=pts[(i+1)%n]; this.raw(0,a[0],a[1],(a[0]+b[0])/2,(a[1]+b[1])/2,b[0],b[1],0.36,C.pen,3,0); }
  }
  // parallel satin stitches across a polygon, long ones split into long-and-short
  fill(g,poly,ang,col,o){
    if(this.pen){ this.outline(poly,true); return; }
    o=o||{}; const pitch=o.pitch||0.58, w=o.w||0.74, maxL=o.maxLen||7.5, ca=Math.cos(ang), sa=Math.sin(ang);
    const R=poly.map(p=>[p[0]*ca+p[1]*sa, -p[0]*sa+p[1]*ca]);
    let y0=1e9, y1=-1e9; for(const p of R){ y0=Math.min(y0,p[1]); y1=Math.max(y1,p[1]); }
    let row=0; const n=R.length;
    for(let y=y0+pitch*0.5; y<y1; y+=pitch, row++){
      const xs=[];
      for(let i=0;i<n;i++){ const a=R[i], b=R[(i+1)%n]; if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)) xs.push(a[0]+(y-a[1])/(b[1]-a[1])*(b[0]-a[0])); }
      xs.sort((a,b)=>a-b);
      for(let k=0;k+1<xs.length;k+=2){
        const x0=xs[k], x1=xs[k+1]; if(x1-x0<0.3) continue;
        const parts=Math.ceil((x1-x0)/maxL), pl=(x1-x0)/parts, sgn=(row%2)?1:-1;
        for(let s=0;s<parts;s++){
          let a=x0+pl*s, b=x0+pl*(s+1);
          if(s>0) a+=sgn*0.24*pl-0.25;
          if(s<parts-1) b+=sgn*0.24*pl+0.25;
          const c=typeof col==='function' ? col((a+b)/2*ca-y*sa,(a+b)/2*sa+y*ca) : col;
          if(row%2) this.st(g,b*ca-y*sa,b*sa+y*ca,a*ca-y*sa,a*sa+y*ca,w,c,o);
          else this.st(g,a*ca-y*sa,a*sa+y*ca,b*ca-y*sa,b*sa+y*ca,w,c,o);
        }
      }
    }
  }
  // satin column: stitches across a centre line, width from wf(u)
  column(g,pts,wf,col,o){
    o=o||{}; const pitch=o.pitch||0.58, w=o.w||0.74, sl=o.slant||0;
    const rs=resample(pts,pitch);
    if(this.pen){
      const A=[], B=[];
      for(let i=0;i<rs.length;i+=3){ const p=rs[i], hw=wf(p[4])/2; A.push([p[0]-p[3]*hw,p[1]+p[2]*hw]); B.push([p[0]+p[3]*hw,p[1]-p[2]*hw]); }
      this.outline(A,false); this.outline(B,false); return;
    }
    for(let i=0;i<rs.length;i++){
      const p=rs[i], wd=wf(p[4]); if(wd<0.4) continue;
      const hw=wd/2, nx=-p[3], ny=p[2], ox=p[2]*sl*hw, oy=p[3]*sl*hw;
      const c=typeof col==='function' ? col(p[4]) : col;
      const ax=p[0]-nx*hw-ox, ay=p[1]-ny*hw-oy, bx=p[0]+nx*hw+ox, by=p[1]+ny*hw+oy;
      if(i%2) this.st(g,bx,by,ax,ay,w,c,o); else this.st(g,ax,ay,bx,by,w,c,o);
    }
  }
  chain(g,pts,col,o){
    o=o||{}; const len=o.len||2.3, wd=o.wd||1.15, w=o.w||0.5;
    if(this.pen){ this.outline(resample(pts,3),false); return; }
    const rs=resample(pts,len*0.78);
    for(let i=0;i<rs.length-1;i++){
      const p=rs[i], q=rs[i+1]; let dx=q[0]-p[0], dy=q[1]-p[1]; const l=Math.hypot(dx,dy)||1; dx/=l; dy/=l;
      const ex=p[0]+dx*len, ey=p[1]+dy*len, mx=p[0]+dx*len*0.55, my=p[1]+dy*len*0.55;
      this.cv(g,p[0],p[1],mx-dy*wd,my+dx*wd,ex,ey,w,col,{type:1,lift:0.2,j:0.08});
      this.cv(g,p[0],p[1],mx+dy*wd,my-dx*wd,ex,ey,w,col,{type:1,lift:0.2,j:0.08});
    }
  }
  stem(g,pts,col,o){
    o=o||{}; const len=o.len||2.6, w=o.w||0.6;
    if(this.pen){ this.outline(resample(pts,3),false); return; }
    const rs=resample(pts,len);
    for(let i=0;i<rs.length-1;i++){
      if(o.gap && i%2) continue;
      const p=rs[i], q=rs[i+1], ov=o.gap?0:0.28;
      const dx=q[0]-p[0], dy=q[1]-p[1];
      this.st(g,p[0]-dx*ov*0.3,p[1]-dy*ov*0.3,q[0]+dx*ov,q[1]+dy*ov,w,col,{type:1,j:o.j===undefined?0.12:o.j,birth:o.birth?o.birth(i):undefined,dur:o.dur});
    }
  }
  knot(g,x,y,r,col,o){
    if(this.pen) return; o=o||{};
    const a0=this.jit(9)*TAU;
    for(let k=0;k<3;k++){
      const a=a0+k*2.2, c=r*0.55;
      this.cv(g,x+Math.cos(a)*c,y+Math.sin(a)*c,x+Math.cos(a+1.3)*r*1.25,y+Math.sin(a+1.3)*r*1.25,x+Math.cos(a+2.6)*c,y+Math.sin(a+2.6)*c,r*0.95,col,{type:1,lift:0.35,j:0,birth:o.birth,dur:o.dur});
    }
  }
  daisy(g,x,y,ang,len,wd,col,o){
    if(this.pen) return;
    o=o||{}; const dx=Math.cos(ang), dy=Math.sin(ang), ex=x+dx*len, ey=y+dy*len, mx=x+dx*len*0.6, my=y+dy*len*0.6, w=o.w||0.55;
    this.cv(g,x,y,mx-dy*wd,my+dx*wd,ex,ey,w,col,{type:1,lift:0.25,j:0.05,birth:o.birth,dur:o.dur});
    this.cv(g,ex,ey,mx+dy*wd,my-dx*wd,x,y,w,col,{type:1,lift:0.25,j:0.05,birth:o.birth===undefined?undefined:o.birth+(o.dur||0),dur:o.dur});
    this.st(g,ex-dx*0.3,ey-dy*0.3,ex+dx*0.8,ey+dy*0.8,w*0.9,col,{type:1,j:0,birth:o.birth===undefined?undefined:o.birth+2*(o.dur||0),dur:o.dur});
  }
  // a thread lying loose above the cloth, through the given points
  loose(g,pts,w,col,lift){
    if(this.pen) return;
    const n=pts.length; if(n<2) return;
    let px=pts[0][0], py=pts[0][1];
    for(let i=1;i<n;i++){
      const last=i===n-1, p=pts[i], q=last?p:pts[i+1];
      const ex=last?p[0]:(p[0]+q[0])/2, ey=last?p[1]:(p[1]+q[1])/2;
      const cx=last?(px+ex)/2:p[0], cy=last?(py+ey)/2:p[1];
      this.raw(g,px,py,cx,cy,ex,ey,w,col,1,-lift);
      px=ex; py=ey;
    }
  }
  tail(g,x,y,ang,len,col,bend){
    if(this.pen) return;
    const dx=Math.cos(ang), dy=Math.sin(ang), ex=x+dx*len-dy*bend*0.5, ey=y+dy*len+dx*bend*0.5;
    this.raw(g,x,y,x+dx*len*0.5-dy*bend,y+dy*len*0.5+dx*bend,ex,ey,0.55,col,1,0.9);
    const ta=Math.atan2(ey-(y+dy*len*0.5+dx*bend),ex-(x+dx*len*0.5-dy*bend));
    for(let k=-1;k<=1;k++){ const a=ta+k*0.45+this.jit(k+20)*0.3; this.raw(g,ex,ey,ex+Math.cos(a)*0.6,ey+Math.sin(a)*0.6,ex+Math.cos(a)*1.3,ey+Math.sin(a)*1.3,0.2,col,0,0.1); this.n++; }
  }
  pack(){
    let tot=0; const ranges=[];
    for(const a of this.g){ ranges.push([tot/16,a.length/16]); tot+=a.length; }
    const data=new Float32Array(tot); let o=0;
    for(const a of this.g){ data.set(a,o); o+=a.length; }
    this.needle.sort((a,b)=>a[0]-b[0]);
    return {data,ranges,count:tot/16,needle:this.needle};
  }
}

// ------------------------------------------------------------------ timeline (pure functions of t)
function ground(x){ return -30+2.6*Math.sin(x*0.04+0.5)+1.2*Math.sin(x*0.11+2.0); }
function gust(t){
  return 0.20+0.10*Math.sin(t*1.3)+0.45*ss(10.2,11,t)*(1-ss(11.6,12.6,t))
    +1.0*ss(14.8,16.2,t)*(1-ss(18.6,20.4,t))+0.5*ss(24.8,25.5,t)*(1-ss(26.2,27.3,t));
}
function windAt(x,t){ return gust(t-(60-x)/90); }

const FOX_X0=-44, FOX_X1=-2, FOX_X2=-15;
function foxState(t){
  const s={x:FOX_X0,dir:1,phase:0.25,mov:0,headA:0,tailS:0};
  if(t<SEW_END) return s;
  s.tailS=Math.sin(t*4.2)*0.6;
  if(t<8.75){ s.headA=0.3*ss(8,8.35,t)*(1-ss(8.5,8.75,t)); s.tailS=Math.sin((t-8)*13)*0.9; return s; }
  if(t<14.5){ const u=(t-8.75)/5.75; s.x=lerp(FOX_X0,FOX_X1,u); s.phase=(t-8.75)*2; s.mov=Math.max(0,Math.min(1,(t-8.75)*5,(14.5-t)*5)); s.tailS=Math.sin(t*12.57)*0.45+0.5; return s; }
  s.x=FOX_X1;
  if(t<15.6){ s.headA=0.12; return s; }
  s.dir=-1;
  if(t<24.5){ s.headA=0.12+0.5*ss(15.6,16.8,t)*(1-ss(23.4,24.3,t)); s.tailS=Math.sin(t*3.1)*0.9; return s; }
  const u=Math.min(1,(t-24.5)/3.2); s.x=lerp(FOX_X1,FOX_X2,u); s.phase=(t-24.5)*2;
  s.mov=Math.max(0,Math.min(1,(t-24.5)*5,(27.7-t)*5)); s.tailS=Math.sin(t*12.57)*0.45+0.5; return s;
}
const BIRD_PATH=[[18,-25],[21,-14],[19,0],[8,14],[-14,16],[-40,8],[-54,-9],[-50,-27]];
const BIRD_T0=12.2, BIRD_T1=16.8;
function pathAt(pts,u){
  const n=pts.length-1, f=Math.min(Math.max(u,0),0.9999)*n, i=Math.floor(f), t=f-i;
  const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,n)], t2=t*t, t3=t2*t, o=[0,0];
  for(let k=0;k<2;k++) o[k]=0.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3);
  return o;
}
function birdState(t){
  const s={x:18,y:ground(18)+2.2,dir:-1,fly:0,wing:0,rot:0,peck:0};
  if(t<4.2) return s;
  const step=Math.floor(t*12+1e-4);
  if(t<BIRD_T0){ const k=step%17; s.peck=k<2?1:0; if(k===8||k===9) s.y+=0.9; if(t>11.5){ s.peck=0; s.y+=(step%2)*0.8; } return s; }
  if(t<BIRD_T1){
    const v=(t-BIRD_T0)/(BIRD_T1-BIRD_T0), u=1-Math.pow(1-v,1.6), p=pathAt(BIRD_PATH,u), q=pathAt(BIRD_PATH,u+0.01);
    s.x=p[0]; s.y=p[1]+2.2; s.fly=1; s.wing=(step%2)?1:-1; s.dir=q[0]<p[0]?-1:1;
    s.rot=Math.max(-0.5,Math.min(0.5,(q[1]-p[1])*0.6)); return s;
  }
  s.x=-50; s.y=ground(-50)+2.2; s.dir=1; const k=(step+5)%19; s.peck=k<2?1:0; if(k===10) s.y+=0.9; return s;
}
const STR_N=15, POP0=16.5, POP1=18.0, RESEW0=20.25, RESEW_DT=0.25, LOOSE_N=13;
function kiteState(t){
  const tt=Math.max(t,7.1), g=gust(tt);
  const hx=-4+2.2*Math.sin(tt*1.1)-1.6*g, hy=32+1.5*Math.sin(tt*1.7+1)+1.2*g;
  let d=0;
  if(tt>POP0) d = tt<RESEW0 ? ss(POP0,18.7,tt) : 1-ss(RESEW0,RESEW0+LOOSE_N*RESEW_DT,tt);
  const lx=-27+2.6*Math.sin(tt*2.1), ly=42+2.0*Math.sin(tt*2.9);
  let m=0;
  if(tt>=POP0 && tt<POP1) m=Math.min(LOOSE_N,Math.floor((tt-POP0)/(POP1-POP0)*LOOSE_N)+1);
  else if(tt>=POP1 && tt<RESEW0) m=LOOSE_N;
  else if(tt>=RESEW0) m=Math.max(0,LOOSE_N-(Math.floor((tt-RESEW0)/RESEW_DT)+1));
  return {x:lerp(hx,lx,d), y:lerp(hy,ly,d), hx, hy, d, m,
    ang:0.36+0.10*Math.sin(tt*2.3)+d*(0.28+0.45*Math.sin(tt*4.1)), hang:0.36+0.10*Math.sin(tt*2.3)};
}
const CHILD_X=38;
function childState(t){
  const tt=Math.max(t,5.6), k=kiteState(tt);
  const jump = (tt>18.2&&tt<20.2) ? 1.7*Math.abs(Math.sin((tt-18.2)*TAU*1.0)) : 0;
  const gy=ground(CHILD_X)+0.5+jump;
  const up=k.d;
  const hand=[CHILD_X-6.6+1.2*up+0.4*Math.sin(tt*2.3), gy+20.6+4.6*up+0.5*Math.sin(tt*1.7+1)];
  return {gy,hand,up,t:tt,jump};
}
function kiteAttach(k,home){
  const a=home?k.hang:k.ang, x=home?k.hx:k.x, y=home?k.hy:k.y;
  return [x+Math.sin(a)*1.5, y-Math.cos(a)*1.5];
}

// ------------------------------------------------------------------ figures
function drawGround(S,t){
  const pts=[]; for(let x=-57;x<=57;x+=3) pts.push([x,ground(x)]);
  S.chain(1,pts,C.g3,{len:2.5,wd:1.2,w:0.55});
  if(S.pen) return;
  const far=[]; for(let x=-60;x<=-6;x+=4) far.push([x,-20+5*Math.sin((x+62)*0.045)]);
  S.stem(1,far,C.g4,{gap:1,len:2.4,w:0.5,j:0.05});
  const far2=[]; for(let x=14;x<=62;x+=4) far2.push([x,-22+3.5*Math.sin((x-6)*0.05)]);
  S.stem(1,far2,C.g4,{gap:1,len:2.4,w:0.5,j:0.05});
  // seed stitches and knots in the field
  const cols=[C.g1,C.g2,C.g3,C.g4,C.olive,C.brown];
  for(let i=0;i<95;i++){
    const x=(hsh(i*3+1)-0.5)*118, gy=ground(x), y=gy-2.5-hsh(i*3+2)*26;
    if(x*x+y*y>61*61) continue;
    const a=(hsh(i*3+3)-0.5)*1.2, l=0.9+hsh(i*5)*0.9;
    S.st(1,x-Math.cos(a)*l,y-Math.sin(a)*l,x+Math.cos(a)*l,y+Math.sin(a)*l,0.6,cols[i%6],{type:1,j:0});
  }
  const kc=[C.white,C.pink,C.gold,C.white,C.lav];
  for(let i=0;i<16;i++){
    const x=(hsh(i*11+500)-0.5)*104, y=ground(x)-4-hsh(i*11+501)*20;
    if(x*x+y*y>60*60) continue;
    S.knot(1,x,y,0.75,kc[i%5]);
  }
  // a few daisies already worked into the field
  const tt=Math.max(t,1.6), fl=[[-31,-46,C.pink,0.2],[-8,-41,C.lav,0.9],[14,-50,C.coral,0.5],[34,-40,C.mustard,1.3],[-46,-36,C.blue,0.7]];
  for(const f of fl){
    const sw=-(0.2+windAt(f[0],tt))*0.8*(0.6+0.4*Math.sin(tt*7+f[0])), cx=f[0], cy=f[1];
    S.st(1,cx+1.2,cy-8.5,cx+0.6+sw*0.4,cy-4.2,0.65,C.g1,{type:1,j:0});
    S.st(1,cx+0.6+sw*0.4,cy-4.6,cx+sw,cy-0.7,0.65,C.g1,{type:1,j:0});
    S.daisy(1,cx+0.8+sw*0.3,cy-5.6,f[3]>0.8?2.5:0.6,3.2,1.1,C.g2);
    for(let k=0;k<6;k++) S.daisy(1,cx+sw,cy,f[3]+k*TAU/6,3.5,1.4,f[2],{w:0.65});
    S.knot(1,cx+sw,cy,1.05,f[2]===C.mustard?C.dark:C.gold);
  }
}
function drawGrass(S,t,front){
  const tt=Math.max(t,1.6), n=front?50:92, g=front?6:1, cols=front?[C.g2,C.g4,C.g1,C.g2,C.olive]:[C.g1,C.g3,C.g5,C.g2,C.g3];
  for(let i=0;i<n;i++){
    const k=i*7+(front?900:100);
    const x=-56.5+113*(i+hsh(k)*1.6-0.3)/n;
    const tall=(Math.abs(x)>46 && !front) ? 1.75 : (hsh(k+3)>0.88?1.5:1);
    const h=(front?2.2+hsh(k+1)*4.2:3.6+hsh(k+2)*6.6)*tall;
    const by=ground(x)-(front?0.8+hsh(k+4)*2.6:0.2);
    const lean=(hsh(k+5)-0.5)*0.9;
    const wv=windAt(x,tt), fl=Math.sin(tt*7.5+x*0.35+i*1.7)*0.5+0.5;
    const bend=-(0.08+0.78*wv)*(0.45+0.55*fl)*(0.6+0.8*hsh(k+6))+lean;
    const kk=0.38+0.3*hsh(k+7);
    const tx=x+bend*h*0.95, ty=by+h*(1-0.22*bend*bend);
    const c=cols[Math.floor(hsh(k+8)*cols.length)];
    if(hsh(k+9)<0.38){ S.st(g,x,by,tx,ty,0.58,c,{type:1,j:0.05}); }
    else {
      const mx=x+bend*h*kk*0.55, my=by+h*kk;
      S.st(g,x,by,mx,my,0.6,c,{type:1,j:0.05});
      S.st(g,mx-(mx-x)*0.2,my-0.5,tx,ty,0.55,c,{type:1,j:0.05});
    }
    if(!front && i%10===4){ S.knot(g,tx,ty+0.3,0.72,i%3?C.gold:C.white); }
  }
}
function drawCloud(S,t,cx,cy,sc,sp){
  const tt=Math.max(t,SEW_END), x=cx-(tt-SEW_END)*sp, B=[[-11,-3],[11,-3],[12.4,-1],[11.6,1.6],[9,2.9],[7,2.3],[5.4,4.6],[2.4,6.1],[-0.6,5.2],[-2.1,3.5],[-4.6,4.3],[-7.1,3.6],[-8.6,1.6],[-11.2,1],[-12.5,-1]];
  const poly=B.map(p=>[x+p[0]*sc,cy+p[1]*sc]);
  S.fill(1,poly,0.04,(px,py)=>hsh(Math.floor(py*3.1)+Math.floor(px*0.4)*17)>0.8?C.blueL:C.white,{pitch:0.6,maxLen:5.5,j:0.25});
  S.stem(2,[[x-11.5*sc,cy-3.3*sc],[x-4*sc,cy-3.5*sc],[x+4*sc,cy-3.5*sc],[x+11.5*sc,cy-3.3*sc]],C.blueL,{len:2.6,w:0.55});
}
function drawSun(S,t){
  const tt=Math.max(t,7.6), k=Math.floor(tt*12/6+1e-4), cx=33, cy=36;
  S.fill(1,ellipse(cx,cy,6.5,6.5,0,22),0.6,C.sun,{pitch:0.58});
  const ring=ellipse(cx,cy,7.7,7.7,0.2,26); ring.push(ring[0]);
  S.chain(2,ring,C.orange,{len:2.1,wd:1.05,w:0.5});
  const rot=k*TAU/28;
  for(let i=0;i<14;i++){
    const a=i*TAU/14+rot, long=((i+k)%2)===0, r0=10, r1=long?15.6:12.8, dx=Math.cos(a), dy=Math.sin(a);
    for(let j=-1;j<=1;j++){
      const ox=-dy*j*0.6, oy=dx*j*0.6, rr=r1-Math.abs(j)*1.1;
      S.st(2,cx+dx*r0+ox,cy+dy*r0+oy,cx+dx*rr+ox,cy+dy*rr+oy,0.7,j===0?C.gold:C.orange,{j:0.08});
    }
  }
  S.tail(7,cx+9,cy-9,-0.9,5.5,C.orange,1.6+0.5*Math.sin(tt*3));
}

function drawFox(S,st,t){
  const gy=ground(st.x)+0.7, bob=st.mov*0.55*Math.cos(2*TAU*st.phase);
  const P=(x,y)=>[st.x+st.dir*x, gy+y], B=(x,y)=>[st.x+st.dir*x, gy+y+bob];
  const leg=(g,hx,ph,far)=>{
    const th=st.mov*0.30*Math.sin(TAU*ph)+(1-st.mov)*(far?-0.05:0.05);
    const lf=st.mov*Math.max(0,Math.cos(TAU*ph))*2.3;
    const hip=[hx,9.6+bob], foot=[hx+9.2*Math.sin(th), lf+0.2];
    const dx=foot[0]-hip[0], dy=foot[1]-hip[1], d=Math.min(Math.hypot(dx,dy),9.55), l=4.8;
    const kb=Math.sqrt(Math.max(l*l-d*d/4,0)), mx=(hip[0]+foot[0])/2, my=(hip[1]+foot[1])/2;
    // the joint bends toward the tail
    const k2=[mx+(dy/d)*kb, my-(dx/d)*kb];
    const pts=curve([P(hip[0],hip[1]),P(k2[0],k2[1]),P(foot[0],foot[1])],5);
    const cu=far?C.rustD:C.rust;
    S.column(g,pts,u=>3.1-1.5*u,u=>u>0.55?C.dark:cu,{slant:0.25*st.dir});
    const f=P(foot[0],foot[1]+0.25), f2=P(foot[0]+1.9,foot[1]+0.25);
    S.st(g,f[0],f[1],f2[0],f2[1],1.0,C.dark,{j:0.05});
  };
  leg(3,7.6,st.phase+0.5,true); leg(3,-8.6,st.phase,true);
  // tail
  const sw=st.tailS;
  const tl=curve([B(-9.5,12.6),B(-15,11.6+sw*0.5),B(-21.5,12.4+sw*1.7),B(-27,15.5+sw*3.0)],6);
  S.column(3,tl,u=>u<0.5?2.8+4.6*Math.sin(u*Math.PI):Math.max(0.5,7.4*Math.sin(Math.min(1,(1.03-u)*2)*Math.PI/2)),
    u=>u>0.72?C.white:(u>0.66?C.rustL:C.rust),{slant:-0.75*st.dir});
  // body
  const sp=curve([B(-11.5,12.3),B(-5,12.7),B(2,12.4),B(9.8,13.3)],6);
  S.column(4,sp,u=>(6.9-1.0*Math.sin(u*Math.PI)+0.9*u)*Math.sqrt(Math.min(1,u/0.07,(1-u)/0.05)),u=>hsh(Math.floor(u*90)+7)>0.86?C.rustL:C.rust,{slant:0.6*st.dir});
  // chest bib
  S.column(4,curve([B(10.2,15.6),B(9.6,12),B(7.6,8.9)],4),u=>3.4*Math.sin(Math.PI*(0.15+0.8*u)),C.white,{slant:-0.4*st.dir});
  // near legs
  leg(5,7.6,st.phase,false); leg(5,-8.6,st.phase+0.5,false);
  // neck and head
  const hp=[12.4,17.4+bob], ha=st.headA, ca=Math.cos(ha), sa=Math.sin(ha);
  const Hd=(x,y)=>P(hp[0]+x*ca-y*sa, hp[1]+x*sa+y*ca);
  S.column(4,[B(7.4,13.6),B(12.6,17.2)],u=>6.2-0.8*u,C.rust,{slant:0.3*st.dir});
  const dirAng=(a)=>st.dir>0?a:Math.PI-a;
  const earF=[Hd(-1.9,3.0),Hd(-1.2,8.6),Hd(1.9,3.9)], earN=[Hd(0.6,3.7),Hd(2.6,9.3),Hd(4.6,2.8)];
  const tip=(e)=>[[lerp(e[0][0],e[1][0],0.58),lerp(e[0][1],e[1][1],0.58)],e[1],[lerp(e[2][0],e[1][0],0.58),lerp(e[2][1],e[1][1],0.58)]];
  S.fill(4,earF,dirAng(ha+1.35),C.rustD,{pitch:0.55}); S.fill(4,tip(earF),dirAng(ha+1.35),C.dark,{pitch:0.55});
  S.fill(5,[Hd(-2.7,2.6),Hd(0.4,4.3),Hd(4.2,2.7),Hd(9.6,-1.0),Hd(10.8,-2.2),Hd(9.3,-3.6),Hd(3.2,-4.7),Hd(-2.4,-3.2)],dirAng(ha-0.38),C.rust,{pitch:0.55});
  S.fill(5,[Hd(10.8,-2.2),Hd(9.3,-3.6),Hd(3.2,-4.7),Hd(0.2,-3.6),Hd(4.6,-1.7),Hd(8.6,-1.6)],dirAng(ha-0.12),C.white,{pitch:0.55});
  S.fill(5,earN,dirAng(ha+1.2),C.rust,{pitch:0.55}); S.fill(5,tip(earN),dirAng(ha+1.2),C.dark,{pitch:0.55});
  const ey=Hd(4.7,0.7), ns=Hd(10.7,-2.3);
  S.knot(5,ey[0],ey[1],0.62,C.dark); S.knot(5,ns[0],ns[1],0.78,C.dark);
  // chain-stitch outline along the back, stem stitch under the belly
  S.chain(5,curve([B(-10.5,15.9),B(-4,16.2),B(3,16.0),B(8.4,16.8)],5),C.rustD,{len:2.2,wd:1.0,w:0.48});
  S.stem(5,curve([B(-9,8.9),B(-2,8.5),B(5.5,8.7)],4),C.rustD,{len:2.4,w:0.55});
}

function drawBird(S,b){
  const sc=1.25, cr=Math.cos(b.rot+(b.peck?-0.75:0)), sr=Math.sin(b.rot+(b.peck?-0.75:0));
  const P=(x,y)=>{ const yy=y+1.4, X=x*cr-yy*sr, Y=x*sr+yy*cr-1.4; return [b.x+b.dir*X*sc, b.y+Y*sc-1.2]; };
  const A=(a)=>{ const r=a+b.rot+(b.peck?-0.75:0); return b.dir>0?r:Math.PI-r; };
  const poly=(e)=>e.map(p=>P(p[0],p[1]));
  if(!b.fly){
    let p=P(-0.7,1.0), q=P(-1.0,-1.5); S.st(3,p[0],p[1],b.x+b.dir*-1.0*sc,b.y-1.5*sc-1.2,0.45,C.orange,{type:1,j:0.03});
    p=P(0.8,1.0); S.st(3,p[0],p[1],b.x+b.dir*1.1*sc,b.y-1.5*sc-1.2,0.45,C.orange,{type:1,j:0.03});
  } else {
    // far wing
    const w0=P(0.6,4.6), w1=P(-1.0,4.6-b.wing*5.2);
    S.column(3,[w0,[(w0[0]+w1[0])/2-b.dir*1.2,(w0[1]+w1[1])/2],w1],u=>2.6-1.8*u,C.blueL,{slant:0.5,pitch:0.52});
  }
  for(let k=-1;k<=1;k++){ const p=P(-3.0,3.4), q=P(-7.6,3.4+k*1.2-(b.fly?0.4:0)); S.st(3,p[0],p[1],q[0],q[1],0.75,C.blueD,{j:0.05}); }
  S.fill(4,poly(ellipse(0,3.4,3.9,2.8,0.25,14)),A(0.5),C.blue,{pitch:0.52});
  S.fill(4,poly(ellipse(3.1,6.2,2.15,2.15,0,12)),A(1.15),C.blue,{pitch:0.52});
  S.fill(5,poly(ellipse(1.0,2.5,2.5,1.5,0.25,10)),A(0.2),C.cream,{pitch:0.52});
  let p=P(4.9,6.6), q=P(7.2,6.0); S.st(5,p[0],p[1],q[0],q[1],0.7,C.orange,{j:0.03});
  p=P(4.9,5.8); S.st(5,p[0],p[1],q[0],q[1],0.7,C.orange,{j:0.03});
  p=P(3.7,6.8); S.knot(5,p[0],p[1],0.42,C.dark);
  const w0=P(1.3,4.7), w1=b.fly?P(-1.2,4.7+b.wing*5.6):P(-3.8,3.3);
  S.column(5,[w0,[(w0[0]+w1[0])/2-b.dir*(b.fly?1.4:0),(w0[1]+w1[1])/2+(b.fly?0:0.5)],w1],u=>2.9-1.9*u,C.blueD,{slant:0.55,pitch:0.52});
}

function drawChild(S,c){
  const bx=CHILD_X, gy=c.gy, t=c.t, P=(x,y)=>[bx+x,gy+y], w=gust(t);
  const kick=c.jump>0.4?0.8:0;
  S.column(3,[P(-1.7,9.2),P(-2.0-kick,1.3)],u=>2.5,C.navy,{slant:0.2});
  S.column(3,[P(1.7,9.2),P(2.1+kick,1.3)],u=>2.5,C.navy,{slant:-0.2});
  S.st(3,bx-3.9-kick,gy+0.7,bx-0.7-kick,gy+0.7,1.3,C.dark,{j:0.05}); S.st(3,bx+0.3+kick,gy+0.7,bx+3.5+kick,gy+0.7,1.3,C.dark,{j:0.05});
  // far arm
  const fa=c.up>0.3 ? [P(2.4,16.8),P(4.6,19.5),P(4.0,23.5+c.up)] : [P(2.6,16.8),P(4.6,13.8),P(5.0,10.8)];
  S.column(3,curve(fa,4),u=>2.0,C.tealD,{slant:0.2});
  S.knot(3,fa[2][0],fa[2][1],0.8,C.skin);
  // coat
  S.column(4,[P(0,8.4),P(0,17.8)],u=>(9.0-3.6*u)*Math.sqrt(Math.min(1,(1-u)/0.06+0.5)),u=>C.teal,{slant:0.22,pitch:0.58});
  S.st(5,bx-0.2,gy+16.4,bx-0.2,gy+9.4,0.5,C.tealD,{type:1,j:0.05});
  for(let k=0;k<3;k++) S.knot(5,bx-0.2,gy+15.2-k*2.2,0.42,C.cream);
  // head
  const hx=bx-0.4, hy=gy+21.9;
  S.fill(4,ellipse(hx,hy,3.75,3.75,0,18),0.12,C.skin,{pitch:0.55});
  const hair=[]; for(let i=0;i<=10;i++){ const a=-0.55+i/10*3.3; hair.push([hx+Math.cos(a)*4.1,hy+Math.sin(a)*4.1]); }
  for(let i=10;i>=0;i--){ const a=-0.55+i/10*3.3; hair.push([hx+Math.cos(a)*(i<3?1.2:2.2)+1.0,hy+Math.sin(a)*2.0+0.8]); }
  S.fill(5,hair,-0.7,C.hair,{pitch:0.52});
  for(let k=0;k<3;k++){ const f=Math.sin(t*9+k*2)*0.8*(0.4+w); S.st(5,hx+0.5-k*0.9,hy+3.7-k*0.25,hx-3.4-k*0.5-w*1.4,hy+4.4-k*0.8+f,0.5,C.hair,{type:1,j:0.05}); }
  S.knot(5,hx-1.9,hy+0.5,0.36,C.dark);
  S.st(5,hx-2.9,hy-1.1,hx-1.3,hy-1.5,0.42,C.red,{type:1,j:0.03});
  S.st(5,hx-0.9,hy-0.4,hx+0.1,hy-0.6,0.5,C.pink,{j:0.03});
  // scarf
  S.st(5,bx-2.9,gy+17.9,bx+2.7,gy+18.3,1.3,C.mustard,{j:0.05}); S.st(5,bx-2.8,gy+18.7,bx+2.6,gy+19.0,1.3,C.mustard,{j:0.05});
  const f1=Math.sin(t*10)*0.9*(0.4+w), f2=Math.sin(t*10-1.3)*1.5*(0.4+w);
  S.column(5,curve([P(-2.2,17.9),P(-4.6,16.2+f1),P(-7.6,14.6+f2+w*1.6)],5),u=>2.0-0.5*u,u=>(Math.floor(u*5)%2)?C.red:C.mustard,{slant:0.3});
  S.column(5,curve([P(-1.6,17.6),P(-3.0,14.8+f2*0.6),P(-5.0,12.4+f1+w)],5),u=>1.9-0.5*u,u=>(Math.floor(u*4)%2)?C.mustard:C.red,{slant:0.3});
  // near arm, holding the string
  const sh=P(-2.3,16.8), hd=c.hand, mx=(sh[0]+hd[0])/2+0.9, my=(sh[1]+hd[1])/2-1.3;
  S.column(5,curve([sh,[mx,my],hd],5),u=>2.2-0.3*u,C.teal,{slant:0.2});
  S.knot(5,hd[0],hd[1],0.85,C.skin);
}

function drawKite(S,k,t,home){
  const a=home?k.hang:k.ang, kx=home?k.hx:k.x, ky=home?k.hy:k.y, ca=Math.cos(a), sa=Math.sin(a);
  const P=(x,y)=>[kx+x*ca-y*sa, ky+x*sa+y*ca];
  const T=P(0,12), R=P(7.6,2.6), Bm=P(0,-12), Lf=P(-7.6,2.6), Cc=P(0,2.6);
  S.fill(4,[T,Cc,Lf],a+0.9,C.red,{pitch:0.56});
  S.fill(4,[T,R,Cc],a-0.9,C.cream,{pitch:0.56});
  S.fill(4,[Cc,R,Bm],a+1.15,C.red,{pitch:0.56});
  S.fill(4,[Lf,Cc,Bm],a-1.15,C.cream,{pitch:0.56});
  if(S.pen) return;
  S.st(5,T[0],T[1],Bm[0],Bm[1],0.5,C.brown,{type:1,j:0.04}); S.st(5,Lf[0],Lf[1],R[0],R[1],0.5,C.brown,{type:1,j:0.04});
  S.chain(5,[T,R,Bm,Lf,T],C.navy,{len:2.1,wd:1.0,w:0.48});
  // tail with bows, streaming downwind
  const w=gust(t), pts=[Bm]; const dx=-(0.30+0.32*w), dy=-0.9;
  for(let i=1;i<=7;i++){ const s=i*3.3, wv=Math.sin(i*1.25-t*9.5)*(0.5+0.28*i)*(0.5+w); pts.push([Bm[0]+dx*s+wv*0.9, Bm[1]+dy*s*0.92+wv*0.42]); }
  S.loose(6,pts,0.5,C.navy,0.45);
  const bc=[C.mustard,C.teal,C.red];
  for(let i=0;i<3;i++){ const p=pts[2+i*2], q=pts[3+i*2], an=Math.atan2(q[1]-p[1],q[0]-p[0])+Math.PI/2; S.daisy(6,p[0],p[1],an,2.5,1.0,bc[i]); S.daisy(6,p[0],p[1],an+Math.PI,2.5,1.0,bc[i]); }
}
function drawString(S,k,c,t){
  const A=kiteAttach(k,true), H=c.hand;
  const mx=(H[0]+A[0])/2+1.5, my=(H[1]+A[1])/2-3.2;
  const pts=[]; for(let i=0;i<=20;i++){ const u=i/20; pts.push([(1-u)*(1-u)*H[0]+2*u*(1-u)*mx+u*u*A[0], (1-u)*(1-u)*H[1]+2*u*(1-u)*my+u*u*A[1]]); }
  if(S.pen){ S.outline(resample(pts,4),false); return null; }
  const rs=resample(pts,1); const n=rs.length-1; const held=STR_N-k.m;
  const at=(i)=>rs[Math.round(i/STR_N*n)];
  for(let i=0;i<held;i++){
    const p=at(i), q=at(i+1);
    const resewn=(t>=RESEW0 && i>=STR_N-LOOSE_N);
    S.st(5,p[0],p[1],q[0]+(q[0]-p[0])*0.06,q[1]+(q[1]-p[1])*0.06,0.6,C.string,{type:1,j:0.06,birth:resewn?RESEW0+(i-(STR_N-LOOSE_N))*RESEW_DT:undefined,dur:0.21});
  }
  for(let i=held;i<=STR_N;i++){ const p=at(i); S.raw(0,p[0]-0.22,p[1],p[0],p[1],p[0]+0.22,p[1],0.5,C.dark,3,0); }
  return at(held);
}
function drawLooseString(S,k,from,t){
  if(k.m<=0) return;
  const A=kiteAttach(k,false), dx=A[0]-from[0], dy=A[1]-from[1], d=Math.hypot(dx,dy)||1, len=Math.max(k.m*3.6+2,d*(1.05+0.09*k.d));
  const slack=Math.sqrt(Math.max(len*len-d*d,0))*0.32, nx=-dy/d, ny=dx/d, pts=[];
  for(let i=0;i<=10;i++){ const u=i/10, wv=Math.sin(u*Math.PI)*(slack*(0.55*Math.sin(u*7.5-t*10)+0.3)+0.8*Math.sin(u*16+t*13)); pts.push([from[0]+dx*u+nx*wv, from[1]+dy*u+ny*wv-slack*0.2*Math.sin(u*Math.PI)]); }
  S.loose(7,pts,0.6,C.string,1.0+2.6*k.d);
}

const FLOWER_COLS=['pink','lav','coral','red','mustard','blue'];
function drawFlower(S,f,t,filmT,nowSec){
  const age=nowSec-f.born, P=6, cx=f.x, cy=f.y, col=C[FLOWER_COLS[f.seed%6]];
  const wv=windAt(cx,Math.max(t,1.6)), swx=-(0.2+wv)*0.7*(0.6+0.4*Math.sin(t*7+cx)), dt=0.085;
  let i=0; const bt=()=>({birth:age>3?-100:filmT-age+(i++)*dt, dur:dt});
  let o=bt(); S.st(6,cx+1.4,cy-10.5,cx+0.7+swx*0.4,cy-5.2,0.7,C.g1,{type:1,j:0,birth:o.birth,dur:o.dur});
  o=bt(); S.st(6,cx+0.7+swx*0.4,cy-5.6,cx+swx,cy-0.8,0.7,C.g1,{type:1,j:0,birth:o.birth,dur:o.dur});
  o=bt(); i+=2; S.daisy(6,cx+0.9+swx*0.3,cy-6.6,0.5+(f.seed%2?2.1:0),3.8,1.3,C.g2,{birth:o.birth,dur:dt,w:0.65});
  for(let k=0;k<P;k++){ o=bt(); i+=2; S.daisy(6,cx+swx,cy,f.rot+k*TAU/P,4.3,1.7,col,{birth:o.birth,dur:dt,w:0.72}); }
  i++; const kb=age>3?-100:filmT-age+i*dt;
  S.knot(6,cx+swx,cy,1.25,f.seed%6===4?C.dark:C.gold,{birth:kb,dur:0.14});
  return age < (i+3)*dt+0.2;
}

// Build every stitch for film time t. Figures hold still while they are sewn, then move 12 steps a second.
function buildScene(t,flowers,nowSec){
  const S=new Sew(), tp=Math.min(t,UNRAVEL), tq=Math.floor(tp*12+1e-4)/12, step=Math.round(tq*12);
  // the traced pattern
  S.pen=true;
  drawGround(S,0); drawSun(S,0); drawCloud(S,0,-31,27,1.0,0.45); drawCloud(S,0,6,55,0.62,0.3); drawFox(S,foxState(0),0); drawBird(S,birdState(0));
  const k0=kiteState(0), c0=childState(0);
  drawChild(S,c0); drawKite(S,k0,7.1,true); drawString(S,k0,c0,0);
  S.pen=false;

  S.begin(1,0,1.5,0); drawGround(S,tq); drawGrass(S,tq,false); drawGrass(S,tq,true);
  S.tail(7,-57,ground(-57),2.6,5,C.g3,1.2+0.6*Math.sin(Math.max(tq,1.6)*2.6)); S.end();
  const fs=foxState(tq);
  S.begin(2,1.5,3.5,tq>=SEW_END?step:0); drawFox(S,fs,tq); S.end();
  const bs=birdState(tq);
  S.begin(3,3.5,4.0,tq>=4.2?step:0); drawBird(S,bs); S.end();
  const ks=kiteState(tq), cs=childState(tq);
  S.begin(4,4.0,5.5,tq>=5.6?step:0); drawChild(S,cs); S.end();
  S.begin(5,5.5,6.6,tq>=7.1?step:0); drawKite(S,ks,Math.max(tq,7.1),false); S.end();
  S.begin(6,6.6,7.0,tq>=7.1?step:0); const from=drawString(S,ks,cs,tq); S.end();
  drawLooseString(S,ks,from,tq);
  S.begin(7,7.0,7.5,0); drawSun(S,tq); S.end();
  S.begin(9,7.5,7.95,0); drawCloud(S,tq,-31,27,1.0,0.45); drawCloud(S,tq,6,55,0.62,0.3);
  S.tail(7,-19-(Math.max(tq,8)-8)*0.45,23.6,-0.5,4.5,C.blueL,1.2+0.5*Math.sin(Math.max(tq,8)*2.2)); S.tail(7,57,ground(57),0.5,4.5,C.g3,-1.4-0.5*Math.sin(Math.max(tq,1.6)*2.9)); S.end();
  let anim=false;
  S.begin(8,0,0,step,true);
  for(const f of flowers) anim=drawFlower(S,f,tq,t,nowSec)||anim;
  S.end();
  const out=S.pack(); out.anim=anim; return out;
}
