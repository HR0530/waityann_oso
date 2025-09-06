(() => {
  // ------- 基本設定 -------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // 描画クオリティ確保
  // 画面サイズ（論理 360x640 をベース）
  const W = 360, H = 640;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);

  // UI
  const overlay = document.getElementById('overlay');
  const homePanel = document.getElementById('home');
  const overPanel = document.getElementById('gameover');
  const scoreEl = document.getElementById('score');
  const lifeBox = document.getElementById('lifeBox');
  const btnMute = document.getElementById('btnMute');
  const btnPause = document.getElementById('btnPause');

  // ------- アセット -------
  const ASSETS = {
    home: './assets/ホーム画面.PNG',
    run: './assets/走り.PNG',
    chaser: './assets/追いかける.PNG',
    overImg: './assets/襲われた.PNG',
    s_home: './assets/home.mp3',
    s_run: './assets/tatata.mp3',
    s_over: './assets/over.mp3',
  };

  // 画像
  const imgRun = new Image();   imgRun.src = ASSETS.run;
  const imgChaser = new Image();imgChaser.src = ASSETS.chaser;

  // サウンド（ユーザー操作後に再生可）
  const sHome = new Audio(ASSETS.s_home); sHome.loop = true; sHome.volume = 0.65;
  const sRun  = new Audio(ASSETS.s_run);  sRun.loop  = true; sRun.volume  = 0.65;
  const sOver = new Audio(ASSETS.s_over); sOver.loop = false; sOver.volume = 0.8;

  let muted = false;
  const applyMute = () => {
    const vol = muted ? 0 : 1;
    [sHome, sRun, sOver].forEach(a => a.volume = (a === sOver ? 0.8 : 0.65) * vol);
    btnMute.textContent = muted ? '🔇' : '🔊';
  };

  // ------- ゲーム状態 -------
  const STATE = { HOME: 0, PLAY: 1, OVER: 2 };
  let state = STATE.HOME;

  // プレイヤー
  const player = {
    x: 40, y: H - 120, w: 64, h: 64,
    vy: 0, onGround: false, jumps: 0, maxJumps: 2,
    inv: 0, // 無敵時間フレーム
    speed: 2.4,
  };

  // スクロール/世界
  let scrollX = 0;
  const G = 0.5;
  const groundY = H - 80;
  const segments = []; // 地面セグメント(足場) {x, w, y}
  const holes = [];    // 穴 {x, w}
  const coins = [];    // {x,y,r,taken}
  const enemies = [];  // {x,y,w,h,vx, touched}

  // スコア/ライフ
  let score = 0;
  let life = 3;
  const updateHearts = () => {
    lifeBox.textContent = '❤️'.repeat(life) + '🤍'.repeat(Math.max(0, 3 - life));
  };

  // タイマ
  let spawnTimer = 0;      // 敵
  let coinTimer = 0;       // コイン
  let holeTimer = 0;       // 穴

  // 一時停止
  let paused = false;
  const setPause = (p) => {
    paused = p;
    btnPause.textContent = paused ? '▶︎' : '⏸';
  };

  // ------- ユーティリティ -------
  function rectsOverlap(a, b, shrink=0){
    return (a.x+shrink < b.x + b.w - shrink &&
            a.x+a.w-shrink > b.x + shrink &&
            a.y+shrink < b.y + b.h - shrink &&
            a.y+a.h-shrink > b.y + shrink);
  }

  function rand(min, max){ return Math.random()*(max-min)+min; }

  // ------- ステージ生成 -------
  function resetWorld(){
    scrollX = 0;
    segments.length = 0;
    holes.length = 0;
    coins.length = 0;
    enemies.length = 0;

    // 最初は安全地帯
    segments.push({x:0, w:800, y:groundY});

    // 先読みでいくつか生成
    let curX = 800;
    while(curX < 3000){
      placeChunk(curX);
      curX += 320;
    }
  }

  function placeChunk(xBase){
    // ランダムに穴 or 平地
    const makeHole = Math.random() < 0.35;
    if (makeHole){
      const w = rand(80, 140);
      holes.push({x:xBase + rand(40, 120), w});
      // 穴の前後に短い足場
      segments.push({x:xBase, w:120, y:groundY});
      segments.push({x:xBase + 120 + w, w:200, y:groundY});
    }else{
      segments.push({x:xBase, w:320, y:groundY});
    }

    // コイン列
    if (Math.random() < 0.8){
      const baseY = groundY - rand(90, 160);
      const n = Math.random()<0.5 ? 4 : 6;
      for(let i=0;i<n;i++){
        coins.push({x:xBase + 40 + i*28, y: baseY + Math.sin(i*0.9)*6, r:10, taken:false});
      }
    }
  }

  // ------- ゲーム開始/終了 -------
  function toHome(){
    state = STATE.HOME;
    setPause(false);
    overlay.classList.add('overlay');
    homePanel.classList.add('active');
    overPanel.classList.remove('active');
    score = 0; life = 3; updateHearts();
    player.x = 40; player.y = H - 120; player.vy = 0; player.onGround=false; player.jumps=0; player.inv=0;
    resetWorld();
    scoreEl.textContent = '0';

    // サウンド
    try{ sRun.pause(); sRun.currentTime = 0; }catch{}
    try{ sOver.pause(); sOver.currentTime = 0; }catch{}
    try{ if (!muted) sHome.play(); }catch{}
  }

  function startGame(){
    state = STATE.PLAY;
    setPause(false);
    homePanel.classList.remove('active');
    overPanel.classList.remove('active');

    // サウンド
    try{ sHome.pause(); }catch{}
    try{ if (!muted) sRun.play(); }catch{}
  }

  function gameOver(){
    state = STATE.OVER;
    overPanel.classList.add('active');

    // サウンド
    try{ sRun.pause(); }catch{}
    try{ sOver.currentTime = 0; if (!muted) sOver.play(); }catch{}
  }

  // ------- 入力 -------
  function doJump(){
    if (state !== STATE.PLAY || paused) return;
    if (player.jumps < player.maxJumps){
      player.vy = -9.6;
      player.onGround = false;
      player.jumps++;
    }
  }

  // キー/タッチ
  window.addEventListener('keydown', (e)=>{
    if (e.repeat) return;
    if (state === STATE.HOME && (e.code==='Space' || e.code==='Enter')){
      startGame();
    }else if (state === STATE.OVER && (e.code==='Space' || e.code==='Enter')){
      toHome();
    }else if (e.code === 'Space' || e.code === 'ArrowUp'){
      doJump();
    }
  });

  // 画面タップ
  const main = document.querySelector('main');
  main.addEventListener('pointerdown', ()=>{
    if (state === STATE.HOME){ startGame(); return; }
    if (state === STATE.OVER){ toHome(); return; }
    doJump();
  });

  // ミュート/ポーズ
  btnMute.addEventListener('click', ()=>{
    muted = !muted;
    applyMute();
  });
  btnPause.addEventListener('click', ()=>{
    if (state !== STATE.PLAY) return;
    setPause(!paused);
    if (paused){ try{sRun.pause();}catch{} }
    else { try{ if (!muted) sRun.play(); }catch{} }
  });

  // ------- アップデート/描画 -------
  let last = 0;
  function loop(t){
    requestAnimationFrame(loop);
    const dt = Math.min(32, t - last) || 16;
    last = t;
    if (state !== STATE.PLAY || paused) {
      draw(); // 停止中も描画維持
      return;
    }
    update(dt/16);
    draw();
  }

  function update(dt){
    // スクロール速度
    const worldSpeed = 3.2;

    // プレイヤー物理
    player.vy += G * dt;
    player.y += player.vy * dt;

    // 地面/足場コリジョン
    player.onGround = false;
    for (const s of segments){
      // 画面内に来るセグメントだけチェック
      if (s.x - scrollX > -200 && s.x - scrollX < W+200){
        // 足元衝突（簡易）
        const pxMid = player.x + player.w*0.5;
        if (pxMid > s.x - scrollX && pxMid < s.x - scrollX + s.w){
          const topY = s.y - player.h;
          if (player.y >= topY - 4 && player.vy >= 0){
            player.y = topY;
            player.vy = 0;
            player.onGround = true;
            player.jumps = 0;
          }
        }
      }
    }

    // 穴落ち判定
    let onAnyGround = false;
    const pxMid = player.x + player.w*0.5;
    for (const s of segments){
      if (pxMid > s.x - scrollX && pxMid < s.x - scrollX + s.w){
        onAnyGround = true; break;
      }
    }
    for (const h of holes){
      if (pxMid > h.x - scrollX && pxMid < h.x - scrollX + h.w){
        onAnyGround = false; break;
      }
    }
    if (!onAnyGround && player.y > H){ // 落下
      gameOver();
      return;
    }

    // スクロール前進
    scrollX += worldSpeed * dt;

    // セグメント補充＆古い要素掃除
    if (segments.length){
      const maxX = Math.max(...segments.map(s=>s.x+s.w));
      if (maxX - scrollX < 1200){
        placeChunk(maxX + 80);
      }
    }
    // 古い削除
    const limitX = scrollX - 200;
    for (let arr of [segments, holes, coins, enemies]){
      for (let i=arr.length-1;i>=0;i--){
        const obj = arr[i];
        const ox = (obj.x || 0);
        if (ox + (obj.w || 0) < limitX) arr.splice(i,1);
      }
    }

    // コイン
    coinTimer += dt;
    for (const c of coins){
      if (c.taken) continue;
      const pb = {x:player.x+8, y:player.y+8, w:player.w-16, h:player.h-16};
      const cb = {x:c.x - scrollX - c.r, y:c.y - c.r, w:c.r*2, h:c.r*2};
      if (rectsOverlap(pb, cb, 0)){
        c.taken = true;
        score += 10;
        scoreEl.textContent = String(score);
      }
    }

    // 敵出現
    spawnTimer -= dt;
    if (spawnTimer <= 0){
      spawnTimer = rand(120, 220); // フレーム間隔 だいたい2〜3.5秒
      const y = groundY - 48;
      enemies.push({x: scrollX + W + 40, y: y, w:48, h:48, vx: - (2.4 + Math.random()*1.8), touched:false});
    }
    // 敵移動 & 当たり
    for (const e of enemies){
      e.x += e.vx * dt;
      // 緩めの当たり判定（pb縮小）
      const pb = {x:player.x+10, y:player.y+12, w:player.w-20, h:player.h-24};
      const eb = {x:e.x - scrollX, y:e.y, w:e.w, h:e.h};
      if (player.inv <= 0 && rectsOverlap(pb, eb, 2)){
        life = Math.max(0, life - 1);
        updateHearts();
        player.inv = 70; // 無敵
        if (life <= 0){ gameOver(); return; }
      }
    }
    if (player.inv > 0) player.inv -= dt;

    // スコア微増（走行距離）
    score += 0.1 * dt;
    scoreEl.textContent = String(Math.floor(score));
  }

  function draw(){
    // 背景（空はCSS、ここでは地平・雲的スクロール）
    ctx.clearRect(0,0,W,H);

    // パララックス雲
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#ffffff';
    for(let i=0;i<6;i++){
      const x = (i*160 - (scrollX*0.3)%160);
      ctx.beginPath();
      ctx.ellipse(x, 120 + (i%3)*24, 40, 18, 0, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 地面
    ctx.fillStyle = '#2a9d50';
    ctx.fillRect(0, groundY+40, W, H - (groundY+40));
    // 足場（芝）
    for (const s of segments){
      const sx = s.x - scrollX;
      if (sx > W || sx + s.w < -10) continue;
      ctx.fillStyle = '#3bbf63';
      ctx.fillRect(sx, s.y, s.w, 12);
      ctx.fillStyle = '#6b4f2a';
      ctx.fillRect(sx, s.y+12, s.w, 40);
    }
    // 穴（暗い）
    for (const h of holes){
      const hx = h.x - scrollX;
      if (hx > W || hx + h.w < -10) continue;
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(hx, groundY+12, h.w, 60);
    }

    // コイン
    for (const c of coins){
      if (c.taken) continue;
      const cx = c.x - scrollX;
      if (cx < -20 || cx > W+20) continue;
      // 簡易コイン描画
      ctx.save();
      ctx.translate(cx, c.y);
      const t = performance.now()/300;
      ctx.rotate(Math.sin(t+cx*0.02)*0.2);
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath(); ctx.arc(0,0,c.r,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#e6b800'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#e6b800';
      ctx.fillRect(-2, -c.r+4, 4, c.r*2-8);
      ctx.restore();
    }

    // 敵
    for (const e of enemies){
      const ex = e.x - scrollX;
      if (ex < -80 || ex > W+80) continue;
      if (imgChaser.complete){
        ctx.drawImage(imgChaser, ex, e.y, e.w, e.h);
      }else{
        ctx.fillStyle = '#ff4c4c';
        ctx.fillRect(ex, e.y, e.w, e.h);
      }
    }

    // プレイヤー（走り.PNGを左右反転して右向きに）
    ctx.save();
    const px = player.x, py = player.y;
    if (imgRun.complete){
      ctx.translate(px + player.w/2, py + player.h/2);
      ctx.scale(-1, 1); // 左右反転 → 右向き
      // 無敵点滅
      if (player.inv > 0 && Math.floor(player.inv*4)%2===0) ctx.globalAlpha = 0.4;
      ctx.drawImage(imgRun, -player.w/2, -player.h/2, player.w, player.h);
    }else{
      ctx.translate(px, py);
      ctx.fillStyle = player.inv>0 ? 'rgba(255,255,255,.4)' : '#4ca3ff';
      ctx.fillRect(0,0,player.w,player.h);
    }
    ctx.restore();

    // 画面端グラデ（見栄え）
    const grd = ctx.createLinearGradient(0,0,0,64);
    grd.addColorStop(0,'rgba(0,0,0,.25)'); grd.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.fillRect(0,0,W,64);
  }

  // ------- 初期化 -------
  function init(){
    applyMute();
    toHome();
    requestAnimationFrame(loop);
  }

  // 起動
  init();
})();
