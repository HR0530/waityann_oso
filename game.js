(function () {
  'use strict';

  //========================
  // 調整セクション（ここだけ触ればOK）
  //========================
  const CONFIG = {
    gravity: 0.7,          // 重力
    jumpPower: 15,         // ジャンプ力
    doubleJump: false,     // ダブルジャンプ可否
    speedStart: 6,         // 初期速度
    speedMax: 15.5,        // 最高速度
    speedAccel: 0.0010,    // 徐々に速くする量
    spawnObstacleEvery: 90,// 足場生成間隔（小さい=多い）
    spawnHoleEvery: 220,   // 穴の生成間隔
    spawnCoinEvery: 120,   // コイン列の生成間隔
    spawnEnemyEvery: 260,  // 敵（熊）の生成間隔
    enemySpeedPlus: 1.2,   // 熊の自走分（speedに加算）
    enemyDamage: 1,        // 熊の接触ダメージ
    iFrames: 60,           // 被弾後の無敵フレーム
    livesStart: 3,         // 初期ライフ
    playerScaleVW: 0.18,   // 主人公サイズ（画面幅比）
    hudWidth: 260          // HUDパネル幅
  };

  //========================
  // アセット
  //========================
  const ASSETS = {
    player: './走り.PNG',        // 左向き想定
    enemy:  './追いかける.PNG',  // 左向き写真（反転しない）
    home:   './ホーム画面.PNG',
    over:   './襲われた.PNG'
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  //========================
  // 画面サイズ/HiDPI
  //========================
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

  const padTop = ()=> parseInt(getComputedStyle(canvas).paddingTop||'0',10) || 0;
  const GY = ()=> window.innerHeight - 90; // 地面ライン

  //========================
  // 画像ロード
  //========================
  const images = {};
  function load(src){ return new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src; }); }
  Promise.all(Object.entries(ASSETS).map(async ([k,v]) => (images[k] = await load(v))))
    .then(()=>{ toHome(); requestAnimationFrame(loop); });

  //========================
  // サウンド（WebAudio簡易SE + mp3）
  //========================
  const homeBGM = document.getElementById('homeBGM');
  const overSE  = document.getElementById('overSE');
  const stepSE  = document.getElementById('stepSE');
  let AC = null; // AudioContext
  function ensureAC(){ if(!AC){ const C = window.AudioContext||window.webkitAudioContext; if(C) AC = new C(); } }
  function beep(freq=600, ms=100, type='sine', vol=0.2){
    ensureAC(); if(!AC) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value=freq;
    g.gain.value = vol;
    o.connect(g); g.connect(AC.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + ms/1000);
    o.stop(AC.currentTime + ms/1000);
  }
  function play(audio){ try{ audio.currentTime=0; audio.play().catch(()=>{});}catch{} }

  //========================
  // 状態
  //========================
  let state='loading'; // home / playing / gameover
  let last=0, perf=0;
  let speed=CONFIG.speedStart, score=0, distance=0;
  let lives=CONFIG.livesStart, invincible=0, flash=0;
  let lastStep=0;

  //========================
  // プレイヤー
  //========================
  const player = {
    w:110,h:85,x:0,y:0,vy:0,onGround:true,jumps:1,
    reset(){
      this.w=Math.max(90,Math.min(170,Math.floor(window.innerWidth*CONFIG.playerScaleVW)));
      this.h=Math.floor(this.w*0.77);
      this.x=Math.floor(window.innerWidth*0.26);
      this.y=GY()-this.h;
      this.vy=0; this.onGround=true;
      this.jumps=CONFIG.doubleJump?2:1;
      lastStep=0;
    },
    jump(){
      if(this.onGround || (CONFIG.doubleJump && this.jumps>0)){
        this.vy=-CONFIG.jumpPower;
        if(!this.onGround && CONFIG.doubleJump) this.jumps--;
        this.onGround=false;
        beep(800,90,'triangle',0.25); // ジャンプSE（合成）
      }
    },
    update(isOverHole){
      this.vy += CONFIG.gravity;
      this.y  += this.vy;

      // 地面（穴の上では無効）
      if(!isOverHole){
        if(this.y + this.h >= GY()){
          this.y = GY()-this.h;
          this.vy=0; this.onGround=true;
          this.jumps = CONFIG.doubleJump?2:1;
        }
      }else{
        this.onGround=false;
        if(this.y + this.h >= window.innerHeight) gameOver();
      }

      // 足音：地上で一定間隔
      if(this.onGround){
        const now = performance.now();
        if(now - lastStep > 170){
          if(stepSE){ play(stepSE); } else { beep(220,40,'square',0.12); }
          lastStep = now;
        }
      }
    },
    draw(){
      const img = images.player;
      if(img){
        // 右向きに反転（写真は左向き）
        ctx.save(); ctx.scale(-1,1);
        ctx.drawImage(img, -this.x - this.w, this.y, this.w, this.h);
        ctx.restore();
      }else{ ctx.fillStyle='#6aff6a'; ctx.fillRect(this.x,this.y,this.w,this.h); }
    }
  };

  //========================
  // エンティティ（足場/穴/コイン/敵）
  //========================
  const obstacles=[]; // {x,y,w,h}
  const holes=[];     // {x,w}
  const coins=[];     // {x,y,r}
  const enemies=[];   // {x,y,w,h}

  function spawnObstacle(){
    const w = 60 + Math.random()*90;
    const h = 30 + Math.random()*110;
    obstacles.push({ x: window.innerWidth + 40, y: GY()-h, w, h });
  }
  function spawnHole(){
    const w = 120 + Math.random()*160;
    holes.push({ x: window.innerWidth + 100, w });
  }
  function spawnCoinRow(){
    const y = GY() - (140 + Math.random()*140);
    const n = 4 + (Math.random()*4|0);
    for(let i=0;i<n;i++) coins.push({ x: window.innerWidth + 60 + i*36, y, r: 10 });
  }
  function spawnEnemy(){
    const w = Math.min(240, Math.max(120, Math.floor(window.innerWidth*0.26)));
    const h = Math.floor(w*0.67);
    enemies.push({ x: window.innerWidth + 40, y: GY()-h, w, h });
  }

  function updateWorld(){
    speed = Math.min(CONFIG.speedMax, speed + CONFIG.speedAccel);
    perf++;

    if(perf % CONFIG.spawnObstacleEvery === 0) spawnObstacle();
    if(perf % CONFIG.spawnHoleEvery     === 0) spawnHole();
    if(perf % CONFIG.spawnCoinEvery     === 0) spawnCoinRow();
    if(perf % CONFIG.spawnEnemyEvery    === 0) spawnEnemy();

    for(const o of obstacles){ o.x -= speed; o.y = GY() - o.h; }
    for(const h of holes){     h.x -= speed; }
    for(const c of coins){     c.x -= speed; }
    for(const e of enemies){   e.x -= (speed + CONFIG.enemySpeedPlus); e.y = GY() - e.h; }

    while(obstacles.length && obstacles[0].x+obstacles[0].w < -80) obstacles.shift();
    while(holes.length     && holes[0].x+holes[0].w < -80) holes.shift();
    while(coins.length     && coins[0].x+coins[0].r < -80) coins.shift();
    while(enemies.length   && enemies[0].x+enemies[0].w < -80) enemies.shift();
  }

  function isOverHole(cx){ return holes.some(h=> cx>h.x && cx<h.x+h.w); }
  function hit(a,b){ return !(a.x+a.w<b.x || a.x>b.x+b.w || a.y+a.h<b.y || a.y>b.y+b.h); }

  // 上から着地できる足場
  function handlePlatforms(){
    for(const o of obstacles){
      const fromAbove = player.y + player.h > o.y && player.y + player.h < o.y + 16 && player.vy >= 0;
      const horizontal = player.x + player.w > o.x && player.x < o.x + o.w;
      if(fromAbove && horizontal){
        player.y = o.y - player.h; player.vy=0; player.onGround=true;
        player.jumps = CONFIG.doubleJump?2:1;
      }
    }
  }

  // コイン取得
  function collectCoins(){
    for(let i=coins.length-1;i>=0;i--){
      const c = coins[i];
      const nx = Math.max(player.x, Math.min(c.x, player.x+player.w));
      const ny = Math.max(player.y, Math.min(c.y, player.y+player.h));
      if((nx-c.x)**2 + (ny-c.y)**2 <= c.r**2){
        coins.splice(i,1);
        score += 100;
        beep(1200,80,'sine',0.25); // 取得SE
      }
    }
  }

  // 敵ヒット
  function collideEnemies(){
    if(invincible>0){ invincible--; return; }
    const box = {x:player.x,y:player.y,w:player.w,h:player.h};
    for(const e of enemies){
      if(hit(box,e)){
        lives -= CONFIG.enemyDamage;
        invincible = CONFIG.iFrames;
        flash = 10;
        beep(200,120,'square',0.3); // 被弾SE
        if(lives<=0){ gameOver(); }
        break;
      }
    }
  }

  //========================
  // 入力
  //========================
  function press(){
    ensureAC(); // iOSの制限回避：初回タップでAudioContext作成
    if(state==='home') startGame();
    else if(state==='playing') player.jump();
    else if(state==='gameover') toHome();
  }
  window.addEventListener('touchstart', e=>{ e.preventDefault(); press(); }, {passive:false});
  window.addEventListener('mousedown', press);
  window.addEventListener('keydown', e=>{
    if(e.code==='Space' || e.code==='ArrowUp'){ e.preventDefault(); press(); }
  });

  //========================
  // 描画
  //========================
  function drawBG(){
    const g=ctx.createLinearGradient(0,0,0,window.innerHeight);
    g.addColorStop(0,'#0f2e0f'); g.addColorStop(1,'#071a07');
    ctx.fillStyle=g; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    // 地面
    ctx.fillStyle='var(--ground)';
    ctx.fillRect(0,GY(),window.innerWidth,window.innerHeight-GY());
  }
  function drawHUD(){
    const pad = padTop();
    ctx.fillStyle='var(--hud)'; ctx.fillRect(8,8+pad,CONFIG.hudWidth,60);
    ctx.fillStyle='var(--fg)'; ctx.font='700 18px monospace';
    ctx.fillText(`SCORE ${score|0}`, 16, 32+pad);
    ctx.fillText(`LIFE  ${lives}`, 16, 54+pad);
    ctx.textAlign='right';
    ctx.fillText(`${(distance|0)} m`, 8+CONFIG.hudWidth-10, 32+pad);
    ctx.textAlign='left';
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
      ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,Math.PI*2);
      ctx.fillStyle='#eaffab'; ctx.fill();
      ctx.beginPath(); ctx.arc(c.x,c.y,c.r*0.55,0,Math.PI*2);
      ctx.fillStyle='#93c953'; ctx.fill();
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
    ctx.textAlign='center';
    ctx.fillStyle='var(--accent)'; ctx.font='700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('わいちゃんRUN', window.innerWidth/2, 72);
    ctx.fillStyle='#fff'; ctx.font='26px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('タップ/スペースでスタート', window.innerWidth/2, window.innerHeight-100);
  }
  function drawGameOver(){
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    centerDraw(images.over,520);
    ctx.textAlign='center'; ctx.fillStyle='#fff';
    ctx.font='700 56px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('GAME OVER', window.innerWidth/2, 84);
    ctx.font='24px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText(`SCORE ${score|0}   /   ${distance|0} m`, window.innerWidth/2, window.innerHeight-84);
    ctx.fillText('タップでホームへ', window.innerWidth/2, window.innerHeight-44);
  }

  //========================
  // フロー
  //========================
  function toHome(){
    state='home';
    try{ overSE.pause(); overSE.currentTime=0; }catch{}
    try{ homeBGM.play().catch(()=>{});}catch{}
  }
  function startGame(){
    state='playing';
    try{ homeBGM.pause(); }catch{}
    try{ overSE.pause(); overSE.currentTime=0; }catch{}
    perf=0; score=0; distance=0; lives=CONFIG.livesStart; invincible=0; flash=0;
    speed=CONFIG.speedStart;
    player.reset(); obstacles.length=0; holes.length=0; coins.length=0; enemies.length=0;
  }
  function gameOver(){
    state='gameover';
    play(overSE);
  }

  //========================
  // ループ
  //========================
  function loop(ts){
    const dt = ts - last; last = ts;
    drawBG();

    if(state==='home'){
      drawHome();
    } else if(state==='playing'){
      distance += speed * 0.25;
      score    += speed * 0.35;

      updateWorld();

      const cx = player.x + player.w/2;
      const over = isOverHole(cx);
      player.update(over);
      handlePlatforms();
      collectCoins();
      collideEnemies();

      drawHoles();
      drawObstacles();
      drawCoins();
      drawEnemies();

      // 無敵/被弾フラッシュ
      if(flash>0){ ctx.fillStyle='rgba(255,0,0,.25)'; ctx.fillRect(0,0,window.innerWidth,window.innerHeight); flash--; }

      player.draw();
      drawHUD();

    } else if(state==='gameover'){
      drawHoles(); drawObstacles(); drawCoins(); drawEnemies(); player.draw(); drawGameOver();
    }

    requestAnimationFrame(loop);
  }
})();
