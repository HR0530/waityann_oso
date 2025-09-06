(function () {
  'use strict';

  // ===== Assets =====
  const ASSETS = {
    penguinRun: './走り.PNG',
    homeImage:  './ホーム画面.PNG',
    gotHit:     './襲われた.PNG'
  };

  const canvas  = document.getElementById('game');
  const ctx     = canvas.getContext('2d');
  const homeBGM = document.getElementById('homeBGM');
  const overSE  = document.getElementById('overSE');

  // ===== Resize & HiDPI =====
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

  // ===== Load images =====
  const images = {};
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  Promise.all(Object.entries(ASSETS).map(async ([k, v]) => (images[k] = await loadImage(v))))
    .then(() => { toHome(); requestAnimationFrame(tick); });

  // ===== Game state =====
  let state = 'loading'; // home / playing / gameover
  let last = 0, perf = 0;
  let speed = 6, score = 0;
  let wallX = 0, wallSpeed = 5; // 後ろ壁

  // 物理
  function GY() { return window.innerHeight - 90; } // ground line
  const GRAVITY = () => Math.max(0.6, window.innerHeight * 0.00015);

  // ===== Helpers =====
  function hit(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }
  function centerDraw(img, maxW) {
    if (!img) return;
    const iw = Math.min(maxW, window.innerWidth * 0.86);
    const ratio = img.height / img.width;
    const w = iw, h = w * ratio;
    const x = (window.innerWidth  - w) / 2;
    const y = (window.innerHeight - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  // ===== Player (Penguin) =====
  const player = {
    w: 110, h: 85,
    x: 0, y: 0, vy: 0,
    onGround: true,
    reset() {
      this.w = Math.min(160, Math.max(90, Math.floor(window.innerWidth * 0.17)));
      this.h = Math.floor(this.w * 0.77);
      this.x = Math.floor(window.innerWidth * 0.28);
      this.y = GY() - this.h;
      this.vy = 0; this.onGround = true;
    },
    jump() {
      if (this.onGround) {
        this.vy = -Math.max(13, Math.min(18, window.innerHeight * 0.03));
        this.onGround = false;
      }
    },
    update() {
      this.vy += GRAVITY();
      this.y += this.vy;

      // 基本は地面で止まる（穴のときは後で上書き）
      if (this.y + this.h >= GY()) {
        this.y = GY() - this.h;
        this.vy = 0; this.onGround = true;
      }
    },
    draw() {
      const img = images.penguinRun;
      const bob = Math.sin(perf * 0.25) * 3;
      if (img) {
        // 右向きに反転表示（写真を中央寄せで綺麗に）
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(img, -this.x - this.w, this.y + bob, this.w, this.h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#6aff6a';
        ctx.fillRect(this.x, this.y, this.w, this.h);
      }
      // 土煙（雰囲気）
      if (this.onGround && (perf % 8) < 4) {
        ctx.fillStyle = 'rgba(200,255,200,.5)';
        ctx.beginPath();
        ctx.arc(this.x + this.w / 2, this.y + this.h, 6 + Math.random() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  // ===== Obstacles (足場・ブロック。ぶつかっても死なない) =====
  const obstacles = [];
  function spawnObstacle() {
    const w = 50 + Math.random() * 70;
    const h = 30 + Math.random() * 100;
    obstacles.push({ x: window.innerWidth + 20, y: GY() - h, w, h });
  }
  function updateObstacles() {
    for (const o of obstacles) { o.x -= speed; o.y = GY() - o.h; }
    while (obstacles.length && obstacles[0].x + obstacles[0].w < -60) obstacles.shift();
    if ((perf | 0) % 90 === 0) spawnObstacle();
  }
  function drawObstacles() {
    for (const o of obstacles) {
      ctx.fillStyle = '#228b22';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(o.x + 4, o.y + 4, o.w - 8, o.h - 8);
    }
  }

  // ===== Holes (落とし穴) =====
  const holes = [];
  function spawnHole() {
    const w = 110 + Math.random() * 140;
    holes.push({ x: window.innerWidth + 80, w });
  }
  function updateHoles() {
    for (const h of holes) h.x -= speed;
    while (holes.length && holes[0].x + holes[0].w < -60) holes.shift();
    if ((perf | 0) % 240 === 0) spawnHole();
  }
  function drawHoles() {
    ctx.fillStyle = '#000';
    for (const h of holes) ctx.fillRect(h.x, GY(), h.w, window.innerHeight - GY());
  }
  function isOverHole(pxCenter) {
    return holes.some(h => pxCenter > h.x && pxCenter < h.x + h.w);
  }

  // ===== Back Wall (後ろの壁) =====
  function resetWall() {
    wallX = Math.max(0, player.x - 140);   // プレイヤーより左に配置
    wallSpeed = 4.8;                        // 初速（ゲーム進行で上がる）
  }
  function updateWall() {
    // 距離に応じて徐々に加速（上限あり）
    wallSpeed = Math.min(12, wallSpeed + 0.0006);
    wallX += wallSpeed;
  }
  function drawWall() {
    ctx.fillStyle = 'var(--wall)';
    ctx.fillRect(0, 0, wallX, window.innerHeight);
  }

  // ===== Input =====
  function press() {
    if (state === 'home') startGame();
    else if (state === 'playing') player.jump();
    else if (state === 'gameover') toHome();
  }
  window.addEventListener('touchstart', e => { e.preventDefault(); press(); }, { passive: false });
  window.addEventListener('mousedown', press);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); press(); }
  });

  // ===== Drawing =====
  function drawBG() {
    const g = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
    g.addColorStop(0, '#0f2e0f');
    g.addColorStop(1, '#061906');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    // 地面
    ctx.fillStyle = '#164d16';
    ctx.fillRect(0, GY(), window.innerWidth, window.innerHeight - GY());
  }
  function drawHUD() {
    ctx.fillStyle = 'var(--hud-bg)';
    ctx.fillRect(8, 8, 160, 62);
    ctx.fillStyle = 'var(--fg)';
    ctx.font = '700 18px monospace';
    ctx.fillText(`SCORE ${score | 0}`, 16, 32);
    ctx.fillText(`SPEED ${speed.toFixed(1)}`, 16, 56);
  }

  function drawTitle() {
    centerDraw(images.homeImage, 520); // 写真を中央に大きく
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6aff6a';
    ctx.font = '700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('わいちゃんRUN', window.innerWidth / 2, 70);
    ctx.fillStyle = '#fff';
    ctx.font = '28px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('START', window.innerWidth / 2, window.innerHeight - 120);
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    centerDraw(images.gotHit, 520);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 56px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('GAME OVER', window.innerWidth / 2, 80);
    ctx.font = '24px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText(`SCORE ${score | 0}`, window.innerWidth / 2, window.innerHeight - 84);
    ctx.fillText('タップでホームへ', window.innerWidth / 2, window.innerHeight - 44);
  }

  // ===== Flow =====
  function toHome() {
    state = 'home';
    try { overSE.pause(); overSE.currentTime = 0; } catch {}
    // モバイルの自動再生保護対策：ユーザーの次のタップで再生できるようにする
    homeBGM.play().catch(()=>{ /* 初回は失敗してもOK。次の操作で再試行 */ });
  }
  function startGame() {
    state = 'playing';
    // サウンド切替
    try { homeBGM.pause(); } catch {}
    try { overSE.pause(); overSE.currentTime = 0; } catch {}

    perf = 0; score = 0; speed = 6;
    player.reset();
    obstacles.length = 0; holes.length = 0;
    resetWall();
  }
  function gameOver() {
    state = 'gameover';
    try { overSE.currentTime = 0; overSE.play().catch(()=>{}); } catch {}
  }

  function tick(ts) {
    const dt = ts - last; last = ts; perf += dt || 16.7;
    drawBG();

    if (state === 'home') {
      drawTitle();
      drawWall(); // 薄く背景として
    }
    else if (state === 'playing') {
      // 進行
      speed = Math.min(16, speed + 0.0010); // 少しずつ加速
      score += speed * 0.4;

      updateObstacles();
      updateHoles();
      updateWall();

      // プレイヤー更新（基礎）
      player.update();

      // 足場・障害物：上からなら乗れる／横からは軽く押し戻す
      let standingOnTop = false;
      for (const o of obstacles) {
        if (hit(player, o)) {
          const fromAbove = player.y + player.h <= o.y + 15 && player.vy >= 0;
          if (fromAbove) {
            player.y = o.y - player.h;
            player.vy = 0; player.onGround = true; standingOnTop = true;
          } else {
            // 横ヒット：少し右に寄せる（死なない）
            if (player.x + player.w/2 < o.x + o.w/2) {
              player.x = o.x - player.w - 1;
            } else {
              player.x = o.x + o.w + 1;
            }
          }
        }
      }

      // 穴の上にいるか（地面が消える）
      const cx = player.x + player.w/2;
      const overHole = isOverHole(cx);
      if (!standingOnTop) {
        if (overHole) {
          // 落下継続、画面下でゲームオーバー
          if (player.y + player.h >= window.innerHeight) gameOver();
          else player.onGround = false;
        } else {
          // 通常地面に吸着（保険）
          if (player.y + player.h > GY()) {
            player.y = GY() - player.h; player.vy = 0; player.onGround = true;
          }
        }
      }

      // 後ろ壁に押し潰されたらゲームオーバー
      if (wallX >= player.x) gameOver();

      // 描画
      drawHoles();
      drawObstacles();
      player.draw();
      drawWall();
      drawHUD();
    }
    else if (state === 'gameover') {
      drawHoles(); drawObstacles(); player.draw(); drawWall(); drawGameOver();
    }

    requestAnimationFrame(tick);
  }
})();
