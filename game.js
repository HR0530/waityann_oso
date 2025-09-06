(function () {
  'use strict';

  // ===== Assets =====
  const ASSETS = {
    penguinRun: './走り.PNG',
    bear: './追いかける.PNG',
    gotHit: './襲われた.PNG',
    homeImage: './ホーム画面.PNG'
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const runSE = document.getElementById('runSE');

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
    .then(() => { state = 'home'; requestAnimationFrame(tick); });

  // ===== Game state =====
  let state = 'loading'; // home / playing / gameover
  let last = 0, perf = 0;
  let speed = 6, score = 0, lives = 3;
  let invincible = 0;    // スタート直後の無敵タイム（フレーム数）

  function groundY() { return window.innerHeight - 90; }

  // ===== Helpers =====
  function hit(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }
  function centerDraw(img, maxW) {
    // ホーム/ゲームオーバー用：中央に綺麗に表示
    if (!img) return;
    const iw = Math.min(maxW, window.innerWidth * 0.86);
    const ratio = img.height / img.width;
    const w = iw;
    const h = w * ratio;
    const x = (window.innerWidth  - w) / 2;
    const y = (window.innerHeight - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  // ===== Player (Penguin) =====
  const player = {
    w: 110, h: 85,
    x: 180, y: 0, vy: 0,
    onGround: true,
    stunned: false, stunTimer: 0,
    reset() {
      this.w = Math.min(160, Math.max(90, Math.floor(window.innerWidth * 0.17)));
      this.h = Math.floor(this.w * 0.77);
      this.x = Math.floor(window.innerWidth * 0.28);
      this.y = groundY() - this.h;
      this.vy = 0; this.onGround = true;
      this.stunned = false; this.stunTimer = 0;
    },
    jump() {
      if (this.onGround && !this.stunned) {
        this.vy = -Math.max(13, Math.min(18, window.innerHeight * 0.03));
        this.onGround = false;
      }
    },
    update() {
      if (this.stunned) {
        this.stunTimer--;
        if (this.stunTimer <= 0) this.stunned = false;
      } else {
        this.vy += Math.max(0.6, window.innerHeight * 0.00015);
        this.y += this.vy;
      }
      // 地面との接地（後で穴と足場を考慮して最終決定）
      const gy = groundY();
      if (this.y + this.h >= gy) {
        if (!this.onGround) {
          // 着地SE（「たたたー」）
          runSE.currentTime = 0;
          runSE.play().catch(()=>{});
        }
        this.y = gy - this.h;
        this.vy = 0; this.onGround = true;
      }
    },
    draw() {
      const img = images.penguinRun;
      const bob = Math.sin(perf * 0.25) * 3;
      if (img) {
        ctx.save();
        ctx.scale(-1, 1); // 右向きに反転
        ctx.drawImage(img, -this.x - this.w, this.y + bob, this.w, this.h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#6aff6a';
        ctx.fillRect(this.x, this.y, this.w, this.h);
      }
      // 土煙（足元エフェクト）
      if (this.onGround && !this.stunned && perf % 8 < 4) {
        ctx.fillStyle = 'rgba(200,255,200,.5)';
        ctx.beginPath();
        ctx.arc(this.x + this.w / 2, this.y + this.h, 6 + Math.random() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  // ===== Bear (Chaser) =====
  const bear = {
    w: 170, h: 115,
    x: 30, y: 0,
    reset() {
      this.w = Math.min(240, Math.max(120, Math.floor(window.innerWidth * 0.26)));
      this.h = Math.floor(this.w * 0.68);
      this.x = Math.max(10, Math.floor(player.x - this.w - 140)); // 十分後ろから
      this.y = groundY() - this.h;
    },
    update() {
      // 目標位置：プレイヤーの少し後ろ
      const targetGap = player.stunned ? 30 : Math.max(90, player.w * 0.9);
      const targetX = player.x - targetGap - this.w;
      this.x += (targetX - this.x) * 0.06;
      this.y = groundY() - this.h;
    },
    draw() {
      const img = images.bear;
      if (img) ctx.drawImage(img, this.x, this.y, this.w, this.h); // 反転しない
      else { ctx.fillStyle = '#2c3'; ctx.fillRect(this.x, this.y, this.w, this.h); }
    }
  };

  // ===== Obstacles (足場にもなる) =====
  const obstacles = [];
  function spawnObstacle() {
    const w = 40 + Math.random() * 50;
    const h = 30 + Math.random() * 90;
    obstacles.push({ x: window.innerWidth + 20, y: groundY() - h, w, h });
  }
  function updateObstacles() {
    for (const o of obstacles) { o.x -= speed; o.y = groundY() - o.h; }
    while (obstacles.length && obstacles[0].x + obstacles[0].w < -40) obstacles.shift();
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
    const w = 110 + Math.random() * 120;
    holes.push({ x: window.innerWidth + 60, w });
  }
  function updateHoles() {
    for (const h of holes) h.x -= speed;
    while (holes.length && holes[0].x + holes[0].w < -40) holes.shift();
    if ((perf | 0) % 240 === 0) spawnHole();
  }
  function drawHoles() {
    ctx.fillStyle = '#000';
    for (const h of holes) ctx.fillRect(h.x, groundY(), h.w, window.innerHeight - groundY());
  }
  function isOverHole(pxCenter) {
    return holes.some(h => pxCenter > h.x && pxCenter < h.x + h.w);
  }

  // ===== Input =====
  function press() {
    if (state === 'home') startGame();
    else if (state === 'playing') player.jump();
    else if (state === 'gameover') goHome();
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
    ctx.fillStyle = '#164d16';
    ctx.fillRect(0, groundY(), window.innerWidth, window.innerHeight - groundY());
  }

  function drawHUD() {
    ctx.fillStyle = 'var(--hud-bg)';
    ctx.fillRect(8, 8, 158, 62);
    ctx.fillStyle = 'var(--fg)';
    ctx.font = '700 18px monospace';
    ctx.fillText(`SCORE ${score | 0}`, 16, 32);
    ctx.fillText(`LIFE  ${lives}`, 16, 56);
    // 無敵中は点滅表示
    if (invincible > 0 && (perf % 400) < 200) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#6aff6a';
      ctx.fillText('READY!', window.innerWidth - 16, 32);
      ctx.textAlign = 'left';
    }
  }

  function drawTitle() {
    centerDraw(images.homeImage, 480);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6aff6a';
    ctx.font = '700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('わいちゃんRUN', window.innerWidth / 2, 64);
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
    ctx.fillText(`SCORE ${score | 0}`, window.innerWidth / 2, window.innerHeight - 80);
    ctx.fillText('タップでホームへ', window.innerWidth / 2, window.innerHeight - 40);
  }

  // ===== Flow =====
  function startGame() {
    state = 'playing';
    speed = 6; score = 0; lives = 3; perf = 0;
    invincible = 60; // 約1秒
    player.reset();
    bear.reset();
    obstacles.length = 0;
    holes.length = 0;
  }
  function goHome() { state = 'home'; }
  function gameOver() { state = 'gameover'; }

  function tick(ts) {
    const dt = ts - last; last = ts; perf += dt || 16.7;
    drawBG();

    if (state === 'home') {
      drawTitle();
    } else if (state === 'playing') {
      // 難易度の自然な上昇
      speed = Math.min(14, speed + 0.0009);
      score += speed * 0.4;

      updateObstacles();
      updateHoles();

      // プレイヤー更新（基礎）
      player.update();

      // 足場衝突（上からだけ吸着）
      let onTop = false;
      for (const o of obstacles) {
        if (hit(player, o)) {
          const fromAbove = player.y + player.h <= o.y + 15 && player.vy >= 0;
          if (fromAbove) {
            player.y = o.y - player.h;
            player.vy = 0;
            player.onGround = true;
            onTop = true;
          } else if (invincible <= 0 && !player.stunned) {
            lives--;
            player.stunned = true;
            player.stunTimer = 60; // 1秒ほど動けない
            invincible = 30;       // 直後の連続ヒット防止
            if (lives <= 0) { gameOver(); }
          }
        }
      }

      // 穴（落とし穴）判定：中央xが穴上にあるときは地面がない
      const centerX = player.x + player.w / 2;
      const overHole = isOverHole(centerX);
      if (!onTop) {
        if (!overHole) {
          // 通常地面に吸着（update内で済むが、浮いてた場合の保険）
          if (player.y + player.h > groundY()) {
            player.y = groundY() - player.h;
            player.vy = 0; player.onGround = true;
          }
        } else {
          // 穴の上：地面なし→底まで落下
          if (player.y + player.h >= window.innerHeight) {
            gameOver();
          } else {
            player.onGround = false; // 落下継続
          }
        }
      }

      // 熊の追尾
      bear.update();

      // 無敵カウントダウン
      if (invincible > 0) invincible--;

      // 熊の当たり判定（無敵は貫通しない）：捕まったら終了
      if (invincible <= 0) {
        const bearBox = { x: bear.x, y: bear.y, w: bear.w, h: bear.h };
        const playerBox = { x: player.x, y: player.y, w: player.w, h: player.h };
        if (hit(playerBox, bearBox)) gameOver();
      }

      // 描画
      drawHoles();
      drawObstacles();
      player.draw();
      bear.draw();
      drawHUD();

    } else if (state === 'gameover') {
      drawHoles(); drawObstacles();
      player.draw(); bear.draw();
      drawGameOver();
    }

    requestAnimationFrame(tick);
  }
})();
