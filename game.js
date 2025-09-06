(function () {
  'use strict';

  // =======================
  // 調整セクション（ここを触ればOK）
  // =======================
  const CONFIG = {
    gravity: 0.7,
    jumpPower: 15,
    doubleJump: true,           // 2段ジャンプ
    speedStart: 6,
    speedMax: 15.5,
    speedAccel: 0.0012,

    // 出現間隔(ミリ秒)とランダム揺らぎ率
    spawnMs: { obstacle: 1200, hole: 2000, coin: 1300, enemy: 2400 },
    spawnJitter: 0.35,

    livesStart: 3,
    enemyDamage: 1,
    iFrames: 700,               // 被弾後の無敵(ms)
    enemyHitboxShrink: 0.25,    // 熊の当たり判定を内側に縮小(ゆるく)

    playerScaleVW: 0.18,        // プレイヤーのサイズ(画面幅比)
    hudWidth: 230               // 右上HUD幅
  };

  // =======================
  // アセット
  // =======================
  const ASSETS = {
    player: './走り.PNG',        // 左向き写真
    enemy:  './追いかける.PNG',  // 左向き写真（反転せず左に流れる）
    home:   './ホーム画面.PNG',
    over:   './襲われた.PNG'
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // =======================
  // 画面サイズ/HiDPI
  // =======================
  function resize(){
    const dpr = Math.max(1, Math.min(window.devicePixelRatio||1, 3));
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize);
  resize();

  const safeTop  = () => parseInt(getComputedStyle(canvas).paddingTop||'0',10) || 0;
  const safeRight= () => parseInt(getComputedStyle(canvas).paddingRight||'0',10) || 0;
  const GY       = () => window.innerHeight - 90; // 地面ライン

  // =======================
  // 画像ロード
  // =======================
  const images = {};
  function load(src){ return new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src; }); }
  Promise.all(Object.entries(ASSETS).map(async ([k,v]) => (images[k] = await load(v))))
    .then(()=>{ toHome(); requestAnimationFrame(loop); });

  // =======================
  // サウンド（mp3 + WebAudio簡易SE）
  // =======================
  const homeBGM = document.getElementById('homeBGM');
  const overSE  = document.getElementById('overSE');
  const stepSE  = document.getElementById('stepSE');
  let AC=null; function ensureAC(){ if(!AC){ const C=window.AudioContext||window.webkitAudioContext; if(C) AC=new C(); } }
  function beep(freq=600, ms=100, type='sine', vol=0.22){
    ensureAC(); if(!AC) return;
    const o=AC.createOscillator(), g=AC.createGain();
    o.type=type; o.frequency.value=freq; g.gain.value=vol;
    o.connect(g); g.connect(AC.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime+ms/1000);
    o.stop(AC.currentTime+ms/1000);
  }
  function play(a){ try{ a.currentTime=0; a.play().catch(()=>{});}catch{} }

  // =======================
  // ゲーム状態
  // =======================
  let state='loading'; // home / playing / gameover
  let lastTs=0;        // 直前のtimestamp
  let speed=CONFIG.speedStart, score=0, distance=0, coinsGot=0;
  let lives=CONFIG.livesStart;
  let invincibleUntil=0;      // 無敵解除の時刻(ms)
  let flashTimer=0;
  let lastStepAt=0;           // 足音の間隔制御

  // スポーン用タイマー(ms)
  const spawnTimers = { obstacle: 0, hole: 0, coin: 0, enemy: 0 };
  function resetSpawnTimer(key){
    const base = CONFIG.spawnMs[key];
    const jitter = 1 + (Math.random()*2-1) * CONFIG.spawnJitter;
    spawnTimers[key] = base * jitter;
  }
  function resetAllSpawn(){ Object.keys(spawnTimers).forEach(resetSpawnTimer); }

  // =======================
  // プレイヤー
  // =======================
  const player = {
    w:110,h:85,x:0,y:0,vy:0,onGround:true,jumps:2,prevY:0,
    reset(){
      this.w=Math.max(90,Math.min(170,Math.floor(window.innerWidth*CONFIG.playerScaleVW)));
      this.h=Math.floor(this.w*0.77);
      this.x=Math.floor(window.innerWidth*0.26);
      this.y=GY()-this.h; this.prevY=this.y;
      this.vy=0; this.onGround=true; this.jumps=CONFIG.doubleJump?2:1;
      lastStepAt=0;
    },
    jump(){
      if(this.onGround || (CONFIG.doubleJump && this.jumps>0)){
        this.vy = -CONFIG.jumpPower;
        if(!this.onGround && CONFIG.doubleJump) this.jumps--;
        this.onGround=false;
        beep(820,90,'triangle',0.25); // ジャンプSE
      }
    },
    update(overHole, dt){
      this.prevY = this.y;
      this.vy += CONFIG.gravity;
      this.y  += this.vy;

      if(!overHole){
        if(this.y + this.h >= GY()){
          this.y = GY() - this.h;
          this.vy = 0; this.onGround = true;
          this.jumps = CONFIG.doubleJump?2:1;
        }
      }else{
        this.onGround=false;
        if(this.y + this.h >= window.innerHeight) gameOver();
      }

      // 足音：地上で一定間隔
      if(this.onGround){
        const now = performance.now();
        if(stepSE && now - lastStepAt > 180){ play(stepSE); lastStepAt = now; }
      }
    },
    draw(){
      const img=images.player;
      if(img){ ctx.save(); ctx.scale(-1,1); ctx.drawImage(img,-this.x-this.w,this.y,this.w,this.h); ctx.restore(); }
      else { ctx.fillStyle='#6aff6a'; ctx.fillRect(this.x,this.y,this.w,this.h); }
    }
  };

  // =======================
  // エンティティ（足場/穴/コイン/敵）
  // =======================
  const obstacles=[]; // {x,y,w,h}
  const holes=[];     // {x,w}
  const coins=[];     // {x,y,r}
  const enemies=[];   // {x,y,w,h}

  function spawnObstacle(){ const w=60+Math.random()*90, h=30+Math.random()*110; obstacles.push({x:window.innerWidth+40,y:GY()-h,w,h}); }
  function spawnHole(){ const w=120+Math.random()*160; holes.push({x:window.innerWidth+100,w}); }
  function spawnCoinRow(){ const y=GY()-(140+Math.random()*140), n=4+(Math.random()*4|0); for(let i=0;i<n;i++) coins.push({x:window.innerWidth+60+i*36,y,r:10}); }
  function spawnEnemy(){ const w=Math.min(240,Math.max(120,Math.floor(window.innerWidth*0.26))), h=Math.floor(w*0.67); enemies.push({x:window.innerWidth+40,y:GY()-h,w,h}); }

  function updateWorld(dt){
    speed = Math.min(CONFIG.speedMax, speed + CONFIG.speedAccel*dt);

    // スポーン（タイマー式でFPS非依存）
    for(const k of Object.keys(spawnTimers)){
      spawnTimers[k] -= dt;
      if(spawnTimers[k] <= 0){
        if(k==='obstacle') spawnObstacle();
        if(k==='hole')     spawnHole();
        if(k==='coin')     spawnCoinRow();
        if(k==='enemy')    spawnEnemy();
        resetSpawnTimer(k);
      }
    }

    const vx = speed*(dt/16.7);
    for(const o of obstacles){ o.x -= vx; o.y = GY() - o.h; }
    for(const h of holes){     h.x -= vx; }
    for(const c of coins){     c.x -= vx; }
    for(const e of enemies){   e.x -= (vx + 1.2*(dt/16.7)); e.y = GY() - e.h; }

    while(obstacles.length && obstacles[0].x+obstacles[0].w < -80) obstacles.shift();
    while(holes.length     && holes[0].x+holes[0].w     < -80) holes.shift();
    while(coins.length     && coins[0].x+coins[0].r     < -80) coins.shift();
    while(enemies.length   && enemies[0].x+enemies[0].w < -80) enemies.shift();
  }

  function isOverHole(cx){ return holes.some(h=> cx>h.x && cx<h.x+h.w); }
  function hit(a,b){ return !(a.x+a.w<b.x || a.x>b.x+b.w || a.y+a.h<b.y || a.y>b.y+b.h); }
  function shrinkBox(box, ratio){ const mx=box.w*ratio, my=box.h*ratio; return {x:box.x+mx,y:box.y+my,w:box.w-2*mx,h:box.h-2*my}; }

  // 足場：前フレームは上、今フレームは貫通→上からだけ着地
  function handlePlatforms(){
    for(const o of obstacles){
      const wasAbove = player.prevY + player.h <= o.y + 1;
      const nowBelow = player.y + player.h >= o.y && player.y + player.h <= o.y + 16;
      const horizontal = player.x + player.w > o.x && player.x < o.x + o.w;
      if(wasAbove && nowBelow && horizontal && player.vy >= 0){
        player.y = o.y - player.h; player.vy=0; player.onGround=true; player.jumps=CONFIG.doubleJump?2:1;
      }
    }
  }

  // コイン取得
  function collectCoins(){
    for(let i=coins.length-1;i>=0;i--){
      const c=coins[i];
      const nx=Math.max(player.x,Math.min(c.x,player.x+player.w));
      const ny=Math.max(player.y,Math.min(c.y,player.y+player.h));
      if((nx-c.x)**2 + (ny-c.y)**2 <= c.r**2){
        coins.splice(i,1);
        coinsGot++; score += 100;
        beep(1200,90,'sine',0.25);
      }
    }
  }

  // 敵ヒット（ゆるい判定）
  function collideEnemies(now){
    if(now < invincibleUntil) return;
    const p = shrinkBox({x:player.x,y:player.y,w:player.w,h:player.h}, 0.10);
    for(const e of enemies){
      const eb = shrinkBox(e, CONFIG.enemyHitboxShrink);
      if(hit(p, eb)){
        lives -= CONFIG.enemyDamage;
        invincibleUntil = now + CONFIG.iFrames;
        flashTimer = 220;
        beep(200,140,'square',0.3);
        if(lives<=0){ gameOver(); }
        break;
      }
    }
  }

  // =======================
  // 入力
  // =======================
  function press(){
    ensureAC();
    if(state==='home') startGame();
    else if(state==='playing') player.jump();
    else if(state==='gameover') toHome();
  }
  window.addEventListener('touchstart', e=>{ e.preventDefault(); press(); }, {passive:false});
  window.addEventListener('mousedown', press);
  window.addEventListener('keydown', e=>{ if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); press(); } });

  // =======================
  // 描画
  // =======================
  function drawBG(){
    const g=ctx.createLinearGradient(0,0,0,window.innerHeight);
    g.addColorStop(0,'#0f2e0f'); g.addColorStop(1,'#071a07');
    ctx.fillStyle=g; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

    // 地面（縁取りで境界をハッキリ）
    ctx.fillStyle='var(--ground)'; ctx.fillRect(0,GY(),window.innerWidth,window.innerHeight-GY());
    ctx.fillStyle='var(--ground-top)'; ctx.fillRect(0,GY()-4,window.innerWidth,4);
  }

  function roundRect(x,y,w,h,r,fill){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath(); ctx.fillStyle=fill; ctx.fill();
  }

  function drawHUD(){
    const x = window.innerWidth - CONFIG.hudWidth - 12 - safeRight();
    const y = 8 + safeTop();
    roundRect(x,y,CONFIG.hudWidth,58,10,'var(--hud)');
    ctx.fillStyle='var(--fg)'; ctx.font='700 18px monospace';
    ctx.fillText(`SCORE ${score|0}`, x+12, y+28);
    ctx.fillText(`LIFE  ${lives}`,  x+12, y+50);
    ctx.textAlign='right';
    ctx.fillText(`${(distance|0)} m`, x+CONFIG.hudWidth-10, y+28);
    ctx.fillText(`COIN ${coinsGot}`,  x+CONFIG.hudWidth-10, y+50);
    ctx.textAlign='left';
  }

  function drawObstacles(){
    for(const o of obstacles){
      ctx.fillStyle='#228b22'; ctx.fillRect(o.x,o.y,o.w,o.h);
      ctx.fillStyle='rgba(255,255,255,.08)'; ctx.fillRect(o.x+4,o.y+4,o.w-8,o.h-8);
    }
  }

  function drawHoles(){
    // 黒＋警告ストライプで視認性UP
    for(const h of holes){
      ctx.fillStyle='#000'; ctx.fillRect(h.x, GY(), h.w, window.innerHeight-GY());
      // 斜めストライプ
      ctx.save(); ctx.translate(h.x-8, GY()-8); ctx.rotate(Math.PI/6);
      ctx.fillStyle='#ffd54d';
      for(let i=-20;i<(h.w+32)/12;i++){ ctx.fillRect(i*12,0,6,6); }
      ctx.restore();
    }
  }

  function drawCoins(){
    for(const c of coins){
      ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,Math.PI*2); ctx.fillStyle='#eaffab'; ctx.fill();
      ctx.beginPath(); ctx.arc(c.x,c.y,c.r*0.55,0,Math.PI*2); ctx.fillStyle='#93c953'; ctx.fill();
    }
  }

  function drawEnemies(){
    for(const e of enemies){
      if(images.enemy) ctx.drawImage(images.enemy, e.x, e.y, e.w, e.h);
      else { ctx.fillStyle='#333'; ctx.fillRect(e.x,e.y,e.w,e.h); }
    }
  }

  function centerDraw(img,maxW){
    if(!img) return;
    const iw=Math.min(maxW,window.innerWidth*0.86);
    const r=img.height/img.width; const w=iw,h=w*r;
    const x=(window.innerWidth-w)/2, y=(window.innerHeight-h)/2;
    ctx.drawImage(img,x,y,w,h);
  }

  function drawHome(){
    centerDraw(images.home,540);
    // タイトルは必ず見える位置＆影付き
    const yTop = 48 + safeTop();
    ctx.textAlign='center';
    ctx.font='700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillStyle='rgba(0,0,0,.65)';
    ctx.fillText('わいちゃんRUN', window.innerWidth/2+2, yTop+2);
    ctx.fillStyle='#6aff6a';
    ctx.fillText('わいちゃんRUN', window.innerWidth/2, yTop);
    ctx.fillStyle='#fff'; ctx.font='26px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('タップ/スペースでスタート', window.innerWidth/2, window.innerHeight-80);
  }

  function drawGameOver(){
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    centerDraw(images.over,520);
    ctx.textAlign='center'; ctx.fillStyle='#fff';
    ctx.font='700 56px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('GAME OVER', window.innerWidth/2, 84);
    ctx.font='24px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText(`SCORE ${score|0} / ${(distance|0)} m / COIN ${coinsGot}`, window.innerWidth/2, window.innerHeight-84);
    ctx.fillText('タップでホームへ', window.innerWidth/2, window.innerHeight-44);
  }

  // =======================
  // フロー
  // =======================
  function toHome(){ state='home'; try{ overSE.pause(); overSE.currentTime=0; }catch{} try{ homeBGM.play().catch(()=>{});}catch{} }
  function startGame(){
    state='playing';
    try{ homeBGM.pause(); }catch{} try{ overSE.pause(); overSE.currentTime=0; }catch{}
    speed=CONFIG.speedStart; score=0; distance=0; coinsGot=0; lives=CONFIG.livesStart;
    invincibleUntil=0; flashTimer=0;
    player.reset();
    obstacles.length=0; holes.length=0; coins.length=0; enemies.length=0;
    resetAllSpawn();
  }
  function gameOver(){ state='gameover'; play(overSE); }

  // =======================
  // メインループ
  // =======================
  function loop(ts){
    const dt = Math.max(0, ts - lastTs || 16.7); lastTs = ts;

    drawBG();

    if(state==='home'){
      drawHome();
    } else if(state==='playing'){
      distance += speed * 0.25 * (dt/16.7);
      score    += speed * 0.35 * (dt/16.7);

      updateWorld(dt);

      const cx = player.x + player.w/2;
      const over = isOverHole(cx);
      player.update(over, dt);
      handlePlatforms();
      collectCoins();
      collideEnemies(performance.now());

      drawHoles(); drawObstacles(); drawCoins(); drawEnemies();

      if(flashTimer>0){ ctx.fillStyle='rgba(255,0,0,.22)'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight); flashTimer-=dt; }

      player.draw();
      drawHUD();

    } else if(state==='gameover'){
      drawHoles(); drawObstacles(); drawCoins(); drawEnemies(); player.draw();
      drawGameOver();
    }

    requestAnimationFrame(loop);
  }

  // =======================
  // 入力（最後に定義）
  // =======================
  function press(){
    ensureAC();
    if(state==='home') startGame();
    else if(state==='playing') player.jump();
    else if(state==='gameover') toHome();
  }
  window.addEventListener('touchstart', e=>{ e.preventDefault(); press(); }, {passive:false});
  window.addEventListener('mousedown', press);
  window.addEventListener('keydown', e=>{ if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); press(); } });

})();
