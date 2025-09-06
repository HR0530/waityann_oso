(function () {
  'use strict';

  // ---------- ASSETS ----------
  const ASSETS = {
    penguin: './走り.PNG',
    home:    './ホーム画面.PNG',
    over:    './襲われた.PNG'
  };

  const canvas  = document.getElementById('game');
  const ctx     = canvas.getContext('2d');
  const homeBGM = document.getElementById('homeBGM');
  const overSE  = document.getElementById('overSE');
  const stepSE  = document.getElementById('stepSE');  // 足音

  // ---------- SIZE / HiDPI ----------
  function resize() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- LOAD ----------
  const images = {};
  function loadImage(src) {
    return new Promise((resolve)=>{ const i=new Image(); i.onload=()=>resolve(i); i.onerror=()=>resolve(null); i.src=src; });
  }
  Promise.all(Object.entries(ASSETS).map(async ([k,v]) => (images[k] = await loadImage(v))))
    .then(()=>{ toHome(); requestAnimationFrame(loop); });

  // ---------- STATE ----------
  let state='loading'; // home / playing / gameover
  let tPrev=0, tick=0;
  let speed=6, score=0;

  // 地面
  const GY = ()=> window.innerHeight - 90;
  const GRAVITY = ()=> 0.7;

  // ---------- PLAYER ----------
  const player = {
    w:110, h:85, x:0, y:0, vy:0,
    onGround:true, jumps:2,
    reset(){
      this.w = Math.min(170, Math.max(95, Math.floor(window.innerWidth*0.18)));
      this.h = Math.floor(this.w*0.77);
      this.x = Math.floor(window.innerWidth*0.28);
      this.y = GY() - this.h;
      this.vy = 0; this.onGround = true; this.jumps = 2;
      lastStepTime = 0;
    },
    jump(){
      if (this.onGround || this.jumps > 0) {
        this.vy = -15;
        this.onGround = false;
        if (!this.onGround) this.jumps--;
      }
    },
    update(){
      // 物理
      this.vy += GRAVITY();
      this.y  += this.vy;

      // 地面（穴は別で処理）
      if (this.y + this.h >= GY()) {
        this.y = GY() - this.h;
        this.vy = 0; this.onGround = true; this.jumps = 2;
      } else {
        this.onGround = false;
      }
    },
    draw(){
      const img = images.penguin;
      if (img) {
        ctx.save();
        ctx.scale(-1,1); // 右向きに反転
        ctx.drawImage(img, -this.x-this.w, this.y, this.w, this.h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#6aff6a';
        ctx.fillRect(this.x, this.y, this.w, this.h);
      }
    }
  };

  // 足音：地上にいる間、一定間隔で再生
  let lastStepTime = 0;
  function stepSound(nowMs){
    if (!stepSE) return;
    if (!player.onGround) return;
    if (nowMs - lastStepTime < 160) return; // 160msごと
    try { stepSE.currentTime = 0; stepSE.play().catch(()=>{}); } catch {}
    lastStepTime = nowMs;
  }

  // ---------- WORLD ----------
  const obstacles=[];   // {x,y,w,h}
  const holes=[];       // {x,w}

  function spawnObstacle(){
    const w = 60 + Math.random()*70;
    const h = 30 + Math.random()*110;
    obstacles.push({ x: window.innerWidth + 40, y: GY() - h, w, h });
  }
  function spawnHole(){
    const w = 120 + Math.random()*140;
    holes.push({ x: window.innerWidth + 120, w });
  }

  function updateWorld(){
    speed = Math.min(14, speed + 0.0009);
    // 出現間隔（短すぎないよう固定値中心）
    if ((tick|0) % 90 === 0) spawnObstacle();
    if ((tick|0) % 220 === 0) spawnHole();

    for (const o of obstacles){ o.x -= speed; o.y = GY() - o.h; }
    for (const h of holes){     h.x -= speed; }

    while (obstacles.length && obstacles[0].x + obstacles[0].w < -80) obstacles.shift();
    while (holes.length     && holes[0].x + holes[0].w < -80) holes.shift();
  }

  function overHole(cx){ return holes.some(h=> cx>h.x && cx<h.x+h.w); }

  // ---------- INPUT ----------
  function press(){
    if (state==='home') start();
    else if (state==='playing') player.jump();
    else if (state==='gameover') toHome();
  }
  window.addEventListener('touchstart', e=>{ e.preventDefault(); press(); }, {passive:false});
  window.addEventListener('mousedown', press);
  window.addEventListener('keydown', e=>{ if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); press(); } });

  // ---------- DRAW ----------
  function drawBG(){
    const g = ctx.createLinearGradient(0,0,0,window.innerHeight);
    g.addColorStop(0,'#0f2e0f'); g.addColorStop(1,'#071a07');
    ctx.fillStyle=g; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    // 地面
    ctx.fillStyle='#164d16';
    ctx.fillRect(0,GY(),window.innerWidth,window.innerHeight-GY());
  }
  function drawHUD(){
    const topPad = parseInt(getComputedStyle(canvas).paddingTop||'0',10) || 0;
    ctx.fillStyle='var(--hud)'; ctx.fillRect(8,8+topPad,170,56);
    ctx.fillStyle='var(--fg)'; ctx.font='700 18px monospace';
    ctx.fillText(`SCORE ${score|0}`, 16, 32+topPad);
    ctx.fillText(`SPEED ${speed.toFixed(1)}`, 16, 54+topPad);
  }
  function drawObstacles(){
    for(const o of obstacles){ ctx.fillStyle='#228b22'; ctx.fillRect(o.x,o.y,o.w,o.h); }
  }
  function drawHoles(){
    ctx.fillStyle='#000';
    for(const h of holes){ ctx.fillRect(h.x, GY(), h.w, window.innerHeight-GY()); }
  }
  function centerDraw(img,maxW){
    if(!img) return;
    const iw = Math.min(maxW, window.innerWidth*0.86);
    const r = img.height/img.width; const w=iw, h=w*r;
    const x=(window.innerWidth-w)/2, y=(window.innerHeight-h)/2;
    ctx.drawImage(img,x,y,w,h);
  }
  function drawTitle(){
    centerDraw(images.home, 520);
    ctx.textAlign='center';
    ctx.fillStyle='#6aff6a'; ctx.font='700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('わいちゃんRUN', window.innerWidth/2, 72);
    ctx.fillStyle='#fff'; ctx.font='26px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('タップ/スペースでスタート', window.innerWidth/2, window.innerHeight-100);
  }
  function drawGameOver(){
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    centerDraw(images.over, 520);
    ctx.textAlign='center'; ctx.fillStyle='#fff';
    ctx.font='700 56px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('GAME OVER', window.innerWidth/2, 84);
    ctx.font='24px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText(`SCORE ${score|0}`, window.innerWidth/2, window.innerHeight-84);
    ctx.fillText('タップでホームへ', window.innerWidth/2, window.innerHeight-44);
  }

  // ---------- FLOW ----------
  function toHome(){ state='home'; try{ homeBGM.play().catch(()=>{});}catch{} }
  function start(){
    state='playing';
    try{ homeBGM.pause(); }catch{}
    try{ overSE.pause(); overSE.currentTime=0; }catch{}
    tick=0; score=0; speed=6;
    player.reset(); obstacles.length=0; holes.length=0;
  }
  function gameOver(){ state='gameover'; try{ overSE.currentTime=0; overSE.play().catch(()=>{});}catch{} }

  // ---------- MAIN LOOP ----------
  function loop(ts){
    const dt = ts - tPrev; tPrev = ts; tick += dt||16.7;
    drawBG();

    if(state==='home'){
      drawTitle();
    } else if(state==='playing'){
      // 進行
      score += speed*0.4;
      updateWorld();

      // プレイヤー更新
      player.update();

      // 障害物：上からだけ乗る
      for(const o of obstacles){
        if (player.y + player.h > o.y && player.y + player.h < o.y + 20 && player.vy >= 0 &&
            player.x + player.w > o.x && player.x < o.x + o.w) {
          player.landOn(o.y);
        }
      }

      // 穴：地面クランプ無効化＆落下でゲームオーバー
      const cx = player.x + player.w/2;
      if (overHole(cx)) {
        if (player.y + player.h >= window.innerHeight) { gameOver(); }
        else { player.onGround = false; } // 落下継続
      }

      // 足音（地上にいる間だけ一定間隔で再生）
      stepSound(ts);

      // 描画
      drawHoles();
      drawObstacles();
      player.draw();
      drawHUD();
    } else if(state==='gameover'){
      drawHoles(); drawObstacles(); player.draw(); drawGameOver();
    }

    requestAnimationFrame(loop);
  }
})();
