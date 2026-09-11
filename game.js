(() => {
  'use strict';

  /* ================================================================
     BLIP'S BIG ADVENTURE — a tiny cute 2D platformer
     Built with plain HTML5 Canvas + vanilla JS. No external assets,
     no build step, no dependencies (see styles.css for the page CSS).

     Code map:
       1.  Canvas & physics constants
       2.  Persistence (localStorage: best time/score, furthest stage, mute)
       3.  Accessibility helpers (announcer, reduced motion)
       4.  Level manager — 10 procedurally-generated, progressively
           harder stages (platforms, coins, hazards, enemies, checkpoint)
       5.  Player object (incl. double-jump state)
       6.  Input handling (keyboard + on-screen touch controls)
       7.  Collision + physics update (incl. hazard/enemy collisions)
       8.  Sound (WebAudio beeps + procedural background music)
       9.  Particles (explosion effect)
       10. Rendering (background, level, hazards, enemies, particles, player)
       11. Main loop + UI wiring (start/pause/mute/win/continue)
     ================================================================ */


  // ---------------------------------------------------------------
  // 1. CANVAS & PHYSICS CONSTANTS
  // ---------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // internal game resolution (CSS scales it responsively)
  const H = canvas.height;

  const GRAVITY          = 0.62;   // downward acceleration per frame
  const MAX_FALL_SPEED   = 16;     // terminal velocity
  const WALK_ACCEL       = 0.5;
  const RUN_ACCEL        = 0.65;
  const WALK_MAX_SPEED   = 3.4;
  const RUN_MAX_SPEED    = 6.4;
  const GROUND_FRICTION  = 0.62;   // deceleration when no key held & grounded
  const AIR_FRICTION     = 0.3;    // gentler deceleration mid-air
  const JUMP_VELOCITY    = -13.2;  // initial upward velocity on jump
  const JUMP_CUT_FACTOR  = 0.45;   // releasing jump early shortens the hop
  const MAX_JUMPS        = 2;      // double jump: one from the ground, one in the air
  const JUMP_BUFFER_FRAMES = 8;    // a jump pressed just before landing still fires

  // Physics-derived safety bounds used by the level generator so
  // procedurally-placed platforms never demand an unfair/impossible leap.
  // These are deliberately generous heuristics (not exact projectile
  // math for a *chained* double jump) — see generateStage() below.
  const JUMP_APEX_T   = -JUMP_VELOCITY / GRAVITY;                    // frames to apex of one jump
  const JUMP_APEX_H   = 0.5 * GRAVITY * JUMP_APEX_T * JUMP_APEX_T;   // height gained by one jump
  const MAX_JUMP_DX   = Math.floor(RUN_MAX_SPEED * JUMP_APEX_T * 1.7); // safe horizontal gap (run + 2nd jump margin)
  const MAX_JUMP_RISE = Math.floor(JUMP_APEX_H * 1.4);                 // safe vertical rise (2nd jump margin)

  function randRange(a, b){ return a + Math.random() * (b - a); }


  // ---------------------------------------------------------------
  // 2. PERSISTENCE — best time, best score, furthest stage, mute
  // ---------------------------------------------------------------
  // Wrapped in try/catch: private-browsing modes and some embedded
  // webviews throw on localStorage access rather than just no-op'ing.
  const SAVE_KEY = 'blipsBigAdventure.v1';
  function loadSave(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch{ return {}; }
  }
  function writeSave(patch){
    try{
      const save = Object.assign(loadSave(), patch);
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      return save;
    }catch{ return Object.assign({}, patch); }
  }
  let save = loadSave();
  let muted = !!save.muted;


  // ---------------------------------------------------------------
  // 3. ACCESSIBILITY HELPERS
  // ---------------------------------------------------------------
  const srAnnouncer = document.getElementById('sr-announcer');
  let announceTimer = null;
  // Screen-reader status announcements. Debounced slightly so rapid
  // events (e.g. several coins in one second) don't spam a live region.
  function announce(text){
    if(!srAnnouncer) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { srAnnouncer.textContent = text; }, 60);
  }

  const reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reducedMotion = reducedMotionQuery ? reducedMotionQuery.matches : false;
  if(reducedMotionQuery){
    const onChange = (e) => { reducedMotion = e.matches; };
    if(reducedMotionQuery.addEventListener) reducedMotionQuery.addEventListener('change', onChange);
    else if(reducedMotionQuery.addListener) reducedMotionQuery.addListener(onChange); // Safari <14
  }


  // ---------------------------------------------------------------
  // 4. LEVEL MANAGER — 10 progressively harder stages
  // ---------------------------------------------------------------
  const GROUND_Y     = H - 90;     // y-coordinate of the top of the ground
  const TOTAL_STAGES = 10;

  const PLATFORM_PALETTE = [
    { color:'#ff9ecb', top:'#ffc4e0' },
    { color:'#9ecbff', top:'#c4e0ff' },
    { color:'#ffe39e', top:'#fff0c4' },
    { color:'#b7f0a8', top:'#d8f8ce' },
  ];

  const ENEMY_W = 30, ENEMY_H = 26;

  // Builds one stage's layout. Difficulty (level length, gap size,
  // platform count, hazard count, enemy count) scales up with stageNum
  // (1..10). Every generated gap/rise is clamped to MAX_JUMP_DX /
  // MAX_JUMP_RISE so a platform is never placed further away, or higher
  // up, than a well-timed run + double-jump can actually reach — no
  // "impossible" RNG layouts.
  function generateStage(stageNum){
    const levelWidth = 1700 + stageNum * 260;

    // --- Floating candy-colored platforms, staircased across the level ---
    const platformCount = 8 + stageNum;
    const minGap = 150 + stageNum * 8;   // gaps widen as stages progress
    const maxGap = 210 + stageNum * 12;
    const platforms = [];
    let x = 280;
    let prevY = GROUND_Y; // treat the ground as the first "surface" for the rise check
    for(let i=0; i<platformCount; i++){
      const w = Math.max(70, randRange(90, 150) - stageNum * 3);
      let y = GROUND_Y - randRange(90, 240 + stageNum * 6);
      if(prevY - y > MAX_JUMP_RISE) y = prevY - MAX_JUMP_RISE; // never an unreachable step up
      const palette = PLATFORM_PALETTE[i % PLATFORM_PALETTE.length];
      platforms.push({ x, y, w, h:28, color:palette.color, top:palette.top });
      const gap = Math.min(randRange(minGap, maxGap), MAX_JUMP_DX); // never an unreachable gap
      x += w + gap;
      prevY = y;
      if(x > levelWidth - 320) break;
    }

    // --- Collectible stars: one above most platforms, plus a few extra ---
    const coins = [];
    platforms.forEach(p => {
      if(Math.random() < 0.8){
        coins.push({ x:p.x + p.w/2, y:p.y - 40, r:11, collected:false, bob:Math.random()*Math.PI*2 });
      }
    });
    const extraCoins = 3 + Math.floor(stageNum / 2);
    for(let i=0; i<extraCoins; i++){
      coins.push({
        x:randRange(400, levelWidth - 400), y:GROUND_Y - randRange(80, 300),
        r:11, collected:false, bob:Math.random()*Math.PI*2,
      });
    }

    // --- Explosive hazards: none in stage 1, growing count afterwards.
    // Spaced at least minHazardGap apart so two hazards never merge into
    // an obstacle wider than a single jump can clear. ---
    const hazards = [];
    const hazardCount = Math.max(0, stageNum - 1);
    const minHazardGap = 220;
    let lastHazardX = -Infinity;
    for(let i=0; i<hazardCount; i++){
      let hx = randRange(500, levelWidth - 400);
      if(hx - lastHazardX < minHazardGap) hx = lastHazardX + minHazardGap;
      if(hx > levelWidth - 400) break; // out of room — fewer hazards beats an unfair cluster
      hazards.push({ x:hx, y:GROUND_Y - 24, w:34, h:24 });
      lastHazardX = hx;
    }

    // --- Patrolling enemies: introduced from stage 3 onward, on top of
    // an existing platform so their range is naturally bounded. Contact
    // from the side/below hurts like a hazard; landing on top defeats
    // them for a score bonus (classic "stomp"). ---
    const enemies = [];
    const enemyCount = stageNum >= 3 ? 1 + Math.floor((stageNum - 3) / 2) : 0;
    const candidatePlatforms = platforms.filter(p => p.w >= ENEMY_W + 20);
    for(let i=0; i<enemyCount && candidatePlatforms.length; i++){
      const p = candidatePlatforms[Math.floor(Math.random() * candidatePlatforms.length)];
      const minX = p.x + 6, maxX = p.x + p.w - 6 - ENEMY_W;
      const spawnX = randRange(minX, Math.max(minX, maxX));
      enemies.push({
        minX, maxX: Math.max(minX, maxX), spawnX,
        x:spawnX, y:p.y - ENEMY_H, w:ENEMY_W, h:ENEMY_H,
        dir: Math.random() < 0.5 ? 1 : -1, speed: randRange(0.9, 1.5), alive:true,
      });
    }

    const flagX = levelWidth - 120;
    // A fairness checkpoint roughly halfway through the stage: dying past
    // this point respawns you here instead of all the way at the start.
    const checkpointX = Math.round(levelWidth * 0.5);

    return { levelWidth, platforms, coins, hazards, enemies, flagX, checkpointX };
  }

  // Generate all 10 stages once up front, so replaying a stage after a
  // hazard death always shows the same layout instead of re-rolling it.
  const STAGES = [];
  for(let i = 1; i <= TOTAL_STAGES; i++) STAGES.push(generateStage(i));
  const TOTAL_COINS_ALL_STAGES = STAGES.reduce((sum, s) => sum + s.coins.length, 0);

  // --- Mutable "current stage" state, populated by loadStage() below ---
  let currentStageIndex = 0;   // 0-based
  let stage       = null;      // current stage's { levelWidth, platforms, coins, hazards, enemies, flagX, checkpointX }
  let ground      = null;
  let solids      = [];
  let LEVEL_WIDTH = 0;
  let FLAG_X      = 0;

  // Checkpoint state for the *current* stage attempt.
  let checkpointReached = false;
  let respawnX = 60;
  let checkpointCoinSnapshot = null; // which coins were collected as of the checkpoint

  // Decorative parallax elements (purely visual, no collision) — regenerated
  // per stage since each stage has a different level width.
  let cloudSpots = [];
  let dirtDots   = [];
  function generateDecor(levelWidth){
    cloudSpots = [];
    for(let i=0; i<16; i++){
      cloudSpots.push({ x:randRange(0,levelWidth), y:randRange(40,150), s:randRange(0.7,1.3) });
    }
    dirtDots = [];
    for(let i=0; i<260; i++){
      dirtDots.push({ x:randRange(0,levelWidth), y:randRange(GROUND_Y+30,H+20), r:randRange(2,5) });
    }
  }

  // Loads the given stage index: rebuilds solids/decor, resets the player,
  // camera and checkpoint, and refreshes the HUD. Used both for advancing
  // to the next stage and (via restartStage()) for replaying the current one.
  function loadStage(index){
    currentStageIndex = index;
    stage = STAGES[index];
    LEVEL_WIDTH = stage.levelWidth;
    FLAG_X = stage.flagX;
    ground = { x:0, y:GROUND_Y, w:LEVEL_WIDTH, h:(H-GROUND_Y)+60 };
    solids = [ground, ...stage.platforms];
    generateDecor(LEVEL_WIDTH);
    particles.length = 0;
    stage.enemies.forEach(e => { e.alive = true; e.x = e.spawnX; e.dir = Math.random() < 0.5 ? 1 : -1; });
    checkpointReached = false;
    respawnX = 60;
    checkpointCoinSnapshot = null;
    comboStreak = 0;
    resetPlayer();
    cameraX = 0;
    document.getElementById('stage-num').textContent = currentStageIndex + 1;
  }

  // Restarts the *current* stage after a hazard/enemy hit. Any coins
  // collected since the last checkpoint (or since stage start, if no
  // checkpoint was reached yet) are un-collected and their score is
  // refunded, so the score always matches what's actually still collected.
  // The player respawns at the checkpoint if one was reached, not always
  // all the way back at the start of the stage.
  function restartStage(){
    const keepCollected = checkpointCoinSnapshot; // null => nothing was collected-at-checkpoint yet
    let refunded = 0;
    stage.coins.forEach((c, i) => {
      const shouldStayCollected = keepCollected ? keepCollected[i] : false;
      if(c.collected && !shouldStayCollected) refunded++;
      c.collected = shouldStayCollected;
    });
    score = Math.max(0, score - refunded);
    document.getElementById('score').textContent = score;
    stage.enemies.forEach(e => { if(!checkpointReached){ e.alive = true; e.x = e.spawnX; } });
    comboStreak = 0;
    // Note: particles are intentionally NOT cleared here — restartStage()
    // is called right after triggerExplosion(), so the explosion debris
    // keeps animating at the death spot while the player reappears at
    // the checkpoint (or stage start).
    resetPlayer();
    player.x = respawnX;
    cameraX = Math.max(0, Math.min(respawnX - W/2, LEVEL_WIDTH - W));
  }


  // ---------------------------------------------------------------
  // 5. PLAYER
  // ---------------------------------------------------------------
  const player = {
    x:60, y:0, w:34, h:46,
    vx:0, vy:0,
    grounded:false,
    jumps:MAX_JUMPS, // remaining jump charges — refilled whenever grounded
    facing:1,        // 1 = facing right, -1 = facing left
    legPhase:0,      // drives the walk/run leg-bob animation
    squashT:0,       // 0..1 landing "squash" bounce timer
    blinkT:0,
    blinkTimer:randRange(2,5),
  };
  function resetPlayer(){
    player.x = 60; player.y = GROUND_Y - player.h;
    player.vx = 0; player.vy = 0;
    player.grounded = false; player.facing = 1;
    player.jumps = MAX_JUMPS;
    player.legPhase = 0; player.squashT = 0;
    jumpBufferTimer = 0;
  }

  let score = 0;
  let won = false;
  let cameraX = 0;
  let comboStreak = 0;
  let bestComboStreak = 0;
  let jumpBufferTimer = 0;
  let runStartTime = 0; // performance.now() when the run began, for the win-screen timer

  // Small non-blocking canvas banner shown for stage/checkpoint/combo events.
  let stageBannerTimer = 0;
  let stageBannerText = '';
  function showStageBanner(text){
    stageBannerText = text;
    stageBannerTimer = 90; // ~1.5s at 60fps
  }

  function formatTime(ms){
    const totalSec = Math.max(0, ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = (totalSec - m * 60).toFixed(1);
    return `${m}:${s.padStart(4,'0')}`;
  }


  // ---------------------------------------------------------------
  // 6. INPUT HANDLING — keyboard + on-screen touch controls
  // ---------------------------------------------------------------
  const keys = { left:false, right:false, jumpHeld:false, jumpReq:false, shift:false };

  window.addEventListener('keydown', (e) => {
    switch(e.code){
      case 'ArrowLeft':
        keys.left = true; e.preventDefault(); break;
      case 'ArrowRight':
        keys.right = true; e.preventDefault(); break;
      case 'ArrowUp':
      case 'Space':
        if(!keys.jumpHeld) keys.jumpReq = true; // only trigger on the initial press
        keys.jumpHeld = true;
        e.preventDefault();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.shift = true; break;
      case 'Escape':
        togglePause(); break;
      case 'KeyP':
        togglePause(); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    switch(e.code){
      case 'ArrowLeft':  keys.left = false; break;
      case 'ArrowRight': keys.right = false; break;
      case 'ArrowUp':
      case 'Space':      keys.jumpHeld = false; break;
      case 'ShiftLeft':
      case 'ShiftRight': keys.shift = false; break;
    }
  });

  // Generic "press and hold" wiring shared by every on-screen button:
  // pointer events cover touch, pen, and mouse in one code path.
  function bindHoldButton(el, onDown, onUp){
    if(!el) return;
    const down = (e) => { e.preventDefault(); el.classList.add('pressed'); onDown(); };
    const up   = (e) => { e.preventDefault(); el.classList.remove('pressed'); onUp(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindHoldButton(document.getElementById('touch-left'),
    () => { keys.left = true; keys.right = false; },
    () => { keys.left = false; });
  bindHoldButton(document.getElementById('touch-right'),
    () => { keys.right = true; keys.left = false; },
    () => { keys.right = false; });
  bindHoldButton(document.getElementById('touch-run'),
    () => { keys.shift = true; },
    () => { keys.shift = false; });
  bindHoldButton(document.getElementById('touch-jump'),
    () => { if(!keys.jumpHeld) keys.jumpReq = true; keys.jumpHeld = true; },
    () => { keys.jumpHeld = false; });


  // ---------------------------------------------------------------
  // 7. COLLISION + PHYSICS UPDATE
  // ---------------------------------------------------------------
  function aabbOverlap(a, b){
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // Horizontal and vertical movement are resolved as two separate
  // passes. This keeps collision simple and prevents the player from
  // getting stuck in corners (a common platformer pitfall).
  function moveX(dt){
    player.x += player.vx * dt;
    const box = { x:player.x, y:player.y, w:player.w, h:player.h };
    for(const s of solids){
      if(aabbOverlap(box, s)){
        if(player.vx > 0)      player.x = s.x - player.w; // hit from the left
        else if(player.vx < 0) player.x = s.x + s.w;       // hit from the right
        player.vx = 0;
        box.x = player.x;
      }
    }
    player.x = Math.max(0, Math.min(player.x, LEVEL_WIDTH - player.w));
  }

  function moveY(dt){
    player.y += player.vy * dt;
    player.grounded = false;
    const box = { x:player.x, y:player.y, w:player.w, h:player.h };
    for(const s of solids){
      if(aabbOverlap(box, s)){
        if(player.vy > 0){                 // falling -> land on top of solid
          player.y = s.y - player.h;
          if(player.vy > 8) player.squashT = 1; // big fall = juicy squash bounce
          player.vy = 0;
          player.grounded = true;
        } else if(player.vy < 0){          // rising -> bonk head on underside
          player.y = s.y + s.h;
          player.vy = 0;
        }
        box.y = player.y;
      }
    }
    // Touching ground always refills the double-jump charges.
    if(player.grounded) player.jumps = MAX_JUMPS;
  }

  function update(dt){
    // --- Horizontal movement ---
    const running  = keys.shift;
    const maxSpeed = running ? RUN_MAX_SPEED : WALK_MAX_SPEED;
    const accel    = running ? RUN_ACCEL     : WALK_ACCEL;

    if(keys.left && !keys.right){
      player.vx -= accel * dt;
      player.facing = -1;
    } else if(keys.right && !keys.left){
      player.vx += accel * dt;
      player.facing = 1;
    } else {
      // No horizontal input: decelerate smoothly toward a stop.
      const f = player.grounded ? GROUND_FRICTION : AIR_FRICTION;
      if(player.vx > 0)      player.vx = Math.max(0, player.vx - f * dt);
      else if(player.vx < 0) player.vx = Math.min(0, player.vx + f * dt);
    }
    player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx));

    // --- Jumping (double jump: allowed on the ground OR once more mid-air).
    // A press is buffered for JUMP_BUFFER_FRAMES so mashing jump a moment
    // before landing still fires the jump instead of being silently lost. ---
    if(keys.jumpReq) jumpBufferTimer = JUMP_BUFFER_FRAMES;
    keys.jumpReq = false;
    if(jumpBufferTimer > 0 && player.jumps > 0){
      player.vy = JUMP_VELOCITY;
      player.grounded = false;
      player.jumps -= 1;
      jumpBufferTimer = 0;
      // A slightly higher-pitched tone on the second (air) jump for feedback.
      playTone(player.jumps === MAX_JUMPS - 1 ? 660 : 880, 0.08, 'square', 0.05);
    }
    if(jumpBufferTimer > 0) jumpBufferTimer = Math.max(0, jumpBufferTimer - dt);

    // Variable jump height: letting go of the jump key early cuts the
    // upward velocity short, giving a smaller hop (like classic Mario).
    if(!keys.jumpHeld && player.vy < JUMP_VELOCITY * JUMP_CUT_FACTOR){
      player.vy = JUMP_VELOCITY * JUMP_CUT_FACTOR;
    }

    // --- Gravity ---
    player.vy += GRAVITY * dt;
    player.vy = Math.min(player.vy, MAX_FALL_SPEED);

    // --- Resolve movement & collisions ---
    moveX(dt);
    moveY(dt);

    // --- Cosmetic animation state ---
    if(player.grounded && Math.abs(player.vx) > 0.1){
      player.legPhase += Math.abs(player.vx) * 0.05 * dt;
    }
    if(player.squashT > 0) player.squashT = Math.max(0, player.squashT - 0.06 * dt);

    player.blinkTimer -= dt / 60;
    if(player.blinkTimer <= 0){ player.blinkT = 0.15; player.blinkTimer = randRange(2,5); }
    if(player.blinkT > 0) player.blinkT -= dt / 60;

    updateCamera(dt);
    updateParticles(dt);
    updateEnemies(dt);
    if(stageBannerTimer > 0) stageBannerTimer = Math.max(0, stageBannerTimer - dt);
    checkCoinCollection();
    checkCheckpoint();
    checkHazardCollision();
    checkEnemyCollision();
    checkWin();
  }

  function updateCamera(dt){
    const target = player.x + player.w/2 - W/2;
    cameraX += (target - cameraX) * Math.min(1, 0.15 * dt);
    cameraX = Math.max(0, Math.min(cameraX, LEVEL_WIDTH - W));
  }

  function checkCoinCollection(){
    for(const c of stage.coins){
      if(c.collected) continue;
      const dx = (player.x + player.w/2) - c.x;
      const dy = (player.y + player.h/2) - c.y;
      if(Math.hypot(dx, dy) < c.r + 18){
        c.collected = true;
        score++;
        comboStreak++;
        if(comboStreak > bestComboStreak) bestComboStreak = comboStreak;
        // Every 5-in-a-row without dying earns a small bonus — rewards
        // careful, uninterrupted play without requiring a strict route.
        if(comboStreak % 5 === 0){
          score += 2;
          showStageBanner(`Combo x${comboStreak}! +2 ⭐`);
          playTone(988, 0.12, 'triangle', 0.07);
          announce(`Combo times ${comboStreak}! Bonus 2 stars. Score ${score}.`);
        } else {
          announce(`Star collected. Score ${score} of ${TOTAL_COINS_ALL_STAGES}.`);
        }
        document.getElementById('score').textContent = score;
        playTone(880, 0.1, 'triangle', 0.06);
      }
    }
  }

  // Crossing the stage's halfway point sets a fairer respawn point: a
  // hazard/enemy death past here sends you back to the checkpoint, not
  // all the way to the start of the stage.
  function checkCheckpoint(){
    if(checkpointReached) return;
    if(player.x < stage.checkpointX) return;
    checkpointReached = true;
    respawnX = stage.checkpointX;
    checkpointCoinSnapshot = stage.coins.map(c => c.collected);
    showStageBanner('Checkpoint! 🚩');
    playTone(740, 0.1, 'sine', 0.05);
    announce('Checkpoint reached.');
  }

  // Explosive spike hazards: any overlap sends the player back to the
  // checkpoint (or stage start) with a bang and a burst of particles.
  function checkHazardCollision(){
    const box = { x:player.x, y:player.y, w:player.w, h:player.h };
    for(const hz of stage.hazards){
      if(aabbOverlap(box, hz)){
        triggerExplosion(player.x + player.w/2, player.y + player.h/2);
        playTone(55, 0.45, 'sawtooth', 0.16); // low-frequency "boom"
        announce('Ouch! Sent back to the last checkpoint.');
        restartStage();
        return; // player position just reset — nothing more to check this frame
      }
    }
  }

  // Patrolling enemies: landing on top defeats them (bonus points, a
  // little bounce); touching them from the side/below hurts like a hazard.
  function updateEnemies(dt){
    for(const e of stage.enemies){
      if(!e.alive) continue;
      e.x += e.dir * e.speed * dt;
      if(e.x < e.minX){ e.x = e.minX; e.dir = 1; }
      else if(e.x > e.maxX){ e.x = e.maxX; e.dir = -1; }
    }
  }

  function checkEnemyCollision(){
    const box = { x:player.x, y:player.y, w:player.w, h:player.h };
    for(const e of stage.enemies){
      if(!e.alive || !aabbOverlap(box, e)) continue;
      const stomped = player.vy > 0 && (player.y + player.h - player.vy) <= e.y + e.h * 0.5;
      if(stomped){
        e.alive = false;
        player.vy = JUMP_VELOCITY * 0.6;
        player.jumps = Math.max(player.jumps, 1);
        score += 3;
        document.getElementById('score').textContent = score;
        playTone(520, 0.1, 'square', 0.07);
        triggerExplosion(e.x + e.w/2, e.y + e.h/2, 10, ['#ffe066', '#fff3b0', '#ffffff']);
        announce(`Enemy defeated! Score ${score}.`);
      } else {
        triggerExplosion(player.x + player.w/2, player.y + player.h/2);
        playTone(55, 0.45, 'sawtooth', 0.16);
        announce('Ouch! Sent back to the last checkpoint.');
        restartStage();
        return;
      }
    }
  }

  function checkWin(){
    if(won || player.x + player.w < FLAG_X) return;

    if(currentStageIndex < TOTAL_STAGES - 1){
      // Stage clear — save progress, then load the next stage and keep playing.
      save = writeSave({ furthestStage: Math.max(save.furthestStage || 0, currentStageIndex + 2) });
      playTone(659, 0.1, 'triangle', 0.07);
      loadStage(currentStageIndex + 1);
      showStageBanner(`Stage ${currentStageIndex + 1}!`);
      announce(`Stage ${currentStageIndex + 1} of ${TOTAL_STAGES}.`);
    } else {
      // Final stage complete — show the win screen.
      won = true;
      const elapsed = performance.now() - runStartTime;
      const prevBestScore = save.bestScore || 0;
      const prevBestTime = save.bestTime || null;
      const isNewBestScore = score > prevBestScore;
      const isNewBestTime = !prevBestTime || elapsed < prevBestTime;
      save = writeSave({
        furthestStage: 0, // beating the game clears the in-progress checkpoint
        bestScore: Math.max(prevBestScore, score),
        bestTime: isNewBestTime ? elapsed : prevBestTime,
      });
      document.getElementById('win-stats').textContent =
        `You collected ${score} of ${TOTAL_COINS_ALL_STAGES} stars in ${formatTime(elapsed)} (best combo x${bestComboStreak})!`;
      document.getElementById('win-best').textContent =
        `${isNewBestScore ? '🏆 New best score! ' : ''}Best score: ${save.bestScore} · Best time: ${formatTime(save.bestTime)}`;
      document.getElementById('win-screen').classList.remove('hidden');
      announce(`You won! ${score} of ${TOTAL_COINS_ALL_STAGES} stars in ${formatTime(elapsed)}.`);
      playTone(523,0.12,'triangle',0.06);
      setTimeout(() => playTone(659,0.12,'triangle',0.06), 120);
      setTimeout(() => playTone(784,0.18,'triangle',0.06), 240);
    }
  }


  // ---------------------------------------------------------------
  // 8. SOUND — WebAudio beeps + a tiny procedural music loop
  // ---------------------------------------------------------------
  let audioCtx = null;
  function ensureAudioCtx(){
    if(!audioCtx){
      try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch{ /* unavailable */ }
    }
    return audioCtx;
  }
  function playTone(freq, duration, type, volume){
    if(muted) return;
    try{
      ensureAudioCtx();
      if(!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.value = volume || 0.06;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.stop(audioCtx.currentTime + duration + 0.02);
    } catch{ /* audio unavailable — fail silently */ }
  }

  // A gentle looping pentatonic arpeggio, entirely synthesized — no audio
  // files. musicGain's volume is what mute/unmute actually toggles, so
  // muting mid-note is instant instead of waiting for the note to end.
  const MUSIC_NOTES = [523, 659, 784, 659, 587, 784, 659, 523];
  let musicGain = null;
  let musicNoteIndex = 0;
  let musicTimerId = null;
  function scheduleMusic(){
    if(!gameRunning || won) { musicTimerId = null; return; }
    if(!paused && audioCtx && musicGain){
      const freq = MUSIC_NOTES[musicNoteIndex % MUSIC_NOTES.length];
      musicNoteIndex++;
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(musicGain);
      osc.start();
      const t = audioCtx.currentTime;
      osc.stop(t + 0.5);
    }
    musicTimerId = setTimeout(scheduleMusic, 420);
  }
  function startMusic(){
    ensureAudioCtx();
    if(!audioCtx) return;
    if(!musicGain){
      musicGain = audioCtx.createGain();
      musicGain.gain.value = muted ? 0 : 0.045;
      musicGain.connect(audioCtx.destination);
    }
    if(musicTimerId === null) scheduleMusic();
  }
  function stopMusic(){
    if(musicTimerId !== null){ clearTimeout(musicTimerId); musicTimerId = null; }
  }
  function applyMuteToAudioGraph(){
    if(musicGain) musicGain.gain.value = muted ? 0 : 0.045;
  }


  // ---------------------------------------------------------------
  // 9. PARTICLES — explosion / defeat effects
  // ---------------------------------------------------------------
  let particles = [];
  const EXPLOSION_COLORS = ['#ff6b3b', '#ffb03b', '#fff23b', '#ff3b3b'];

  function triggerExplosion(x, y, count, colors){
    // Reduced-motion players get a much smaller, shorter-lived burst
    // instead of none at all, so the moment still reads without the
    // full flurry of motion.
    const n = count || (reducedMotion ? 8 : 28);
    const palette = colors || EXPLOSION_COLORS;
    for(let i=0; i<n; i++){
      const angle = Math.random() * Math.PI * 2;
      const speed = randRange(2, 7) * (reducedMotion ? 0.5 : 1);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1,
        decay: randRange(0.02, 0.045) * (reducedMotion ? 1.6 : 1),
        size: randRange(2, 5),
        color: palette[Math.floor(Math.random() * palette.length)],
      });
    }
  }

  function updateParticles(dt){
    for(let i = particles.length - 1; i >= 0; i--){
      const p = particles[i];
      p.vy += 0.25 * dt; // debris falls under gravity too
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if(p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles(){
    for(const p of particles){
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }


  // ---------------------------------------------------------------
  // 10. RENDERING
  // ---------------------------------------------------------------
  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }
  function roundRectCentered(cx, cy, w, h, r){
    roundRect(cx - w/2, cy - h/2, w, h, r);
  }

  function drawSky(){
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,   '#7ec8ff'); // bright sky blue
    grad.addColorStop(0.7, '#bfe8ff');
    grad.addColorStop(1,   '#eaf9ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // A cheerful sun in the corner.
    ctx.save();
    ctx.translate(W - 90, 80);
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawClouds(){
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for(const c of cloudSpots){
      const sx = c.x - cameraX * 0.4; // slow parallax drift
      if(sx < -120 || sx > W + 120) continue;
      ctx.save();
      ctx.translate(sx, c.y);
      ctx.scale(c.s, c.s);
      ctx.beginPath();
      ctx.arc(0, 0, 20, Math.PI*0.5, Math.PI*1.5);
      ctx.arc(18, -14, 16, Math.PI, Math.PI*2);
      ctx.arc(40, 0, 20, Math.PI*1.5, Math.PI*0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawHills(){
    ctx.fillStyle = '#9be89b';
    const parallax = 0.6;
    for(let i=0; i < Math.ceil(LEVEL_WIDTH/400)+1; i++){
      const hx = i*400 - cameraX*parallax;
      if(hx < -260 || hx > W + 260) continue;
      ctx.beginPath();
      ctx.ellipse(hx, GROUND_Y+40, 220, 110, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  function drawGround(){
    // Dirt body.
    ctx.fillStyle = '#c68a4e';
    ctx.fillRect(0, GROUND_Y, LEVEL_WIDTH, (H-GROUND_Y)+60);
    // Bright green grass strip on top.
    ctx.fillStyle = '#7ed957';
    ctx.fillRect(0, GROUND_Y, LEVEL_WIDTH, 26);
    // Scalloped grass edge for a soft, cute silhouette.
    ctx.fillStyle = '#8fe86a';
    for(let x=0; x<LEVEL_WIDTH; x+=36){
      ctx.beginPath();
      ctx.arc(x+18, GROUND_Y+2, 18, Math.PI, 0);
      ctx.fill();
    }
    // Dirt speckles for texture (precomputed positions).
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for(const d of dirtDots){
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI*2); ctx.fill();
    }
  }

  function drawPlatforms(){
    for(const p of stage.platforms){
      // soft drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      roundRect(p.x+3, p.y+6, p.w, p.h, 12); ctx.fill();
      // candy-colored body
      ctx.fillStyle = p.color;
      roundRect(p.x, p.y, p.w, p.h, 12); ctx.fill();
      // glossy top highlight
      ctx.fillStyle = p.top;
      roundRect(p.x+4, p.y+4, p.w-8, p.h*0.4, 8); ctx.fill();
      // little grass sprigs poking out the top
      ctx.font = '16px serif';
      ctx.fillText('🌿', p.x+8, p.y-2);
      ctx.fillText('🌿', p.x+p.w-24, p.y-2);
    }
  }

  // Explosive hazards, drawn as a row of red spikes over a dark base.
  function drawHazards(){
    for(const hz of stage.hazards){
      const spikeW = 12;
      const count = Math.max(1, Math.round(hz.w / spikeW));
      const w = hz.w / count;

      ctx.fillStyle = '#8a1414';
      ctx.fillRect(hz.x, hz.y + hz.h - 4, hz.w, 4);

      ctx.fillStyle = '#ff3b3b';
      for(let i=0; i<count; i++){
        const sx = hz.x + i * w;
        ctx.beginPath();
        ctx.moveTo(sx, hz.y + hz.h);
        ctx.lineTo(sx + w/2, hz.y);
        ctx.lineTo(sx + w, hz.y + hz.h);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawEnemies(t){
    for(const e of stage.enemies){
      if(!e.alive) continue;
      const cx = e.x + e.w/2, cy = e.y + e.h/2;
      const wobble = Math.sin(t/150 + e.x) * 2;
      ctx.save();
      ctx.translate(cx, cy + wobble);
      ctx.scale(e.dir, 1);
      // body
      ctx.fillStyle = '#b988ff';
      roundRectCentered(0, 0, e.w, e.h, 12);
      ctx.fill();
      // eyebrow + eye (facing direction), gives a readable "watch out" look
      // that doesn't rely on color alone.
      ctx.strokeStyle = '#3a2e2e'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(11, -9); ctx.stroke();
      ctx.fillStyle = '#3a2e2e';
      ctx.beginPath(); ctx.arc(8, -2, 3, 0, Math.PI*2); ctx.fill();
      // little feet
      ctx.fillStyle = '#8a5fd6';
      ctx.beginPath(); ctx.ellipse(-6, e.h/2-3, 5, 4, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(6,  e.h/2-3, 5, 4, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }

  function drawCoins(t){
    for(const c of stage.coins){
      if(c.collected) continue;
      const bobY   = c.y + Math.sin(t/300 + c.bob) * 4;
      const spin   = Math.abs(Math.sin(t/260 + c.bob));
      ctx.save();
      ctx.translate(c.x, bobY);
      ctx.scale(0.4 + spin*0.6, 1); // fake a spinning-coin effect
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath(); ctx.arc(0, 0, c.r, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffec99';
      ctx.beginPath(); ctx.arc(0, 0, c.r*0.55, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }

  function drawCheckpoint(){
    if(checkpointReached) return; // already claimed this attempt — no need to show it
    const cx = stage.checkpointX;
    const poleH = 120;
    ctx.strokeStyle = '#9c9c9c'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx, GROUND_Y); ctx.lineTo(cx, GROUND_Y - poleH); ctx.stroke();
    ctx.fillStyle = '#7ecbff';
    ctx.beginPath();
    ctx.moveTo(cx, GROUND_Y - poleH + 10);
    ctx.lineTo(cx + 30, GROUND_Y - poleH + 20);
    ctx.lineTo(cx, GROUND_Y - poleH + 30);
    ctx.closePath(); ctx.fill();
  }

  function drawFlag(){
    const poleH = 220;
    const baseY = GROUND_Y;
    ctx.strokeStyle = '#c9c9c9';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(FLAG_X, baseY);
    ctx.lineTo(FLAG_X, baseY - poleH);
    ctx.stroke();
    // gold ball on top
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath(); ctx.arc(FLAG_X, baseY - poleH, 10, 0, Math.PI*2); ctx.fill();
    // gently waving flag
    const wave = Math.sin(Date.now()/200) * 6;
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(FLAG_X, baseY - poleH + 16);
    ctx.lineTo(FLAG_X + 46 + wave, baseY - poleH + 30);
    ctx.lineTo(FLAG_X, baseY - poleH + 44);
    ctx.closePath(); ctx.fill();
  }

  function drawPlayer(){
    const cx = player.x + player.w/2;
    const cy = player.y + player.h/2;

    // Squash & stretch gives the jump a springy, cartoony feel. Toned
    // down for players who asked the OS for reduced motion.
    const motionScale = reducedMotion ? 0.4 : 1;
    let sx = 1, sy = 1;
    if(player.squashT > 0){
      sx = 1 + player.squashT * 0.35 * motionScale;
      sy = 1 - player.squashT * 0.35 * motionScale;
    } else if(!player.grounded){
      if(player.vy < -2){ sx = 1 - 0.12*motionScale; sy = 1 + 0.15*motionScale; }      // stretch going up
      else if(player.vy > 3){ sx = 1 + 0.12*motionScale; sy = 1 - 0.12*motionScale; }  // squash falling
    } else if(Math.abs(player.vx) > 0.2){
      const bob = Math.sin(player.legPhase) * 0.04 * motionScale;    // gentle run bob
      sy = 1 - Math.abs(bob); sx = 1 + Math.abs(bob) * 0.6;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(player.facing * sx, sy);

    const bw = player.w, bh = player.h;

    // little stepping feet
    const step = player.grounded ? Math.sin(player.legPhase) * 6 : 0;
    ctx.fillStyle = '#e88a3c';
    ctx.beginPath(); ctx.ellipse(-8, bh/2-4 - Math.max(0, step)*0.2, 8, 6, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8,  bh/2-4 + Math.max(0,-step)*0.2, 8, 6, 0, 0, Math.PI*2); ctx.fill();

    // rounded blob body
    ctx.fillStyle = '#ffb84c';
    roundRectCentered(0, 0, bw, bh, 16);
    ctx.fill();

    // ears
    ctx.beginPath(); ctx.arc(-bw/2+6, -bh/2+2, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bw/2-6,  -bh/2+2, 8, 0, Math.PI*2); ctx.fill();

    // rosy cheeks
    ctx.fillStyle = 'rgba(255,120,120,0.5)';
    ctx.beginPath(); ctx.arc(-bw/2+6, 4, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bw/2-6,  4, 5, 0, Math.PI*2); ctx.fill();

    // eyes (with an occasional cute blink)
    if(player.blinkT > 0){
      ctx.strokeStyle = '#3a2e2e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2,-4); ctx.lineTo(6,-4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10,-4); ctx.lineTo(-2,-4); ctx.stroke();
    } else {
      ctx.fillStyle = '#3a2e2e';
      ctx.beginPath(); ctx.arc(4,-4,3.4,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(-6,-4,3.4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(5,-5.5,1.2,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(-5,-5.5,1.2,0,Math.PI*2); ctx.fill();
    }

    // smile
    ctx.strokeStyle = '#a85a2b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 2, 5, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke();

    ctx.restore();
  }

  // Non-blocking "Stage N! / Checkpoint! / Combo!" banner drawn in screen
  // space (not affected by the camera), independent of overlay screens.
  function drawStageBanner(){
    if(stageBannerTimer <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, stageBannerTimer / 30);
    ctx.font = 'bold 40px "Baloo 2","Trebuchet MS",sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.strokeText(stageBannerText, W/2, 100);
    ctx.fillStyle = '#fff';
    ctx.fillText(stageBannerText, W/2, 100);
    ctx.restore();
  }

  function render(t){
    drawSky();
    drawClouds();
    drawHills();

    // Everything below scrolls together with the camera.
    ctx.save();
    ctx.translate(-cameraX, 0);
    drawGround();
    drawPlatforms();
    drawHazards();
    drawEnemies(t);
    drawCoins(t);
    drawCheckpoint();
    drawFlag();
    drawParticles();
    drawPlayer();
    ctx.restore();

    drawStageBanner();
  }


  // ---------------------------------------------------------------
  // 11. MAIN LOOP + UI WIRING
  // ---------------------------------------------------------------
  let lastTime = 0;
  let gameRunning = false;
  let paused = false;

  function loop(now){
    if(!lastTime) lastTime = now;
    let dt = (now - lastTime) / (1000/60); // normalize to "frames at 60fps"
    dt = Math.min(dt, 2.5);                // clamp so tab-switch lag doesn't teleport the player
    lastTime = now;

    if(gameRunning && !won && !paused) update(dt);
    render(now);

    requestAnimationFrame(loop);
  }

  function setMuted(next){
    muted = next;
    save = writeSave({ muted });
    applyMuteToAudioGraph();
    const btn = document.getElementById('mute-btn');
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-pressed', String(muted));
    btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }

  function togglePause(){
    if(!gameRunning || won) return;
    paused = !paused;
    document.getElementById('pause-screen').classList.toggle('hidden', !paused);
    document.getElementById('pause-btn').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
    announce(paused ? 'Game paused.' : 'Game resumed.');
    if(paused) stopMusic(); else startMusic();
  }

  // Auto-pause when the tab/window loses visibility, so stepping away
  // never results in an unfair hazard hit while you weren't looking.
  document.addEventListener('visibilitychange', () => {
    if(document.hidden && gameRunning && !won && !paused) togglePause();
  });

  document.getElementById('score-total').textContent = TOTAL_COINS_ALL_STAGES;
  document.getElementById('stage-total').textContent = TOTAL_STAGES;
  loadStage(0); // set up stage 1 before the first frame renders

  // Offer to continue a previous run if progress was saved.
  if(save.furthestStage && save.furthestStage > 1 && save.furthestStage <= TOTAL_STAGES){
    const continueBtn = document.getElementById('continue-btn');
    continueBtn.classList.remove('hidden');
    document.getElementById('continue-stage-num').textContent = save.furthestStage;
  }

  function beginRun(startIndex){
    document.getElementById('start-screen').classList.add('hidden');
    gameRunning = true;
    paused = false;
    runStartTime = performance.now();
    ensureAudioCtx();
    loadStage(startIndex);
    startMusic();
  }

  document.getElementById('start-btn').addEventListener('click', () => beginRun(0));
  document.getElementById('continue-btn').addEventListener('click', () => {
    beginRun(Math.min(TOTAL_STAGES, save.furthestStage) - 1);
  });

  document.getElementById('mute-btn').addEventListener('click', () => setMuted(!muted));
  setMuted(muted); // sync icon/label with the saved preference on load

  document.getElementById('pause-btn').addEventListener('click', togglePause);
  document.getElementById('resume-btn').addEventListener('click', togglePause);

  document.getElementById('restart-btn').addEventListener('click', () => {
    score = 0; won = false; bestComboStreak = 0; comboStreak = 0;
    STAGES.forEach(s => { s.coins.forEach(c => c.collected = false); s.enemies.forEach(e => { e.alive = true; e.x = e.spawnX; }); });
    loadStage(0);
    document.getElementById('score').textContent = '0';
    document.getElementById('win-screen').classList.add('hidden');
    gameRunning = true;
    paused = false;
    runStartTime = performance.now();
    startMusic();
  });

  requestAnimationFrame(loop);

  // Test-only hook: exposes generated level data and physics safety
  // constants so an external test suite can assert invariants (e.g. "no
  // platform gap exceeds what a jump can cross") without duplicating the
  // generation logic. Inert for real players — nothing reads this global
  // during normal play.
  window.__BLIP_TEST__ = { STAGES, MAX_JUMP_DX, MAX_JUMP_RISE, GROUND_Y, TOTAL_STAGES };
})();
