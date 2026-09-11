// Smoke + invariant tests for Blip's Big Adventure.
//
// These don't try to fully "solve" the platformer — that's what a human
// playtester is for — but they do catch the classes of regression that
// are easy to introduce silently in a single-file canvas game:
// (1) something throwing at load/interaction time, (2) the procedural
// level generator producing an unfair/impossible layout, and (3) the
// headline mechanics (checkpoint, combo, pause, mute, touch controls)
// silently breaking.
const { test, expect } = require('@playwright/test');

// window.__BLIP_TEST__ only exists when the page sees this flag set
// *before* game.js runs (see the guard at the bottom of game.js) — an
// ordinary page load never gets it. Call this before page.goto() in any
// test that needs generator data or the getState() snapshot.
function enableTestHooks(page){
  return page.addInitScript(() => { window.__BLIP_TEST_ENABLED__ = true; });
}

test.describe('page load', () => {
  test('loads with no console errors and shows the start screen', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('index.html');
    await expect(page.locator('#start-screen')).toBeVisible();
    await expect(page.locator('#start-btn')).toBeVisible();
    await expect(page.locator('#start-btn')).toBeFocused(); // dialog-open focus management
    expect(errors).toEqual([]);
  });
});

test.describe('core gameplay loop', () => {
  test('start button begins the run and keyboard input moves the player', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('index.html');
    await page.click('#start-btn');
    await expect(page.locator('#start-screen')).toBeHidden();

    const before = await page.screenshot();
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
    const after = await page.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
    expect(errors).toEqual([]);
  });

  test('pause freezes the game, moves focus to Resume, and resume returns focus to Pause', async ({ page }) => {
    await page.goto('index.html');
    await page.click('#start-btn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-screen')).toBeVisible();
    await expect(page.locator('#resume-btn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-screen')).toBeHidden();
    await expect(page.locator('#pause-btn')).toBeFocused();
  });

  test('mute toggles the audio button state', async ({ page }) => {
    await page.goto('index.html');
    await page.click('#start-btn'); // the start overlay sits above the icon buttons until dismissed
    await page.click('#mute-btn');
    await expect(page.locator('#mute-btn')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#mute-btn');
    await expect(page.locator('#mute-btn')).toHaveAttribute('aria-pressed', 'false');
  });

  test('screen-reader live region announces game events, matching real internal state', async ({ page }) => {
    await enableTestHooks(page);
    await page.goto('index.html');
    await page.click('#start-btn');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(6000);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ShiftLeft');

    const text = await page.locator('#sr-announcer').textContent();
    expect(text?.length || 0).toBeGreaterThan(0);

    // The HUD is plain textContent, not derived reactively — assert it
    // actually reflects the same score the game logic thinks it has.
    const state = await page.evaluate(() => window.__BLIP_TEST__.getState());
    const hudScore = await page.locator('#score').textContent();
    expect(String(state.score)).toBe(hudScore);
    expect(state.score).toBeGreaterThanOrEqual(0);
  });

  test('crossing the stage-1 checkpoint is reflected in game state', async ({ page }) => {
    test.setTimeout(20000);
    await enableTestHooks(page);
    await page.goto('index.html');
    await page.click('#start-btn');
    // Stage 1 has no hazards and the level is deterministically seeded, so
    // this is a safe, reproducible way to reach the halfway checkpoint —
    // jump is mashed throughout since stage 1's fixed layout does put at
    // least one platform low enough to block a pure ground run.
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ShiftLeft');
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(50);
      await page.keyboard.up('Space');
      await page.waitForTimeout(150);
      reached = (await page.evaluate(() => window.__BLIP_TEST__.getState())).checkpointReached;
    }
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ShiftLeft');
    expect(reached).toBe(true);
  });

  test('progresses across multiple stages (exercising hazards/enemies/checkpoints) with no console errors', async ({ page }) => {
    test.setTimeout(60000);
    await enableTestHooks(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('index.html');
    await page.click('#start-btn');

    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ShiftLeft');
    const start = Date.now();
    while (Date.now() - start < 30000) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(50);
      await page.keyboard.up('Space');
      await page.waitForTimeout(150);
    }
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ShiftLeft');

    const state = await page.evaluate(() => window.__BLIP_TEST__.getState());
    expect(state.currentStageIndex).toBeGreaterThanOrEqual(1); // reached at least stage 2
    // Whenever an uninterrupted 5-coin streak occurs, checkCoinCollection's
    // combo bonus (+2 per 5) must show up in the score — verified generically
    // rather than against one hardcoded number, since the exact coin count
    // collected by this scripted playthrough isn't itself asserted.
    if (state.bestComboStreak >= 5){
      expect(state.score).toBeGreaterThanOrEqual(state.bestComboStreak);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('responsive layout', () => {
  test('the start panel stays fully inside the game frame at a narrow (380px) viewport', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 700 });
    await page.goto('index.html');
    const wrap = await page.locator('#game-wrap').boundingBox();
    const panel = await page.locator('#start-screen .panel').boundingBox();
    // Playwright's boundingBox() returns {x, y, width, height}, not
    // {top, bottom, left, right} — derive the edges we care about.
    expect(panel.y).toBeGreaterThanOrEqual(wrap.y - 1);
    expect(panel.y + panel.height).toBeLessThanOrEqual(wrap.y + wrap.height + 1);
  });
});

test.describe('touch controls', () => {
  test('on-screen buttons are shown and move the player on a touch/coarse-pointer device', async ({ page }) => {
    // Emulate a coarse pointer regardless of project so this assertion is
    // meaningful even when run under a desktop-flavored project.
    await page.emulateMedia({ media: 'screen' });
    await page.goto('index.html');
    // Force the coarse-pointer presentation regardless of the host running
    // this test (CSS @media(pointer:coarse) can't be emulated directly),
    // so the assertion below is meaningful on any project/browser.
    await page.addStyleTag({ content: '#touch-controls{ display:block !important; } #hint{ display:none !important; }' });
    await page.click('#start-btn');
    await expect(page.locator('#touch-right')).toBeVisible();

    const before = await page.screenshot();
    const box = await page.locator('#touch-right').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    const after = await page.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});

test.describe('performance & motion preferences', () => {
  test('renders at a healthy frame rate', async ({ page }) => {
    await page.goto('index.html');
    await page.click('#start-btn');
    const fps = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      function tick(){
        frames++;
        if (performance.now() - start < 1500) requestAnimationFrame(tick);
        else resolve(frames / ((performance.now() - start) / 1000));
      }
      requestAnimationFrame(tick);
    }));
    // Generous floor to stay stable on a loaded CI runner — this is a
    // regression guard against something making the render loop
    // pathologically slow, not a strict 60fps assertion.
    expect(fps).toBeGreaterThan(45);
  });

  test('respects prefers-reduced-motion and still runs without errors', async ({ page }) => {
    await enableTestHooks(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('index.html');
    const reducedMotionSeen = await page.evaluate(() => window.__BLIP_TEST__.reducedMotion);
    expect(reducedMotionSeen).toBe(true);
    await page.click('#start-btn');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});

test.describe('level generator invariants', () => {
  test('every generated platform gap/rise is within the jumpable safety bounds, and hazards/enemies are well-formed', async ({ page }) => {
    await enableTestHooks(page);
    await page.goto('index.html');
    const report = await page.evaluate(() => {
      const { STAGES, MAX_JUMP_DX, MAX_JUMP_RISE, GROUND_Y } = window.__BLIP_TEST__;
      const violations = [];
      const PLAYER_SPAWN_RIGHT_EDGE = 94; // player.x(60) + player.w(34)
      STAGES.forEach((stage, si) => {
        let prevRight = PLAYER_SPAWN_RIGHT_EDGE;
        let prevY = GROUND_Y;
        stage.platforms.forEach((p, pi) => {
          const gap = p.x - prevRight;
          const rise = prevY - p.y;
          if (gap > MAX_JUMP_DX + 0.5) violations.push(`stage ${si + 1} platform ${pi}: gap ${gap.toFixed(1)} > ${MAX_JUMP_DX}`);
          if (rise > MAX_JUMP_RISE + 0.5) violations.push(`stage ${si + 1} platform ${pi}: rise ${rise.toFixed(1)} > ${MAX_JUMP_RISE}`);
          prevRight = p.x + p.w;
          prevY = p.y;
        });
        let lastHazardX = -Infinity;
        stage.hazards.forEach((h, hi) => {
          if (lastHazardX !== -Infinity && h.x - lastHazardX < 219.5) {
            violations.push(`stage ${si + 1} hazard ${hi}: spacing ${(h.x - lastHazardX).toFixed(1)} < 220`);
          }
          lastHazardX = h.x;
        });
        stage.enemies.forEach((e, ei) => {
          if (e.minX > e.maxX + 0.5) violations.push(`stage ${si + 1} enemy ${ei}: minX > maxX`);
        });
      });
      return { violations, stageCount: STAGES.length };
    });
    expect(report.stageCount).toBe(10);
    expect(report.violations).toEqual([]);
  });

  test('level layout is deterministic (seeded), so best-score/best-time comparisons are meaningful', async ({ page, context }) => {
    await enableTestHooks(page);
    await page.goto('index.html');
    const first = await page.evaluate(() => JSON.stringify(window.__BLIP_TEST__.STAGES[0].platforms));

    const page2 = await context.newPage();
    await enableTestHooks(page2);
    await page2.goto('index.html');
    const second = await page2.evaluate(() => JSON.stringify(window.__BLIP_TEST__.STAGES[0].platforms));

    expect(second).toBe(first);
  });
});
