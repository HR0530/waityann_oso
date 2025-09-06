(function () {
  'use strict';

  // ================================
  //  TUNABLE SETTINGS（ここを触れば調整OK）
  // ================================
  const CONFIG = {
    // 物理
    gravity: 0.7,           // 重力
    jumpPower: 15,          // ジャンプ力
    doubleJump: true,       // ダブルジャンプ可否
    // スピード
    speedStart: 6,          // 初期スクロール速度
    speedMax: 16,           // 最高速度
    speedAccel: 0.0010,     // 徐々に速くなる加速度
    // 生成間隔（フレーム相当：小さいほど頻繁）
    spawnObstacleEvery: 90, // 足場ブロック
    spawnHoleEvery: 220,    // 落とし穴
    spawnCoinEvery: 110,    // コイン列
    // 見た目
    playerScaleVW: 0.18,    // 画面幅に対するプレイヤー基準サイズ
    hudWidth: 210,
  };

  // ================================
  //  アセット
  // ================================
  const ASSETS = {
    penguin: './走り.PNG',
    home:    './ホーム画面.PNG',
    over:    './襲われた.PNG'
  };

  const canvas  = document.getElementById('game');
  const ctx     = canvas.getContext('2d');
  const homeBGM = document.getElementById('homeBGM');
  const overSE  = document.getElementById('overSE');

  // ================================
  //  画面サイズ & HiDPI
  // ================================
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

  // ================================
  //  画像ロード
  // ================================
  const images = {};
  function loadImage(src) {
    return new Promise((resolve)=>{ const i=new Image(); i.onload=()=>resolve(i); i.onerror=()=>resolve(null); i.src=src; });
  }
  Promise.all(Object.entries(ASSETS).map(async ([k,v]) => (images[k] = await loadImage(v))))
    .then(()=>{ toHome(); requestAnimationFrame(loop); });

  // ================================
  //  状態
  // ================================
  let state='loading'; // home / playing / gameover
  let tPrev=0, perf=0;
  let speed=CONFIG.speedStart, score=0, best = Number(localStorage.getItem('wai_best')||0);

  const GY = ()=> window.innerHeight - 90; // 地面Y
  const safeTopPad = () => parseInt(getComputedStyle(canvas).paddingTop||'0',10)||0;

  // ================================
  //  プレイヤー
  // ================================
  const player = {
    w:110, h:85, x:0, y:0, vy:0,
    onGround:true, jumps:2,
    reset(){
      this.w = Math.max(90, Math.min(170, Math.floor(window.innerWidth * CONFIG.playerScaleVW)));
      this.h = Math.floor(this.w * 0.77);
      this.x = Math.floor(window.innerWidth * 0.26);
      this.y = GY() - this.h;
      this.vy = 0; this.onGround = true;
      this.jumps = CONFIG.doubleJump ? 2 : 1;
    },
    jump(){
      if (this.onGround || this.jumps > 0) {
        this.vy = -CONFIG.jumpPower;
        this.onGround = false;
        if (!this.onGround && CONFIG.doubleJump) this.jumps--;
      }
    },
    update(isOverHole){
      // 重力
      this.vy += CONFIG.gravity;
      this.y += this.vy;

      // 地面（穴の上では吸着しない）
      if (!isOverHole) {
        if (this.y + this.h >= GY()) {
          this.y = GY() - this.h;
          this.vy = 0; this.onGround = true;
          this.jumps = CONFIG.doubleJump ? 2 : 1;
        }
      } else {
        this.onGround = false;
        if (this.y + this.h >= window.innerHeight) gameOver(); // 穴落ち
      }
    },
    draw(){
      const img = images.penguin;
      if (img) {
        ctx.save();
        ctx.scale(-1,1); // 右向きに反転
        ctx.drawImage(img, -this.x - this.w, this.y, this.w, this.h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#6aff6a';
        ctx.fillRect(this.x, this.y, this.w, this.h);
      }
    }
  };

  // ================================
  //  ワールド（足場/穴/コイン）
  // ================================
  const obstacles = []; // {x,y,w,h}
  const holes = [];     // {x,w}
  const coins = [];     // {x,y,r}

  function spawnObstacle(){
    const w = 60 + Math.random()*80;
    const h = 30 + Math.random()*110;
    obstacles.push({ x: window.innerWidth + 40, y: GY() - h, w, h });
  }
  function spawnHole(){
    const w = 120 + Math.random()*160;
    holes.push({ x: window.innerWidth + 120, w });
  }
  function spawnCoinRow(){
    const baseY = GY() - (140 + Math.random()*140);
    const n = 4 + (Math.random()*3|0);
    for(let i=0;i<n;i++){
      coins.push({ x: window.innerWidth + 60 + i*36, y: baseY, r: 10 });
    }
  }

  function updateWorld(){
    speed = Math.min(CONFIG.speedMax, speed + CONFIG.speedAccel);
    perf += 1;

    if (perf % CONFIG.spawnObstacleEvery === 0) spawnObstacle();
    if (perf % CONFIG.spawnHoleEvery === 0)     spawnHole();
    if (perf % CONFIG.spawnCoinEvery === 0)     spawnCoinRow();

    for (const o of obstacles){ o.x -= speed; o.y = GY() - o.h; }
    for (const h of holes){     h.x -= speed; }
    for (const c of coins){     c.x -= speed; }

    while (obstacles.length && obstacles[0].x + obstacles[0].w < -80) obstacles.shift();
    while (holes.length     && holes[0].x + holes[0].w < -80) holes.shift();
    while (coins.length     && coins[0].x + coins[0].r < -80) coins.shift();
  }

  function isOverHole(centerX){ return holes.some(h => centerX > h.x && centerX < h.x + h.w); }
  function hit(a,b){ return !(a.x+a.w<b.x || a.x>b.x+b.w || a.y+a.h<b.y || a.y>b.y+b.h); }

  // 上から着地できる足場
  function handlePlatforms(){
    for (const o of obstacles){
      const fromAbove = player.y + player.h > o.y && player.y + player.h < o.y + 16 && player.vy >= 0;
      const horizontal = player.x + player.w > o.x && player.x < o.x + o.w;
      if (fromAbove && horizontal) {
        player.y = o.y - player.h;
        player.vy = 0; player.onGround = true;
        player.jumps = CONFIG.doubleJump ? 2 : 1;
      }
    }
  }

  // コイン取得（円とAABBの簡易判定）
  function collectCoins(){
    for (let i = coins.length-1; i >= 0; i--){
      const c = coins[i];
      const nx = Math.max(player.x, Math.min(c.x, player.x + player.w));
      const ny = Math.max(player.y, Math.min(c.y, player.y + player.h));
      if ((nx - c.x)**2 + (ny - c.y)**2 <= c.r**2) {
        coins.splice(i,1);
        score += 100;
      }
    }
  }

  // ================================
  //  入力
  // ================================
  function press(){
    if (state==='home') startGame();
    else if (state==='playing') player.jump();
    else if (state==='gameover') toHome();
  }
  window.addEventListener('touchstart', e=>{ e.preventDefault(); press(); }, {passive:false});
  window.addEventListener('mousedown', press);
  window.addEventListener('keydown', e=>{ if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); press(); } });

  // ================================
  //  描画
  // ================================
  function drawBG(){
    const g = ctx.createLinearGradient(0,0,0,window.innerHeight);
    g.addColorStop(0,'#0f2e0f'); g.addColorStop(1,'#071a07');
    ctx.fillStyle=g; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    // 地面
    ctx.fillStyle='var(--ground)';
    ctx.fillRect(0,GY(),window.innerWidth,window.innerHeight-GY());
  }
  function drawHUD(){
    const pad = safeTopPad();
    ctx.fillStyle='var(--hud)'; ctx.fillRect(8,8+pad,CONFIG.hudWidth,58);
    ctx.fillStyle='var(--fg)'; ctx.font='700 18px monospace';
    ctx.fillText(`SCORE ${score|0}`, 16, 32+pad);
    ctx.fillText(`SPEED ${speed.toFixed(1)}`, 16, 54+pad);
  }
  function drawObstacles(){
    for(const o of obstacles){
      ctx.fillStyle='#228b22'; ctx.fillRect(o.x,o.y,o.w,o.h);
      ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fillRect(o.x+4,o.y+4,o.w-8,o.h-8);
    }
  }
  function drawHoles(){
    ctx.fillStyle='#000';
    for(const h of holes) ctx.fillRect(h.x, GY(), h.w, window.innerHeight-GY());
  }
  function drawCoins(){
    for(const c of coins){
      ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,Math.PI*2); ctx.fillStyle='#eaffab'; ctx.fill();
      ctx.beginPath(); ctx.arc(c.x,c.y,c.r*0.55,0,Math.PI*2); ctx.fillStyle='#93c953'; ctx.fill();
    }
  }
  function centerDraw(img,maxW){
    if(!img) return;
    const iw = Math.min(maxW, window.innerWidth*0.86);
    const r = img.height/img.width; const w=iw, h=w*r;
    const x=(window.innerWidth-w)/2, y=(window.innerHeight-h)/2;
    ctx.drawImage(img,x,y,w,h);
  }
  function drawHome(){
    centerDraw(images.home, 540);
    ctx.textAlign='center';
    ctx.fillStyle='var(--accent)'; ctx.font='700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
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

  // ================================
  //  フロー
  // ================================
  function toHome(){
    state='home'; speed = CONFIG.speedStart;
    try{ overSE.pause(); overSE.currentTime=0; }catch{}
    homeBGM.play().catch(()=>{});
  }
  function startGame(){
    state='playing';
    try{ homeBGM.pause(); }catch{}
    try{ overSE.pause(); overSE.currentTime=0; }catch{}
    perf=0; score=0; speed=CONFIG.speedStart;
    player.reset(); obstacles.length=0; holes.length=0; coins.length=0;
  }
  function gameOver(){
    state='gameover';
    best = Math.max(best, score|0);
    try{ localStorage.setItem('wai_best', best); }catch{}
    try{ overSE.currentTime=0; overSE.play().catch(()=>{});}catch{}
  }

  // ================================
  //  メインループ
  // ================================
  function loop(ts){
    const dt = ts - tPrev; tPrev = ts;
    drawBG();

    if(state==='home'){
      drawHome();
    }
    else if(state==='playing'){
      score += speed * 0.4;
      updateWorld();

      // プレイヤー
      const centerX = player.x + player.w/2;
      const over = isOverHole(centerX);
      player.update(over);
      handlePlatforms();
      collectCoins();

      drawHoles();
      drawObstacles();
      drawCoins();
      player.draw();
      drawHUD();
    }
    else if(state==='gameover'){
      drawHoles(); drawObstacles(); drawCoins(); player.draw(); drawGameOver();
    }

    requestAnimationFrame(loop);
  }
})();
