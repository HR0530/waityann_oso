(function () {
  'use strict';

  // ====== ASSETS ======
  const ASSETS = {
    penguin: './走り.PNG',
    home:    './ホーム画面.PNG',
    over:    './襲われた.PNG',
    bearBg:  './追いかける.PNG' // 背景演出に薄く使用（ゲームロジック無関係）
  };

  const canvas  = document.getElementById('game');
  const ctx     = canvas.getContext('2d');
  const homeBGM = document.getElementById('homeBGM');
  const overSE  = document.getElementById('overSE');
  const stepSE  = document.getElementById('stepSE'); // 無くてもOK

  // ====== SIZE / HiDPI ======
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

  // ====== LOAD IMAGES ======
  const images = {};
  function loadImage(src) {
    return new Promise((resolve)=> {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  Promise.all(Object.entries(ASSETS).map(async ([k,v]) => (images[k] = await loadImage(v))))
    .then(()=> { toHome(); requestAnimationFrame(tick); });

  // ====== STATE ======
  let state = 'loading'; // home / playing / gameover
  let last = 0, perf = 0;
  let score = 0, best = Number(localStorage.getItem('wai_best')||0);
  let speed = 6; // world speed
  let lives = 3;
  let countdown = 0; // 開始前カウント
  const RND = (a,b)=> a + Math.random()*(b-a);

  const GROUND_Y = ()=> window.innerHeight - 90;
  const GRAVITY  = ()=> Math.max(0.6, window.innerHeight*0.00015);

  // ====== UTILS ======
  function hit(a,b){
    return !(a.x+a.w<b.x || a.x>b.x+b.w || a.y+a.h<b.y || a.y>b.y+b.h);
  }
  function centerDraw(img, maxW){
    if(!img) return;
    const iw = Math.min(maxW, window.innerWidth*0.86);
    const r  = img.height/img.width;
    const w=iw, h=w*r, x=(window.innerWidth-w)/2, y=(window.innerHeight-h)/2;
    ctx.drawImage(img,x,y,w,h);
  }
  function lerp(a,b,t){ return a+(b-a)*t; }

  // ====== PLAYER ======
  const player = {
    w: 110, h: 85,
    x: 0, y: 0, vy: 0,
    onGround: true,
    jumpsLeft: 2, // ダブルジャンプ
    coyote: 0,    // コヨーテタイム（フレーム）
    reset(){
      this.w = Math.min(170, Math.max(95, Math.floor(window.innerWidth*0.18)));
      this.h = Math.floor(this.w*0.77);
      this.x = Math.floor(window.innerWidth*0.26);
      this.y = GROUND_Y() - this.h;
      this.vy=0; this.onGround=true; this.jumpsLeft=2; this.coyote=0;
    },
    jump(){
      const canCoyote = this.coyote>0;
      if(this.onGround || this.jumpsLeft>0 || canCoyote){
        const power = Math.max(13, Math.min(19, window.innerHeight*0.032));
        this.vy = -power;
        this.onGround=false;
        if(!canCoyote && !this.onGround) this.jumpsLeft--;
        this.coyote=0;
      }
    },
    update(){
      this.vy += GRAVITY();
      this.y  += this.vy;

      // 地面
      if(this.y + this.h >= GROUND_Y()){
        if(!this.onGround && stepSE && stepSE.readyState>=2){
          try{ stepSE.currentTime=0; stepSE.play().catch(()=>{});}catch{}
        }
        this.y = GROUND_Y() - this.h;
        this.vy=0; this.onGround=true; this.jumpsLeft=2;
      } else {
        // 空中
        if(!this.onGround){
          this.coyote = Math.max(this.coyote-1, 0);
        }
      }
    },
    landOn(yTop){
      // 足場の上に乗る
      this.y = yTop - this.h; this.vy=0; this.onGround=true; this.jumpsLeft=2; this.coyote=0;
    },
    draw(){
      const img = images.penguin;
      const bob = Math.sin(perf*0.25)*3;
      if(img){
        ctx.save();
        ctx.scale(-1,1); // 右向きに反転
        ctx.drawImage(img, -this.x-this.w, this.y + bob, this.w, this.h);
        ctx.restore();
      }else{
        ctx.fillStyle='#6aff6a'; ctx.fillRect(this.x,this.y,this.w,this.h);
      }
      // 足元パーティクル（簡易）
      if(this.onGround && (perf%8)<4){
        ctx.fillStyle='rgba(200,255,200,.45)';
        ctx.beginPath();
        ctx.arc(this.x+this.w*0.5, this.y+this.h, 6+Math.random()*4, 0, Math.PI*2);
        ctx.fill();
      }
    }
  };

  // ====== WORLD ======
  const obstacles = []; // {x,y,w,h}
  const holes = [];     // {x,w}
  const coins = [];     // {x,y,r,vy}
  const hearts = [];    // {x,y,r,vy}  // 回復

  function spawnObstacle(){
    const w = 50 + Math.random()*80;
    const h = 30 + Math.random()*110;
    obstacles.push({ x: window.innerWidth + 40, y: GROUND_Y() - h, w, h });
  }
  function spawnHole(){
    const w = 120 + Math.random()*140;
    holes.push({ x: window.innerWidth + 100, w });
  }
  function spawnCoinRow(){
    const baseY = GROUND_Y() - RND(120, 220);
    const count = 4 + (Math.random()*3|0);
    for(let i=0;i<count;i++){
      coins.push({ x: window.innerWidth + 40 + i*36, y: baseY + Math.sin(i)*6, r: 10, vy: 0 });
    }
  }
  function spawnHeart(){
    if(Math.random()<0.15){ // 低確率
      const y = GROUND_Y() - RND(160, 240);
      hearts.push({ x: window.innerWidth + 120, y, r: 12, vy: 0 });
    }
  }

  function updateWorld(){
    // スピード徐々に上昇
    speed = Math.min(16, speed + 0.0012);

    // スポーン（難易度に応じて間隔を短く）
    if((perf|0) % Math.max(70, 120 - (score/50|0)) === 0) spawnObstacle();
    if((perf|0) % Math.max(180, 300 - (score/20|0)) === 0) spawnHole();
    if((perf|0) % Math.max(110, 180 - (score/30|0)) === 0) spawnCoinRow();
    if((perf|0) % 420 === 0) spawnHeart();

    // スクロール
    for(const o of obstacles){ o.x -= speed; o.y = GROUND_Y() - o.h; }
    for(const h of holes){     h.x -= speed; }
    for(const c of coins){     c.x -= speed; }
    for(const h of hearts){    h.x -= speed; }

    // 画面外掃除
    while(obstacles.length && obstacles[0].x+obstacles[0].w < -80) obstacles.shift();
    while(holes.length     && holes[0].x+holes[0].w     < -80) holes.shift();
    while(coins.length     && coins[0].x+coins[0].r     < -80) coins.shift();
    while(hearts.length    && hearts[0].x+hearts[0].r   < -80) hearts.shift();
  }

  // ====== COLLISIONS ======
  function playerHitBox(){ return {x:player.x,y:player.y,w:player.w,h:player.h}; }
  function isOverHole(cx){
    return holes.some(h => cx>h.x && cx<h.x+h.w);
  }

  // ====== INPUT ======
  function press(){
    if(state==='home') startGame();
    else if(state==='playing'){
      // コヨーテタイム付与：地面離れてすぐも許容
      if(player.onGround) player.coyote = 6;
      player.jump();
    }
    else if(state==='gameover') toHome();
  }
  window.addEventListener('touchstart', e=>{ e.preventDefault(); press(); }, {passive:false});
  window.addEventListener('mousedown', press);
  window.addEventListener('keydown', e=>{
    if(e.code==='Space'||e.code==='ArrowUp'){ e.preventDefault(); press(); }
  });

  // ====== DRAW ======
  function drawBG(){
    // グラデ（CSS側と同系色）
    const g = ctx.createLinearGradient(0,0,0,window.innerHeight);
    g.addColorStop(0,'#0f2e0f'); g.addColorStop(1,'#071a07');
    ctx.fillStyle = g; ctx.fillRect(0,0,window.innerWidth,window.innerHeight);

    // パララックスライン
    ctx.strokeStyle = 'rgba(170,255,170,.08)';
    ctx.lineWidth = 2;
    for(let i=0;i<5;i++){
      const y = GROUND_Y() - 40 - i*28;
      ctx.beginPath();
      ctx.moveTo(((perf*0.15 + i*140)%window.innerWidth)-window.innerWidth, y);
      ctx.lineTo(((perf*0.15 + i*140)%window.innerWidth)+window.innerWidth, y);
      ctx.stroke();
    }

    // 地面
    ctx.fillStyle = '#164d16';
    ctx.fillRect(0, GROUND_Y(), window.innerWidth, window.innerHeight - GROUND_Y());

    // 背景に薄く熊画像（演出のみ）
    if(images.bearBg){
      const iw = Math.min(300, window.innerWidth*0.5);
      const ih = iw * (images.bearBg.height/images.bearBg.width);
      ctx.globalAlpha = 0.08;
      ctx.drawImage(images.bearBg, 10, GROUND_Y()-ih, iw, ih);
      ctx.globalAlpha = 1;
    }
  }

  function drawObstacles(){
    for(const o of obstacles){
      ctx.fillStyle = '#228b22';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(o.x+4,o.y+4,o.w-8,o.h-8);
    }
  }
  function drawHoles(){
    ctx.fillStyle = '#000';
    for(const h of holes){
      ctx.fillRect(h.x, GROUND_Y(), h.w, window.innerHeight - GROUND_Y());
    }
  }
  function drawCoins(){
    for(const c of coins){
      // コイン（リング風）
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI*2);
      ctx.fillStyle = '#eaffab'; ctx.fill();
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r*0.55, 0, Math.PI*2);
      ctx.fillStyle = '#93c953'; ctx.fill();
    }
  }
  function drawHearts(){
    for(const h of hearts){
      // シンプルなハート
      ctx.save(); ctx.translate(h.x, h.y); ctx.scale(1,1);
      ctx.fillStyle = '#ff8ab0';
      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.bezierCurveTo(-12,-12,-26,10,0,22);
      ctx.bezierCurveTo(26,10,12,-12,0,0);
      ctx.fill();
      ctx.restore();
    }
  }
  function drawHUD(){
    ctx.fillStyle='var(--hud)'; ctx.fillRect(8,8,220,70);
    ctx.fillStyle='var(--fg)'; ctx.font='700 18px monospace';
    ctx.fillText(`SCORE ${score|0}`, 16, 32);
    ctx.fillText(`BEST  ${best|0}`,  16, 56);

    // ライフ表示
    for(let i=0;i<lives;i++){
      ctx.fillStyle='#ff8ab0';
      const x=160+i*18, y=22;
      ctx.beginPath(); ctx.moveTo(x,y);
      ctx.bezierCurveTo(x-6,y-6,x-14,y+4,x,y+10);
      ctx.bezierCurveTo(x+14,y+4,x+6,y-6,x,y);
      ctx.fill();
    }
  }

  function drawTitle(){
    centerDraw(images.home, 540);
    ctx.textAlign='center'; ctx.fillStyle='#6aff6a';
    ctx.font='700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('わいちゃんRUN', window.innerWidth/2, 68);
    ctx.fillStyle='#fff'; ctx.font='26px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('タップ/スペースでスタート', window.innerWidth/2, window.innerHeight-100);
  }
  function drawGameOver(){
    ctx.fillStyle='rgba(0,0,0,.6)';
    ctx.fillRect(0,0,window.innerWidth,window.innerHeight);
    centerDraw(images.over, 520);
    ctx.textAlign='center'; ctx.fillStyle='#fff';
    ctx.font='700 56px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('GAME OVER', window.innerWidth/2, 84);
    ctx.font='24px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText(`SCORE ${score|0}`, window.innerWidth/2, window.innerHeight-90);
    ctx.fillText('タップでホームへ', window.innerWidth/2, window.innerHeight-50);
  }
  function drawCountdown(){
    if(countdown<=0) return;
    ctx.textAlign='center'; ctx.fillStyle='#e6f5e6';
    ctx.font='700 56px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    const n = Math.ceil(countdown/60);
    ctx.fillText(n.toString(), window.innerWidth/2, window.innerHeight/2);
  }

  // ====== FLOW ======
  function toHome(){
    state='home';
    try{ overSE.pause(); overSE.currentTime=0; }catch{}
    homeBGM.play().catch(()=>{});
  }
  function startGame(){
    state='playing';
    try{ homeBGM.pause(); }catch{}
    try{ overSE.pause(); overSE.currentTime=0; }catch{}
    perf=0; score=0; speed=6; lives=3; countdown=120; // 2秒カウントダウン
    player.reset();
    obstacles.length=0; holes.length=0; coins.length=0; hearts.length=0;
  }
  function gameOver(){
    state='gameover';
    best = Math.max(best, score|0);
    try{ localStorage.setItem('wai_best', best); }catch{}
    try{ overSE.currentTime=0; overSE.play().catch(()=>{});}catch{}
  }

  // ====== LOOP ======
  function tick(ts){
    const dt = ts - last; last = ts; perf += dt || 16.7;
    drawBG();

    if(state==='home'){
      drawTitle();
    }
    else if(state==='playing'){
      if(countdown>0){
        countdown--;
        drawCountdown();
        // カウントダウン中も背景を見せる
      } else {
        // 進行
        score += speed*0.4;
        updateWorld();

        // プレイヤー更新の前に“穴”情報を見て接地処理を最終決定
        player.update();

        // 足場（上からだけ乗る）
        let onTop = false;
        const box = playerHitBox();
        for(const o of obstacles){
          if(hit(box,o)){
            const fromAbove = player.y + player.h <= o.y + 15 && player.vy >= 0;
            if(fromAbove){
              player.landOn(o.y);
              onTop = true;
              break;
            }
          }
        }

        // 穴の上なら地面無し→落下継続
        const cx = player.x + player.w/2;
        if(!onTop && isOverHole(cx)){
          if(player.y + player.h >= window.innerHeight){
            gameOver();
          }else{
            player.onGround=false; // 落下
          }
        }

        // 描画
        drawHoles();
        drawObstacles();

        // コイン・ハート
        drawCoins(); drawHearts();

        // 取得判定（円とAABBの簡易ヒット）
        for(let i=coins.length-1;i>=0;i--){
          const c=coins[i];
          const nx = Math.max(player.x, Math.min(c.x, player.x+player.w));
          const ny = Math.max(player.y, Math.min(c.y, player.y+player.h));
          if((nx-c.x)**2 + (ny-c.y)**2 <= (c.r)**2){
            score += 100; coins.splice(i,1);
          }
        }
        for(let i=hearts.length-1;i>=0;i--){
          const h=hearts[i];
          const nx = Math.max(player.x, Math.min(h.x, player.x+player.w));
          const ny = Math.max(player.y, Math.min(h.y, player.y+player.h));
          if((nx-h.x)**2 + (ny-h.y)**2 <= (h.r)**2){
            lives = Math.min(5, lives+1); hearts.splice(i,1);
          }
        }

        player.draw();
        drawHUD();

        // （任意の将来拡張）ライフ制イベント：ここで減らす場合は条件を書く
        // 今回は穴のみ即死。障害物は足場扱いで減らさない。
        if(lives<=0) gameOver();
      }

    }
    else if(state==='gameover'){
      drawHoles(); drawObstacles(); drawCoins(); drawHearts(); player.draw(); drawGameOver();
    }

    requestAnimationFrame(tick);
  }
})();
