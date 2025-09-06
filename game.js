(function () {
  'use strict';

  // ★画像ファイルは同じフォルダに置く
  const ASSETS = {
    penguinRun: './走り.PNG',       // ぺんぎん（走り）←写真は左向き想定なので描画時に反転
    bear:       './追いかける.PNG', // 熊 ←同じく反転
    gotHit:     './襲われた.PNG',
    homeImage:  './ホーム画面.PNG'
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ===== 端末サイズにフィット + 高精細 (DPR対応) =====
  function resize() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // CSS座標系で描けるように
    // 写真を綺麗に
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize);
  resize();

  // 論理サイズ（端末に依存せず比率で決める）
  function vw(px) { return px * canvas.width / window.innerWidth; }
  function vh(px) { return px * canvas.height / window.innerHeight; }

  // ===== 画像読込 =====
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

  // ===== ゲーム状態 =====
  let state = 'loading';            // home / playing / gameover
  let perf = 0, last = 0;
  let speed = 6;                    // スクロール速度
  let score = 0;
  let lives = 3;

  // 地面ライン（画面下からのオフセット）
  function groundY() { return window.innerHeight - 90; }

  // 反転描画（左右反転して右向きにする）
  function drawFlipped(img, x, y, w, h) {
    ctx.save();
    ctx.translate(x + w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  // プレイヤー（ペンギン）
  const player = {
    w: 120, h: 90,
    x: 0, y: 0, vy: 0,
    onGround: true,
    stunned: false, stunTimer: 0,
    reset() {
      this.w = Math.min(160, Math.max(90, Math.floor(window.innerWidth * 0.18)));
      this.h = Math.floor(this.w * 0.75);
      this.x = Math.floor(window.innerWidth * 0.26);
      this.y = groundY() - this.h;
      this.vy = 0; this.onGround = true; this.stunned = false; this.stunTimer = 0;
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
        return;
      }
      this.vy += Math.max(0.6, window.innerHeight * 0.00015); // 重力
      this.y += this.vy;
      const gy = groundY();
      if (this.y + this.h >= gy) {
        this.y = gy - this.h;
        this.vy = 0; this.onGround = true;
      }
    },
    draw() {
      const img = images.penguinRun;
      const bob = Math.sin(perf * 0.02) * 2;
      if (img) drawFlipped(img, this.x, this.y + bob, this.w, this.h);
      else { ctx.fillStyle = '#a6f0c5'; ctx.fillRect(this.x, this.y, this.w, this.h); }
    }
  };

  // 追いかける熊（常にプレイヤーに近づく）
  const bear = {
    w: 180, h: 120,
    x: 0, y: 0, vx: 0,
    reset() {
      this.w = Math.min(240, Math.max(120, Math.floor(window.innerWidth * 0.28)));
      this.h = Math.floor(this.w * 0.67);
      this.x = Math.max(10, Math.floor(player.x - this.w - 60)); // 少し離す
      this.y = groundY() - this.h;
      this.vx = 0;
    },
    update() {
      // 理想的な距離（プレイヤーの後ろにキープ）。スタン中は詰める。
      const targetGap = player.stunned ? 20 : Math.max(80, player.w * 0.9);
      const targetX = player.x - targetGap - this.w;
      // 追いつき速度：基礎 + 距離比例（近づくほど遅くなる）
      const base = speed * 0.25;
      const toward = (targetX - this.x) * 0.04;
      this.vx = base + toward;
      this.x += this.vx;
      this.y = groundY() - this.h;
    },
    draw() {
      const img = images.bear;
      if (img) drawFlipped(img, this.x, this.y, this.w, this.h);
      else { ctx.fillStyle = '#333'; ctx.fillRect(this.x, this.y, this.w, this.h); }
    }
  };

  // 障害物
  const obstacles = [];
  function spawnObstacle() {
    const w = 40 + Math.random() * 50;
    const h = 30 + Math.random() * 90;
    obstacles.push({ x: window.innerWidth + 20, y: groundY() - h, w, h, solid: true });
  }
  function updateObstacles() {
    const s = speed;
    for (const o of obstacles) { o.x -= s; o.y = groundY() - o.h; }
    while (obstacles.length && obstacles[0].x + obstacles[0].w < -40) obstacles.shift();
    if ((perf | 0) % 90 === 0) spawnObstacle();
  }
  function drawObstacles() {
    for (const o of obstacles) {
      ctx.fillStyle = '#8b9bb8';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(o.x + 4, o.y + 4, o.w - 8, o.h - 8);
    }
  }

  function hit(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }

  // ===== 入力 =====
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

  // ===== 画面描画 =====
  function drawBG() {
    const g = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
    g.addColorStop(0, '#172033');
    g.addColorStop(1, '#0c121e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // 地面
    ctx.fillStyle = '#24304a';
    ctx.fillRect(0, groundY(), window.innerWidth, window.innerHeight - groundY());
  }
  function drawHUD() {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = '700 18px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText(`SCORE ${score | 0}`, 16, 28);
    ctx.fillText(`LIFE  ${lives}`, 16, 52);
  }
  function drawTitle() {
    if (images.homeImage) {
      const iw = Math.min(420, window.innerWidth * 0.8);
      const ih = iw * 0.57;
      ctx.drawImage(images.homeImage, (window.innerWidth - iw) / 2, 100, iw, ih);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 48px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('わいちゃんRUN', window.innerWidth / 2, 60);

    // ボタン
    const bw = 260, bh = 60, x = (window.innerWidth - bw) / 2, y = window.innerHeight - 140;
    ctx.fillStyle = '#1f2a44';
    roundRect(x, y, bw, bh, 14); ctx.fill();
    ctx.fillStyle = '#8dd3ff';
    ctx.font = '700 26px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('START', window.innerWidth / 2, y + 40);
    hotzones.start = { x, y, w: bw, h: bh };

    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.font = '16px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('タップ/スペースでジャンプ', window.innerWidth / 2, window.innerHeight - 20);
  }
  function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    if (images.gotHit) {
      const iw = Math.min(480, window.innerWidth * 0.86);
      const ih = iw * 0.56;
      ctx.drawImage(images.gotHit, (window.innerWidth - iw) / 2, 90, iw, ih);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 56px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText('GAME OVER', window.innerWidth / 2, 68);

    ctx.font = '700 26px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillStyle = '#8dd3ff';
    ctx.fillText('タップでホームへ', window.innerWidth / 2, window.innerHeight - 40);

    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '20px system-ui,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif';
    ctx.fillText(`SCORE ${score | 0}`, window.innerWidth / 2, window.innerHeight - 80);
  }
  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // クリックホットゾーン（ホームのSTART）
  const hotzones = { start: null };
  canvas.addEventListener('click', (e) => {
    if (state !== 'home') return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const hz = hotzones.start;
    if (hz && px >= hz.x && px <= hz.x + hz.w && py >= hz.y && py <= hz.y + hz.h) startGame();
  });

  // ===== 進行 =====
  function startGame() {
    state = 'playing';
    speed = 6; score = 0; lives = 3; perf = 0;
    player.reset(); bear.reset(); obstacles.length = 0;
  }
  function goHome() { state = 'home'; }
  function gameOver() { state = 'gameover'; }

  function tick(ts) {
    const dt = ts - last; last = ts; perf += dt || 16.7;
    drawBG();

    if (state === 'home') {
      drawTitle();
    } else if (state === 'playing') {
        // スピード・スコア
        speed = Math.min(14, speed + 0.0009);
        score += speed * 0.4;

        // ワールド更新
        updateObstacles();
        player.update();
        bear.update();

        // 衝突（障害物）：正面から当たるとスタン＆ライフ減
        for (const o of obstacles) {
          if (hit(player, o)) {
            if (!player.stunned) {
              lives--;
              player.stunned = true;
              player.stunTimer = 60; // 約1秒動けない
              if (lives <= 0) { gameOver(); }
            }
          }
        }

        // 熊との当たり：ゲームオーバー
        const bearBox = { x: bear.x, y: bear.y, w: bear.w, h: bear.h };
        const playerBox = { x: player.x, y: player.y, w: player.w, h: player.h };
        if (hit(playerBox, bearBox)) gameOver();

        // 描画
        drawObstacles();
        player.draw();
        bear.draw();
        drawHUD();
    } else if (state === 'gameover') {
        drawObstacles();
        player.draw();
        bear.draw();
        drawGameOver();
    }
    requestAnimationFrame(tick);
  }
})();
