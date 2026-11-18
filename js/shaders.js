'use strict';
// All GLSL for the film. Units are millimetres; the cloth in the hoop is the plane z = 0.
const SH = {};

SH.common = `#version 300 es
precision highp float;
float hash11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }
const vec3 LCOL = vec3(1.0,0.93,0.82)*2.5;
vec3 ambient(vec3 n){ return mix(vec3(0.34,0.30,0.27), vec3(0.50,0.56,0.66), n.z*0.5+0.5)*0.62; }
`;

SH.fsqVS = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUv;
void main(){ vUv=aP; gl_Position=vec4(aP,0.,1.); }`;

// ---------------------------------------------------------------- background
SH.bgFS = SH.common + `
uniform vec3 uCam,uR,uU,uF,uLight; uniform vec2 uProj; uniform vec3 uNeedle; uniform float uPxK; uniform vec2 uPix;
in vec2 vUv; out vec4 o;
const float HR_IN=75.3, HR_OUT=82.3, HZ0=-9.0, HZ1=1.4;

vec2 rot(vec2 p,float a){ float c=cos(a),s=sin(a); return vec2(c*p.x+s*p.y,-s*p.x+c*p.y); }
float sdBox(vec3 p, vec3 b, float r){ vec3 d=abs(p)-b+r; return length(max(d,0.))+min(max(d.x,max(d.y,d.z)),0.)-r; }
float sdCylX(vec3 p, float r, float h){ vec2 d=vec2(length(p.yz)-r, abs(p.x)-h); return min(max(d.x,d.y),0.)+length(max(d,0.)); }
float sdCylZ(vec3 p, float r, float h){ vec2 d=vec2(length(p.xy)-r, abs(p.z)-h); return min(max(d.x,d.y),0.)+length(max(d,0.)); }

// thread spools standing on the table: xy, colour index
const vec3 SP0=vec3(150.,-38.,0.), SP1=vec3(168.,-12.,1.), SP2=vec3(-158.,44.,2.);
float sdSpool(vec3 p, out float part){
  p.z+=9.0;
  float core=sdCylZ(p-vec3(0,0,11.),8.2,8.5)-0.4;
  float f1=sdCylZ(p-vec3(0,0,1.2),10.5,1.2)-0.3;
  float f2=sdCylZ(p-vec3(0,0,20.8),10.5,1.2)-0.3;
  float hole=sdCylZ(p-vec3(0,0,21.),2.6,3.);
  float fl=max(min(f1,f2),-hole);
  part = core<fl ? 1. : 0.;
  return min(core,fl);
}
bool gClamp=true, gSpool=true; float gNdV=1.;
vec2 mapScene(vec3 p){
  vec2 q=vec2(length(p.xy)-0.5*(HR_IN+HR_OUT), p.z-0.5*(HZ0+HZ1));
  vec2 dd=abs(q)-vec2(0.5*(HR_OUT-HR_IN),0.5*(HZ1-HZ0))+0.9;
  float ring=length(max(dd,0.))+min(max(dd.x,dd.y),0.)-0.9;
  float d=ring, m=0.;
  if(gClamp){
    d=max(d,-sdBox(p-vec3(0.,79.,-3.8),vec3(1.5,6.,7.),0.));
    vec3 b=p-vec3(0.,85.4,-3.8); b.x=abs(b.x)-5.0;
    d=min(d,sdBox(b,vec3(2.7,3.7,4.6),0.9));
    float scr=sdCylX(p-vec3(1.0,86.2,-3.8),1.25,12.5);
    if(scr<d){ d=scr; m=1.; }
    float nut=sdCylX(p-vec3(13.2,86.2,-3.8),3.5,2.0)-0.35;
    if(nut<d){ d=nut; m=2.; }
    float hd=sdCylX(p-vec3(-10.6,86.2,-3.8),2.5,0.9)-0.35;
    if(hd<d){ d=hd; m=1.; }
  }
  if(gSpool){
    float part;
    float s0=sdSpool(p-vec3(SP0.xy,0.),part); if(s0<d){ d=s0; m=3.+part*0.4+SP0.z*0.1; }
    float s1=sdSpool(p-vec3(SP1.xy,0.),part); if(s1<d){ d=s1; m=3.+part*0.4+SP1.z*0.1; }
    float s2=sdSpool(p-vec3(SP2.xy,0.),part); if(s2<d){ d=s2; m=3.+part*0.4+SP2.z*0.1; }
  }
  return vec2(d,m);
}
vec3 sceneN(vec3 p){ vec2 e=vec2(0.04,0.);
  return normalize(vec3(mapScene(p+e.xyy).x-mapScene(p-e.xyy).x, mapScene(p+e.yxy).x-mapScene(p-e.yxy).x, mapScene(p+e.yyx).x-mapScene(p-e.yyx).x)); }

float weaveH(vec2 uv, out float tint){
  vec2 id=floor(uv); vec2 f=fract(uv)-0.5;
  float par=mod(id.x+id.y,2.);
  float tw=0.38+0.09*vnoise(vec2(id.x*3.7, uv.y*0.13));
  float tf=0.38+0.09*vnoise(vec2(uv.x*0.13, id.y*3.7+31.));
  float cw=max(1.-f.x*f.x/(tw*tw),0.), cf=max(1.-f.y*f.y/(tf*tf),0.);
  float sw=0.5+0.5*cos(f.y*6.2832), sf=0.5+0.5*cos(f.x*6.2832);
  float zw=sqrt(cw)*(par<0.5 ? 0.45+0.55*sw : 0.45-0.35*sw);
  float zf=sqrt(cf)*(par<0.5 ? 0.45-0.35*sf : 0.45+0.55*sf);
  tint = zw>zf ? hash11(id.x*1.31+3.) : hash11(id.y*1.73+91.);
  return max(zw,zf);
}
vec3 clothShade(vec2 p, vec3 N0, vec3 P, float sh, float ao, float px){
  const float pitch=0.74;
  vec2 uv=p/pitch; float t0,t1,t2;
  float h=weaveH(uv,t0), hx=weaveH(uv+vec2(.07,0.),t1), hy=weaveH(uv+vec2(0.,.07),t2);
  float rr=px/pitch;
  float fade=1.-smoothstep(0.18,0.33,rr), fade2=(1.-smoothstep(0.42,0.85,rr))*(1.-fade);
  vec2 sc=sin(3.14159*uv), cc=cos(3.14159*uv);
  vec2 g=vec2(hx-h,hy-h)/0.07*0.40*fade+vec2(cc.x*sc.y,sc.x*cc.y)*0.20*fade2;
  vec3 N=normalize(N0+vec3(-g,0.));
  float blot=fbm(p*0.03);
  float slub=smoothstep(0.62,0.9,vnoise(vec2(p.x*0.09,p.y*1.6)))+smoothstep(0.66,0.9,vnoise(vec2(p.x*1.6+40.,p.y*0.09)));
  vec3 alb=vec3(0.76,0.69,0.565)*(0.84+0.24*t0*fade+0.16*(blot-.5)+0.07*slub);
  alb*=mix(0.93+0.05*sc.x*sc.y*fade2, 0.42+0.62*smoothstep(0.0,0.8,h), fade);
  vec3 L=normalize(uLight-P), V=normalize(uCam-P);
  float ndl=max(dot(N,L),0.);
  vec3 col=alb*(ambient(N)*ao+LCOL*ndl*sh);
  col+=LCOL*pow(max(dot(N,normalize(L+V)),0.),14.)*0.035*sh;
  return col;
}
float outsideH(vec2 p){
  float r=length(p), a=atan(p.y,p.x);
  float folds=sin(a*7.+vnoise(p*0.018)*7.)*exp(-max(r-82.,0.)/34.)*1.3;
  return folds+(vnoise(p*0.022+7.)+0.5*vnoise(p*0.047+3.)-0.75)*3.2+(vnoise(p*0.09)-0.5)*0.7;
}
vec3 tableShade(vec2 p, vec3 P, float sh, float ao){
  vec2 q=rot(p,-0.10);
  float plank=floor(q.y/78.), fy=fract(q.y/78.);
  float off=hash11(plank+2.)*400.;
  vec2 g=vec2((q.x+off)*0.010, q.y*0.09+plank*3.);
  float n=fbm(g*3.);
  float rings=0.5+0.5*sin(q.y*0.42+n*10.+fbm(vec2((q.x+off)*0.004,plank*5.))*22.);
  float fine=vnoise(vec2((q.x+off)*0.11, q.y*5.));
  vec3 alb=mix(vec3(0.075,0.043,0.026), vec3(0.20,0.118,0.066), rings*0.55+n*0.55);
  float pores=smoothstep(0.55,0.85,vnoise(vec2((q.x+off)*0.35, q.y*17.)));
  alb*=(0.82+0.34*fine)*(0.86+0.28*hash11(plank+9.))*(1.-0.38*pores);
  float seam=smoothstep(0.0,0.010,fy)*smoothstep(1.,0.990,fy); alb*=mix(0.3,1.,seam);
  vec3 N=normalize(vec3((fine-0.5)*0.08,(rings-0.5)*0.10,1.));
  vec3 L=normalize(uLight-P), V=normalize(uCam-P);
  vec3 col=alb*(ambient(N)*ao+LCOL*max(dot(N,L),0.)*sh);
  col+=LCOL*pow(max(dot(N,normalize(L+V)),0.),40.)*0.10*sh*(0.5+fine);
  return col;
}
// soft shadow of an upright cylinder (radius R, top height zt) on a point P
float cylShadow(vec3 P, vec2 c, float R, float zt, float k){
  vec3 L=normalize(uLight-P); vec2 dir=L.xy/L.z; float H=max(zt-P.z,0.);
  vec2 a=P.xy-c, ab=dir*H; float tt=clamp(dot(-a,ab)/max(dot(ab,ab),1e-4),0.,1.);
  float d=length(a+ab*tt)-R; float soft=0.5+tt*H*k;
  return smoothstep(-soft,soft,d);
}
float cylAO(vec3 P, vec2 c, float R){ return 1.-0.5*exp(-max(length(P.xy-c)-R,0.)/4.0); }

vec3 threadCol(float i){ return i<0.5 ? vec3(0.50,0.085,0.02) : (i<1.5 ? vec3(0.03,0.19,0.24) : vec3(0.72,0.40,0.03)); }
vec3 shadeObj(vec3 p, vec3 rd, float m){
  vec3 N=sceneN(p), L=normalize(uLight-p), V=-rd, H=normalize(L+V);
  gNdV=dot(N,V);
  vec3 alb, spc=vec3(0.06); float gloss=22.;
  float ao=mix(0.5,1.,smoothstep(-9.,-4.,p.z));
  if(m<0.5){
    float ang=atan(p.y,p.x), rr=length(p.xy);
    bool blk=p.y>82.6 && abs(p.x)<9.;
    vec2 g=blk ? vec2(p.y*0.10, p.x*1.2+p.z*0.8) : vec2(ang*79.*0.03, rr*0.9+p.z*0.8);
    float n=fbm(g*2.), st=vnoise(vec2(g.x*10., g.y*13.));
    float pore=smoothstep(0.60,0.82,vnoise(vec2(g.x*5., g.y*46.)))*0.5+smoothstep(0.55,0.9,vnoise(vec2(g.x*1.3, g.y*19.+7.)))*0.35;
    alb=mix(vec3(0.34,0.185,0.07), vec3(0.64,0.41,0.185), n*0.75+0.2)*(0.86+0.28*st)*(1.-0.42*pore);
    gloss=34.; spc=vec3(0.11);
  } else if(m<2.5){
    alb=vec3(0.03,0.02,0.01); spc=vec3(0.95,0.68,0.30); gloss=70.;
    if(m>1.5){ float a=atan(p.z+3.8,p.y-86.2); N=normalize(N+0.4*sin(a*24.)*cross(vec3(1,0,0),N)); }
    else if(abs(p.x)<9.5) N=normalize(N+vec3(0.55*sin(p.x*8.),0.,0.));
    vec3 rf=reflect(rd,N);
    alb+=spc*mix(vec3(0.10,0.07,0.05), vec3(0.95,0.88,0.80), smoothstep(-0.3,0.9,rf.z))*0.55;
  } else {
    float part, idx;
    // m = 3 + part*0.4 + idx*0.1
    float mm=m-3.; part = mm>=0.39 ? 1. : 0.; idx=floor((mm-part*0.4)*10.+0.5);
    if(part>0.5){ // wound thread
      alb=threadCol(idx); float wz=p.z*1.9+atan(p.y,p.x)*0.16; float wd=sin(wz*6.2832);
      N=normalize(N+vec3(0.,0.,wd*0.55)); alb*=0.75+0.25*(0.5+0.5*wd);
      vec3 T=normalize(vec3(-N.y,N.x,0.15)); float th=dot(T,H);
      spc=mix(alb,vec3(1.),0.4)*0.0; alb+=mix(alb,vec3(1.),0.35)*pow(sqrt(max(1.-th*th,0.)),40.)*0.5*max(dot(N,L),0.);
      ao=mix(0.6,1.,smoothstep(-9.,1.,p.z));
    } else {
      float n=fbm(vec2(length(p.xy)*0.6, atan(p.y,p.x)*3.)); alb=mix(vec3(0.50,0.33,0.17),vec3(0.72,0.53,0.31),n);
      ao=mix(0.55,1.,smoothstep(-9.,-6.,p.z)); gloss=30.; spc=vec3(0.09);
    }
  }
  float ndl=max(dot(N,L),0.);
  vec3 col=alb*(ambient(N)+LCOL*ndl)*ao;
  col+=spc*LCOL*pow(max(dot(N,H),0.),gloss)*(m>0.5&&m<2.5?1.6:0.5)*step(0.,dot(N,L));
  return col;
}

vec3 render(vec2 uvp, out bool near){
  vec3 rd=normalize(uF+uvp.x*uProj.x*uR+uvp.y*uProj.y*uU), ro=uCam;
  float tA=(13.5-ro.z)/rd.z, tB=(-9.-ro.z)/rd.z;
  vec2 pa=ro.xy+rd.xy*tA, pb=ro.xy+rd.xy*tB;
  float ra=length(pa), rb=length(pb);
  bool hit=false; vec2 hm=vec2(0.); vec3 hp=vec3(0.); float tH=1e9;
  bool inClamp=(abs(pa.x)<19. && pa.y>74. && pa.y<96.) || (abs(pb.x)<19. && pb.y>74. && pb.y<96.);
  bool nearHoop=!(max(ra,rb)<73.) && (min(ra,rb)<85.5 || inClamp);
  bool nearSpool=min(min(length(pb-SP0.xy),length(pa-SP0.xy)),min(min(length(pb-SP1.xy),length(pa-SP1.xy)),min(length(pb-SP2.xy),length(pa-SP2.xy))))<13.;
  near=false; gClamp=inClamp; gSpool=nearSpool; gNdV=1.;
  if(nearHoop||nearSpool){
    float t=tA, minRel=1e9;
    for(int i=0;i<56;i++){ hp=ro+rd*t; hm=mapScene(hp); if(hm.x<0.015){ hit=true; break; } minRel=min(minRel,hm.x/(t*uPxK)); t+=hm.x; if(t>tB) break; }
    if(hit) tH=t; else near=minRel<1.6;
  }
  float t0=-ro.z/rd.z; vec2 p0=ro.xy+rd.xy*t0; float r0=length(p0);
  vec3 col;
  if(hit && !(r0<HR_IN && t0<tH)){
    col=shadeObj(hp,rd,hm.y);
    near=gNdV<0.42;
  } else if(r0<HR_IN+0.1){
    vec3 P=vec3(p0,0.);
    vec2 rad=p0/max(r0,1e-3);
    float k=smoothstep(72.4,75.3,r0);
    vec3 N0=normalize(vec3(rad*k*1.3,1.));
    vec3 L=normalize(uLight-P);
    float sh=smoothstep(HR_IN-0.9,HR_IN+0.5,length(p0+L.xy/L.z*1.4));
    sh=mix(1.,0.35,sh);
    float ao=1.-0.35*smoothstep(73.6,75.3,r0);
    // the unseen needle presses a small dent into the cloth
    vec2 dn=p0-uNeedle.xy; float dl=length(dn);
    float dent=uNeedle.z*exp(-dl*dl/2.2);
    N0=normalize(N0+vec3(-dn/max(dl,0.05)*dent*min(dl,1.)*0.9,0.));
    col=clothShade(p0,N0,P,sh,ao,t0*uPxK/max(abs(rd.z),0.3))*(1.-0.30*dent*exp(-dl*dl/0.5));
  } else {
    float tp=(-8.7-ro.z)/rd.z; vec3 P=ro+rd*tp; vec2 p=P.xy;
    float sh=cylShadow(P,vec2(0.),HR_OUT,HZ1,0.20);
    sh=min(sh,cylShadow(P,SP0.xy,10.6,13.,0.2)); sh=min(sh,cylShadow(P,SP1.xy,10.6,13.,0.2)); sh=min(sh,cylShadow(P,SP2.xy,10.6,13.,0.2));
    float ao=cylAO(P,vec2(0.),HR_OUT)*cylAO(P,SP0.xy,10.5)*cylAO(P,SP1.xy,10.5)*cylAO(P,SP2.xy,10.5);
    vec2 q=rot(p-vec2(5.,-4.),0.06);
    vec2 e=abs(q)-vec2(126.,108.);
    float edge=(fbm(q*0.06)-0.5)*2.4;
    float d=length(max(e,0.))+min(max(e.x,e.y),0.)+edge;
    if(d<0.){
      float h=outsideH(p), hx=outsideH(p+vec2(1.2,0.)), hy=outsideH(p+vec2(0.,1.2));
      vec3 N0=normalize(vec3(-(hx-h)/1.2*0.55,-(hy-h)/1.2*0.55,1.));
      ao*=0.80+0.20*smoothstep(-1.6,1.6,h);
      col=clothShade(q,N0,P,sh,ao,tp*uPxK/max(abs(rd.z),0.3));
      col*=0.90+0.10*smoothstep(0.,4.,-d);
    } else {
      // shadow of the cloth edge on the table, then loose fringe threads
      vec3 L=normalize(uLight-P);
      vec2 qs=rot(p+L.xy/L.z*1.2-vec2(5.,-4.),0.06); vec2 es=abs(qs)-vec2(126.,108.);
      float ds=length(max(es,0.))+min(max(es.x,es.y),0.)+edge;
      float csh=mix(0.45,1.,smoothstep(-0.8,1.4,ds));
      col=tableShade(p,P,min(sh,csh),ao*(0.72+0.28*smoothstep(0.,5.,d)));
      float outd=max(e.x,e.y);
      if(outd<7.5 && min(e.x,e.y)<0.){
        float along=e.x>e.y ? q.y : q.x;
        float idx=floor(along/0.74), f=fract(along/0.74)-0.5;
        float len=1.2+5.5*hash11(idx*1.37+(e.x>e.y?7.:3.));
        float wob=(vnoise(vec2(idx*5.1,outd*0.5))-0.5)*outd*0.5;
        float a=smoothstep(0.36,0.16,abs(f+wob))*step(outd+edge,len)*step(0.4,hash11(idx*3.1));
        vec3 fc=vec3(0.76,0.69,0.565)*(0.75+0.3*hash11(idx))*(ambient(vec3(0,0,1))+LCOL*0.7*sh);
        col=mix(col,fc,a*(1.-smoothstep(0.2,0.5,tp*uPxK/0.74)*0.5));
      }
    }
  }
  return col;
}
void main(){
  bool near, n2;
  vec3 col=render(vUv,near);
  if(near){
    col+=render(vUv+uPix*vec2(0.38,0.12),n2)+render(vUv+uPix*vec2(-0.12,0.38),n2)+render(vUv+uPix*vec2(-0.38,-0.12),n2);
    col*=0.25;
  }
  o=vec4(col,0.);
}`;

// ---------------------------------------------------------------- stitches
SH.stitchVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 iAB;
layout(location=2) in vec4 iCW;
layout(location=3) in vec4 iCol;
layout(location=4) in vec4 iTime;
uniform mat4 uVP; uniform float uT; uniform vec3 uLight; uniform float uShadow;
out float vU; out float vS; out float vLen; out vec3 vP; out vec2 vT; out vec3 vCol;
out float vType; out float vSeed; out float vW; out float vH;
void main(){
  float p=clamp((uT-iTime.x)/max(iTime.y,1e-3),0.,1.)*(1.-clamp((uT-iTime.z)/0.12,0.,1.));
  float type=iCol.a;
  if(p<=0.002 || (uShadow>0.5 && type>2.5)){ gl_Position=vec4(2.,2.,2.,1.); return; }
  vec2 a=iAB.xy, b=iAB.zw, c=iCW.xy; float w=iCW.z, lift=iCW.w;
  float L=0.5*(length(c-a)+length(b-c)+length(b-a));
  float t=aQ.x*p;
  vec2 P=(1.-t)*(1.-t)*a+2.*(1.-t)*t*c+t*t*b;
  vec2 d=(1.-t)*(c-a)+t*(b-c);
  vec2 T=normalize(dot(d,d)>1e-8 ? d : b-a+vec2(1e-4,0.));
  vec2 Nn=vec2(-T.y,T.x);
  float hw=w*0.5;
  float arch=4.*aQ.x*(1.-aQ.x);
  float h=hw+(lift<0. ? -lift : lift*arch);
  vS=t*L; vLen=p*L; vT=T; vCol=iCol.rgb; vType=type; vSeed=iTime.w; vW=w; vH=h;
  if(uShadow>0.5){
    vec3 Ld=normalize(uLight-vec3(P,0.));
    vec2 so=-Ld.xy/Ld.z*h;
    float ext=hw+0.22+0.34*h;
    vec2 q=P+so+Nn*aQ.y*ext;
    vU=aQ.y*ext; vP=vec3(q,0.);
    gl_Position=uVP*vec4(q,0.02,1.);
  } else {
    float ext=hw*1.25+0.06;
    vec2 q=P+Nn*aQ.y*ext;
    vU=aQ.y*ext/hw; vP=vec3(q,h);
    gl_Position=uVP*vec4(q,h,1.);
  }
}`;

SH.shadowFS = `#version 300 es
precision highp float;
in float vU; in float vS; in float vLen; in float vW; in float vH; out vec4 o;
void main(){
  float hw=vW*0.5, blur=0.22+0.34*vH;
  float a=1.-smoothstep(hw-blur*0.7,hw+blur,abs(vU));
  a*=smoothstep(0.,0.5,min(vS,vLen-vS));
  o=vec4(0.,0.,0.,a*0.78/(1.+0.3*max(vH-hw,0.)));
}`;

SH.threadFS = SH.common + `
uniform vec3 uCam,uLight;
in float vU; in float vS; in float vLen; in vec3 vP; in vec2 vT; in vec3 vCol;
in float vType; in float vSeed; in float vW; in float vH;
out vec4 o;
void main(){
  if(vType>2.5){ // washable pattern pen
    float a=(1.-smoothstep(0.55,1.0,abs(vU)))*0.34*(0.7+0.5*vnoise(vP.xy*2.3));
    o=vec4(vCol*1.6,a); return;
  }
  float capL=vW*0.8;
  float e=min(vS,vLen-vS)/capL;
  if(e<0.) discard;
  float ce=clamp(e,0.,1.);
  float capw=sqrt(ce*(2.-ce));
  float x=vU/max(capw,0.04);
  float aa=fwidth(vU)/max(capw,0.2);
  float alpha=1.-smoothstep(1.-aa,1.+aa*0.3,abs(x));
  if(alpha<0.004) discard;
  x=clamp(x,-1.,1.);
  float nz=sqrt(1.-x*x*0.97);
  vec3 T3=vec3(vT,0.), B3=vec3(-vT.y,vT.x,0.), Z=vec3(0.,0.,1.);
  float side=vS<vLen*0.5 ? 1. : -1.;
  float sl=side*(1.-ce)*1.1+(1.-2.*vS/max(vLen,1e-3))*0.24;
  vec3 Tt=normalize(T3+Z*sl);
  vec3 Nup=normalize(Z-T3*sl);
  vec3 N=normalize(B3*x+Nup*nz);
  bool floss=vType<0.5;
  float tw=floss ? 0.45 : 1.0;
  float pitch=vW*(floss ? 2.8 : 1.45);
  float ph=6.2832*(vS/pitch)+x*2.0+vSeed*40.;
  float gr=smoothstep(0.55,1.0,0.5+0.5*sin(ph));
  N=normalize(N+Tt*cos(ph)*0.30*tw);
  float f1=vnoise(vec2(x*4.+vSeed*91., vS*0.55+x*1.1));
  float f2=vnoise(vec2(x*12.+vSeed*17., vS*2.4));
  vec3 alb=vCol*(0.80+0.30*f1+0.14*f2)*(1.-0.34*tw*gr);
  // fibres run a little across the thread axis, so the sheen breaks into filaments
  vec3 Tf=normalize(Tt+B3*(floss ? 0.10 : 0.42)*nz+N*((f1-0.5)*0.55+(f2-0.5)*0.25));
  vec3 L=normalize(uLight-vP), V=normalize(uCam-vP), H=normalize(L+V);
  float ndl=dot(N,L);
  float diff=clamp(ndl*0.62+0.38,0.,1.); diff*=diff;
  float th=dot(Tf,H); float sn=sqrt(max(1.-th*th,0.));
  float mask=smoothstep(-0.15,0.55,ndl)*nz;
  float sheen=floss ? 1.0 : 0.45;
  vec3 spec=(pow(sn,80.)*0.80*vec3(1.,0.97,0.9)+pow(sn,14.)*0.30*mix(alb,vec3(1.),0.2))*mask*sheen;
  vec3 col=alb*(ambient(N)+LCOL*diff)+spec*LCOL;
  col*=mix(0.42,1.,pow(nz,0.8));
  col*=mix(0.72,1.,smoothstep(0.,1.,e));
  o=vec4(col,alpha);
}`;

SH.quadVS = `#version 300 es
layout(location=0) in vec2 aP; uniform mat4 uVP;
void main(){ gl_Position=uVP*vec4(aP*78.,0.02,1.); }`;
SH.quadFS = `#version 300 es
precision highp float; out vec4 o;
void main(){ o=vec4(0.085,0.055,0.04,1.); }`;

// ---------------------------------------------------------------- post
SH.postFS = SH.common + `
uniform sampler2D uTex; uniform vec2 uRes; uniform vec3 uCam,uR,uU,uF; uniform vec2 uProj;
uniform vec3 uDof; uniform float uSeed;
in vec2 vUv; out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
void main(){
  vec2 uv=vUv*0.5+0.5;
  vec3 rd=normalize(uF+vUv.x*uProj.x*uR+vUv.y*uProj.y*uU);
  float depth=-uCam.z/rd.z*dot(rd,uF);
  float coc=min(uDof.y*uRes.y*0.05*abs(depth-uDof.x)/depth,uDof.z);
  vec3 c;
  if(coc<0.6) c=texture(uTex,uv).rgb;
  else {
    c=vec3(0.); float a0=hash21(gl_FragCoord.xy)*6.2832;
    for(int i=0;i<16;i++){ float fi=float(i); float r=sqrt((fi+0.5)/16.)*coc; float a=fi*2.39996+a0;
      c+=texture(uTex,uv+vec2(cos(a),sin(a))*r/uRes).rgb; }
    c/=16.;
  }
  c*=0.80;
  c=aces(c);
  vec2 v=vUv*vec2(1.,0.62);
  c*=1.-0.42*pow(length(v),2.4);
  c=pow(c,vec3(1./2.2));
  c+=(hash21(gl_FragCoord.xy+uSeed)-0.5)*0.022;
  o=vec4(c,1.);
}`;
