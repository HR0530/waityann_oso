(function () {
  'use strict';

  // 画像ファイル
  const ASSETS = {
    penguinRun: './走り.PNG',
    bear: './追いかける.PNG',
    gotHit: './襲われた.PNG',
    homeImage: './ホーム画面.PNG'
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const runSE = document.getElementById('runSE');

  // サイズ調整
  function resize() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize);
  resize();

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

  let state = 'loading';
  let perf = 0, last = 0;
  let speed = 6;
  let score = 0;
  let lives = 3;

  function groundY() { return window.innerHeight - 90; }

  // プレイヤー（ペンギン）
  const player = {
    w: 100, h: 80,
    x: 150, y: 0, vy: 0,
    onGround: true,
    stunned: false, stunTimer: 0,
    reset() {
      this.x = 150;
      this.y = groundY() - this.h;
      this.vy = 0; this.onGround = true;
      this.stunned = false; this.stunTimer = 0;
    },
    jump() {
      if (this.onGround && !this.stunned) {
        this.vy = -15;
        this.onGround = false;
      }
    },
    update() {
      if (this.stunned) {
        this.stunTimer--;
        if (this.stunTimer <= 0) this.stunned = false;
        return;
      }
      this.vy += 0.7;
      this.y += this.vy;
      const gy = groundY();
      if (this.y + this.h >= gy) {
        if (!this.onGround) {
          // 地面に着地したら効果音
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
        ctx.drawImage(img, 0, 0, img.width, img.height, -this.x - this.w, this.y + bob, this.w, this.h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#6aff6a';
        ctx.fillRect(this.x, this.y, this.w, this.h);
      }
      // 土煙
      if (this.onGround && !this.stunned && perf % 8 < 4) {
        ctx.fillStyle = 'rgba(200,255,200,.5)';
        ctx.beginPath();
        ctx.arc(this.x + this.w / 2, this.y + this.h, 6 + Math.random() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  // 熊（反転なし）
  const bear = {
    w: 160, h: 110,
    x: 40, y: 0,
    reset() {
      this.x = 40;
      this.y = groundY() - this.h;
    },
    update() {
      const targetX = player.x - this.w - 60;
      this.x += (targetX - this.x) * 0.05;
      this.y = groundY() - this.h;
    },
    draw() {
      const img = images.bear;
      if (img) ctx.drawImage(img, this.x, this.y, this.w, this.h);
      else { ctx.fillStyle = '#333'; ctx.fillRect(this.x, this.y, this.w, this.h); }
    }
  };

  // 障害物
  const obstacles = [];
  function spawnObstacle() {
    const w = 40 + Math.random() * 50;
    const h = 30 + Math.random() * 80;
    obstacles.push({ x: window.innerWidth + 20, y: groundY() - h, w, h });
  }
  function updateObstacles() {
    for (const o of obstacles) o.x -= speed;
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

  // 穴
  const holes = [];
  function spawnHole() {
    const w = 100 + Math.random() * 100;
    holes.push({ x: window.innerWidth + 40, w });
  }
  function updateHoles() {
    for (const h of holes) h.x -= speed;
    while (holes.length && holes[0].x + holes[0].w < -40) holes.shift();
    if ((perf | 0) % 240 === 0) spawnHole();
  }
  function drawHoles() {
    ctx.fillStyle = '#000';
    for (const h of holes) {
      ctx.fillRect(h.x, groundY(), h.w, window.innerHeight - groundY());
    }
  }

  function hit(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }

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

  function drawBG() {
    const g = ctx.createLinearGradient(0, 0, 0, window.innerHeight);
    g.addColorStop(0, '#0f2e0f');
    g.addColorStop(1, '#061906');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.fillStyle = 'var(--ground)';
    ctx.fillRect(0, groundY(), window.innerWidth, window.innerHeight - groundY());
  }
  function drawHUD() {
    ctx.fillStyle = 'var(--hud-bg)';
    ctx.fillRect(8, 8, 140, 60);
    ctx.fillStyle = 'var(--fg)';
    ctx.font = '18px monospace';
    ctx.fillText(`SCORE ${score | 0}`, 16, 32);
    ctx.fillText(`LIFE  ${lives}`, 16, 56);
  }
  function drawTitle() {
    if (images.homeImage) {
      const iw = Math.min(420, window.innerWidth * 0.8);
      const ih = iw * 0.57;
      ctx.drawImage(images.homeImage, (window.innerWidth - iw) / 2, 100, iw, ih);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6aff6a';
    ctx.font = '700 48px sans-serif';
    ctx.fillText('わいちゃんRUN', window.innerWidth / 2, 60);
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.fillText('START', window.innerWidth / 2, window.innerHeight - 120);
  }
  function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    if (images.gotHit) {
      const iw = Math.min(480, window.innerWidth * 0.86);
      const ih = iw * 0.56;
      ctx.drawImage(images.gotHit, (window.innerWidth - iw) / 2, 90, iw, ih);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = '700 56px sans-serif';
    ctx.fillText('GAME OVER', window.innerWidth / 2, 70);
    ctx.fillText(`SCORE ${score | 0}`, window.innerWidth / 2, window.innerHeight - 80);
  }

  function startGame() {
    state = 'playing';
    score = 0; lives = 3; speed = 6; perf = 0;
    player.reset(); bear.reset();
    obstacles.length = 0; holes.length = 0;
  }
  function goHome() { state = 'home'; }
  function gameOver() { state = 'gameover'; }

  function tick(ts) {
    const dt = ts - last; last = ts; perf += dt || 16.7;
    drawBG();

    if (state === 'home') {
      drawTitle();
    } else if (state === 'playing') {
      speed = Math.min(14, speed + 0.0009);
      score += speed * 0.4;
      updateObstacles();
      updateHoles();
      player.update();
      bear.update();

      // 障害物判定
      for (const o of obstacles) {
        if (hit(player, o)) {
          const fromAbove = player.y + player.h <= o.y + 15 && player.vy >= 0;
          if (fromAbove) {
            player.y = o.y - player.h;
            player.vy = 0;
            player.onGround = true;
          } else if (!player.stunned) {
            lives--; player.stunned = true; player.stunTimer = 60;
            if (lives <= 0) gameOver();
          }
        }
      }
      // 穴に落ちたか
      if (holes.some(h => player.x + player.w/2 > h.x && player.x + player.w/2 < h.x + h.w)) {
        if (player.y + player.h >= window.innerHeight) gameOver();
      }
      // 熊に捕まった
      if (hit(player, bear)) gameOver();

      drawHoles();
      drawObstacles();
      player.draw();
      bear.draw();
      drawHUD();
    } else if (state === 'gameover') {
      drawObstacles(); drawHoles();
      player.draw(); bear.draw();
      drawGameOver();
    }
    requestAnimationFrame(tick);
  }
})();
