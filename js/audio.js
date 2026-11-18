'use strict';
// The score: a small plucked tune and sewing sounds, all WebAudio, scheduled against film time.
const Score = (() => {
  let ctx=null, master=null, bus=null, rev=null, noiseBuf=null, events=[], ptr=0, lastT=-1, muted=false, wrapped=false;
  const mf=m=>440*Math.pow(2,(m-69)/12);

  function init(){
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    master=ctx.createGain(); master.gain.value=0.85;
    const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=3;
    master.connect(comp); comp.connect(ctx.destination);
    const len=ctx.sampleRate*2.2, ir=ctx.createBuffer(2,len,ctx.sampleRate);
    for(let c=0;c<2;c++){ const d=ir.getChannelData(c); for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3.2); }
    rev=ctx.createConvolver(); rev.buffer=ir; const rg=ctx.createGain(); rg.gain.value=0.55; rev.connect(rg); rg.connect(master);
    noiseBuf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const nd=noiseBuf.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
    newBus(); build();
  }
  function newBus(){
    if(bus){ const old=bus; old.gain.setTargetAtTime(0,ctx.currentTime,0.03); setTimeout(()=>{ try{ old.disconnect(); }catch(e){} },500); }
    bus=ctx.createGain(); bus.connect(master);
    const send=ctx.createGain(); send.gain.value=0.32; bus.connect(send); send.connect(rev);
  }
  function env(g,at,v,a,d){ g.gain.setValueAtTime(0.0001,at); g.gain.linearRampToValueAtTime(v,at+a); g.gain.exponentialRampToValueAtTime(0.0006,at+a+d); }
  function pluck(at,m,v,dec,drop){
    v=v||0.2; dec=dec||1.1; const f=mf(m);
    const o=ctx.createOscillator(), g=ctx.createGain(); o.type='sine'; o.frequency.setValueAtTime(f,at);
    if(drop) o.frequency.exponentialRampToValueAtTime(f*drop,at+0.35);
    env(g,at,v,0.004,dec); o.connect(g); g.connect(bus); o.start(at); o.stop(at+dec+0.1);
    const o2=ctx.createOscillator(), g2=ctx.createGain(); o2.type='sine'; o2.frequency.value=f*4.02;
    env(g2,at,v*0.28,0.002,0.14); o2.connect(g2); g2.connect(bus); o2.start(at); o2.stop(at+0.2);
    const o3=ctx.createOscillator(), g3=ctx.createGain(); o3.type='triangle'; o3.frequency.value=f*2.0;
    env(g3,at,v*0.12,0.003,dec*0.4); o3.connect(g3); g3.connect(bus); o3.start(at); o3.stop(at+dec*0.4+0.1);
  }
  function bass(at,m,v){
    const o=ctx.createOscillator(), g=ctx.createGain(), lp=ctx.createBiquadFilter(); o.type='triangle'; o.frequency.value=mf(m);
    lp.type='lowpass'; lp.frequency.value=420; env(g,at,v||0.3,0.008,0.7); o.connect(lp); lp.connect(g); g.connect(bus); o.start(at); o.stop(at+0.9);
  }
  function tick(at,v,fq){
    const s=ctx.createBufferSource(); s.buffer=noiseBuf; const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=fq||2600; bp.Q.value=2.5;
    const g=ctx.createGain(); env(g,at,v||0.1,0.001,0.035); s.connect(bp); bp.connect(g); g.connect(bus); s.start(at,Math.random()); s.stop(at+0.08);
    const o=ctx.createOscillator(), g2=ctx.createGain(); o.frequency.setValueAtTime(190,at); o.frequency.exponentialRampToValueAtTime(90,at+0.05);
    env(g2,at,(v||0.1)*0.7,0.001,0.05); o.connect(g2); g2.connect(bus); o.start(at); o.stop(at+0.09);
  }
  function wind(at,dur,v){
    const s=ctx.createBufferSource(); s.buffer=noiseBuf; s.loop=true; const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=0.9;
    bp.frequency.setValueAtTime(320,at); bp.frequency.linearRampToValueAtTime(900,at+dur*0.45); bp.frequency.linearRampToValueAtTime(380,at+dur);
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,at); g.gain.linearRampToValueAtTime(v,at+dur*0.4); g.gain.linearRampToValueAtTime(0.0001,at+dur);
    s.connect(bp); bp.connect(g); g.connect(bus); s.start(at); s.stop(at+dur+0.1);
  }
  function pad(at,dur,notes,v){
    for(const m of notes){ const o=ctx.createOscillator(), g=ctx.createGain(), lp=ctx.createBiquadFilter(); o.type='triangle'; o.frequency.value=mf(m); lp.type='lowpass'; lp.frequency.value=1100;
      g.gain.setValueAtTime(0.0001,at); g.gain.linearRampToValueAtTime(v,at+0.7); g.gain.setValueAtTime(v,at+dur-0.9); g.gain.linearRampToValueAtTime(0.0001,at+dur);
      o.connect(lp); lp.connect(g); g.connect(bus); o.start(at); o.stop(at+dur+0.1); }
  }
  const E=(t,fn)=>events.push([t,fn]);
  function build(){
    events=[];
    // 0-8 s: sewing. Needle ticks on sixteenths, a note for each figure as it starts.
    for(let i=0;i<62;i++){ const t=i*0.125; E(t,at=>tick(at,(i%4===0?0.085:0.04)*(0.6+0.4*Math.sin(i*1.7)*0.5+0.2),2200+((i*37)%9)*130)); }
    const ost=[62,69,66,69,62,71,66,69];
    for(let i=0;i<16;i++) E(i*0.5,at=>pluck(at,ost[i%8],0.05+i*0.006,0.8));
    [[0,62],[1.5,69],[3.5,74],[4,78],[5.5,81],[6.6,83],[7,86]].forEach(([t,m])=>E(t,at=>pluck(at,m,0.2,1.6)));
    // 8 s: everything wakes
    [50,57,62,66,69,74,78].forEach((m,i)=>E(8+i*0.05,at=>pluck(at,m,0.2,2.0)));
    E(8,at=>bass(at,38,0.34));
    [[9,69],[9.25,71],[9.5,74],[9.75,76]].forEach(([t,m])=>E(t,at=>pluck(at,m,0.17,0.9)));
    // the tune (two bars), used for the trot and again at the end
    const tune=(t0,v)=>{
      [[0,50],[1,50],[2,43],[3,45]].forEach(([b,m])=>E(t0+b,at=>bass(at,m,0.3*v)));
      [[0.5,[66,69]],[1.5,[66,69]],[2.5,[67,71]],[3.5,[64,69,73]]].forEach(([b,ch])=>ch.forEach(m=>E(t0+b,at=>pluck(at,m,0.08*v,0.5))));
      [78,81,78,74, 76,78,81,83, 83,81,79,83, 81,76,78,76].forEach((m,i)=>E(t0+i*0.25,at=>pluck(at,m,0.16*v,0.8)));
    };
    tune(10,1);
    for(let t=8.75;t<14.5;t+=0.25) E(t,at=>tick(at,0.035,820));
    // 12.25 s: the bird takes off
    [81,83,86,88,90,93].forEach((m,i)=>E(12.25+i*0.06,at=>pluck(at,m,0.11,0.5)));
    [[14,45],[15,45]].forEach(([t,m])=>E(t,at=>bass(at,m,0.28)));
    [[14,76],[14.5,74],[15,76],[15.5,81]].forEach(([t,m])=>E(t,at=>pluck(at,m,0.14,1.0)));
    E(14.6,at=>wind(at,6.2,0.22));
    // 16.5-18 s: the string pops out, one stitch at a time
    const down=[83,81,78,76,74,71,69,66,64,62,59,57,54];
    for(let i=0;i<13;i++) E(16.5+i*1.5/13,at=>{ pluck(at,down[i],0.15,0.5,0.6); tick(at,0.07,1500); });
    E(16,at=>bass(at,33,0.3));
    E(17.7,at=>pad(at,2.9,[55,62,69],0.045));
    [[18.5,76],[19.25,74]].forEach(([t,m])=>E(t,at=>pluck(at,m,0.12,1.8)));
    // 20.25-23.5 s: the needle sews it back, a scale step per stitch
    const up=[62,64,66,67,69,71,73,74,76,78,79,81,83];
    for(let i=0;i<13;i++) E(20.25+i*0.25,at=>{ tick(at,0.1,2400); pluck(at,up[i],0.13+i*0.004,0.7); });
    [20,21,22,23].forEach(t=>E(t,at=>bass(at,38,0.24)));
    [50,57,62,66,69,74,78,86].forEach((m,i)=>E(24+i*0.04,at=>pluck(at,m,0.2,2.2)));
    tune(24,1.05);
    for(let t=24.5;t<27.7;t+=0.25) E(t,at=>tick(at,0.03,820));
    E(24.6,at=>wind(at,2.8,0.1));
    // 28-30 s: every stitch is unpicked
    const zip=[86,83,81,78,76,74,71,69,66,64,62,59,57,54,52,50];
    for(let i=0;i<26;i++) E(28+i*0.066,at=>{ pluck(at,zip[i%16]-(i>=16?12:0),0.12*(1-i/34),0.3); tick(at,0.05,3000-i*60); });
    E(29.82,at=>tick(at,0.06,1200));
    events.sort((a,b)=>a[0]-b[0]);
  }
  function seek(t){ wrapped=false; ptr=0; while(ptr<events.length && events[ptr][0]<t-0.001) ptr++; lastT=t; }
  return {
    get on(){ return !!ctx; },
    get muted(){ return muted; },
    start(t){ if(!ctx) init(); ctx.resume(); newBus(); seek(t); },
    reseek(t){ if(!ctx) return; newBus(); seek(t); },
    setMuted(m){ muted=m; if(ctx) master.gain.setTargetAtTime(m?0:0.85,ctx.currentTime,0.05); },
    pause(p){ if(!ctx) return; if(p) ctx.suspend(); else ctx.resume(); },
    note(m,v){ if(ctx && !muted && ctx.state==='running') pluck(ctx.currentTime+0.01,m,v||0.16,1.0); },
    tap(){ if(ctx && !muted && ctx.state==='running') tick(ctx.currentTime+0.01,0.08,2400); },
    // call every frame with the film time while playing
    update(t){
      if(!ctx || ctx.state!=='running') return;
      if(t<lastT-1){ if(!wrapped) ptr=0; wrapped=false; }      // the film looped
      else if(Math.abs(t-lastT)>0.6){ newBus(); seek(t); wrapped=false; }
      lastT=t;
      const ahead=0.22, now=ctx.currentTime;
      if(wrapped) return;
      while(ptr<events.length && events[ptr][0]<t+ahead){ const e=events[ptr++]; const dt=e[0]-t; if(dt>-0.05) e[1](now+Math.max(dt,0)); }
      if(ptr>=events.length && t+ahead>30){ // events that fall just after the loop point
        let p=0; while(p<events.length && events[p][0]<t+ahead-30){ const e=events[p++]; e[1](now+e[0]+30-t); } ptr=p; wrapped=true;
      }
    }
  };
})();
