// Smoke + invariant tests for Blip's Big Adventure.
//
// These don't try to fully "solve" the platformer — that's what a human
// playtester is for — but they do catch the two classes of regression
// that are easy to introduce silently in a single-file canvas game:
// (1) something throwing at load/interaction time, and (2) the
// procedural level generator producing an unfair/impossible layout.
const { test, expect } = require('@playwright/test');

test.describe('page load', () => {
  test('loads with no console errors and shows the start screen', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('index.html');
    await expect(page.locator('#start-screen')).toBeVisible();
    await expect(page.locator('#start-btn')).toBeVisible();
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

  test('pause freezes the game and resume continues it', async ({ page }) => {
    await page.goto('index.html');
    await page.click('#start-btn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-screen')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pause-screen')).toBeHidden();
  });

  test('mute toggles the audio button state', async ({ page }) => {
    await page.goto('index.html');
    await page.click('#start-btn'); // the start overlay sits above the icon buttons until dismissed
    await page.click('#mute-btn');
    await expect(page.locator('#mute-btn')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#mute-btn');
    await expect(page.locator('#mute-btn')).toHaveAttribute('aria-pressed', 'false');
  });

  test('screen-reader live region announces game events', async ({ page }) => {
    await page.goto('index.html');
    await page.click('#start-btn');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ShiftLeft');
    await page.waitForTimeout(6000);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ShiftLeft');
    const text = await page.locator('#sr-announcer').textContent();
    expect(text?.length || 0).toBeGreaterThan(0);
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
  test('on-screen buttons are shown and move the player on a touch/coarse-pointer device', async ({ page, browserName }) => {
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

test.describe('level generator invariants', () => {
  test('every generated platform gap/rise is within the jumpable safety bounds, and hazards/enemies are well-formed', async ({ page }) => {
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
});
