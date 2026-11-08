const { test, expect } = require('@playwright/test');

const post = {
  id: 106, revision: `wp:${'a'.repeat(64)}`, title: 'Wichtige Entwicklung',
  body: 'Eine freigegebene Kurzfassung.', published_at: '2026-11-06 10:00:00',
  categories: ['entwicklung'], tags: ['game-start', 'hero'],
};

async function prepare(page, rejection, { posts = [post], open = true } = {}) {
  const state = { posts, failedFeed: false, chunks: [] };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (url.pathname.endsWith('/developer_blog.php')) {
      if (action === 'list') {
        await route.fulfill(state.failedFeed
          ? { status: 503, json: { success: false, error: 'Blog derzeit nicht verfügbar.' } }
          : { json: { success: true, source: 'wordpress-simulation', editor_url: 'api/wordpress_sim.php', posts: state.posts } });
      } else {
        const chunk = route.request().postDataJSON().chunk;
        state.chunks.push(chunk);
        await route.fulfill(chunk === 0
          ? { json: { success: true, audio_url: `generated/tts/${'a'.repeat(64)}.mp3`, chunk: 0, chunks: 2 } }
          : { status: rejection, json: { success: false, error: 'Beitrag nicht mehr aktuell. Bitte Beiträge neu laden.' } });
      }
      return;
    }
    const data = action === 'csrf' ? { success: true, token: 'blog-test-csrf' }
      : action === 'me' ? { success: true, authenticated: false, user: null }
        : action === 'auth_stars' ? { success: true, stars: [], occupied_systems: [] }
          : url.pathname.endsWith('/server_announcements.php') ? { success: true, announcements: [] }
            : { success: true, enabled: false };
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  if (open) await page.locator('[data-start-panel="news"]').click();
  await expect(page.locator('.start-news-choice')).toHaveCount(posts.length);
  await page.evaluate(() => {
    window.__blogTestClips = [];
    window.__GQ_AUDIO_MANAGER = {
      snapshot: () => ({ masterMuted: false, ttsMuted: false, masterVolume: 1, ttsVolume: 1 }),
      playTtsAudio: () => {
        const clip = new EventTarget();
        clip.paused = false;
        clip.pause = () => { clip.paused = true; };
        window.__blogTestClips.push(clip);
        return clip;
      },
    };
  });
  return state;
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 400 }]) {
  test(`news choices stay usable inside the accordion at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await prepare(page, 409, {
      posts: [post, { ...post, id: 107, title: 'Zweite Nachricht', tags: [] }],
    });
    const dialog = page.getByRole('dialog', { name: 'News and transmissions' });
    const cards = dialog.locator('.start-news-choice');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toBeVisible();
    await cards.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#start-news-title')).toHaveText('Zweite Nachricht');
    await expect(page.locator('#start-news-title')).toBeFocused();
    await expect(page.locator('#start-news-title')).toBeInViewport();
    await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
    const dimensions = await dialog.evaluate(element => ({
      height: element.getBoundingClientRect().height,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      width: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    expect(dimensions.height).toBeGreaterThan(100);
    expect(dimensions.height).toBeLessThanOrEqual(viewport.height * 0.8 + 1);
    if (viewport.height === 400) expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewportWidth);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-start-panel="news"]')).toBeFocused();
    await expect(page.locator('#start-panel-news #start-news-posts .start-news-choice')).toHaveCount(2);
    await expect(page.locator('.start-news-choice').first()).toBeHidden();
    expect(await page.evaluate(() => window.__blogTestClips.length)).toBe(0);
  });
}

test('news cards only appear in the open news panel, including after switching panels', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await prepare(page, 409, {
    posts: [post, { ...post, id: 107, title: 'Zweite Nachricht', tags: [] }],
    open: false,
  });
  await expect(page.locator('#start-news-posts')).toBeHidden();
  await page.locator('[data-start-panel="settings"]').click();
  await expect(page.locator('#start-news-posts')).toBeHidden();
  await page.locator('[data-start-panel="news"]').click();
  await expect(page.locator('#start-news-posts')).toBeVisible();
  await page.locator('.start-news-choice').nth(1).click();
  await expect(page.getByRole('dialog', { name: 'News and transmissions' })).toBeVisible();
  await expect(page.locator('#start-news-title')).toHaveText('Zweite Nachricht');
  await expect(page.locator('#start-news-title')).toBeFocused();
  await expect(page.locator('[data-start-panel="settings"]')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.__blogTestClips.length)).toBe(0);
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }]) {
  test(`opening login closes news and hides its previews at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await prepare(page, 409);
    const news = page.locator('[data-start-panel="news"]');
    const cards = page.locator('#start-news-posts');
    await page.locator('#start-news-read').click();
    await expect.poll(() => page.evaluate(() => window.__blogTestClips.length)).toBe(1);
    await page.locator('#start-login').click();
    await expect(page.locator('#start-auth-dialog')).toBeVisible();
    await expect(page.locator('#login-username')).toBeFocused();
    await expect(news).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#start-content-dialog')).toBeHidden();
    await expect(cards).toBeHidden();
    expect(await page.evaluate(() => window.__blogTestClips[0].paused)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('#start-login')).toBeFocused();
    await expect(cards).toBeHidden();
    await news.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'News and transmissions' })).toBeVisible();
    await expect(cards).toBeVisible();
    await page.locator('#start-login').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#start-auth-dialog')).toBeVisible();
    await expect(news).toHaveAttribute('aria-expanded', 'false');
    await expect(cards).toBeHidden();
  });
}

for (const rejection of [404, 409]) {
  test(`section rejection ${rejection} blocks stale narration until refresh without autoplay`, async ({ page }) => {
    const state = await prepare(page, rejection);
    const read = page.locator('#start-news-read');
    const refresh = page.locator('#start-news-refresh');
    await read.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__blogTestClips.length)).toBe(1);
    await page.evaluate(() => window.__blogTestClips[0].dispatchEvent(new Event('ended')));
    await expect(page.locator('#start-news-status')).toContainText('nicht mehr aktuell');
    await expect(read).toBeDisabled();
    await expect(page.locator('#start-news-stop')).toBeDisabled();
    await expect(refresh).toBeFocused();
    expect(state.chunks).toEqual([0, 1]);
    state.failedFeed = true;
    await refresh.click();
    await expect(page.locator('#start-news-status')).toContainText('nicht verfügbar');
    await expect(read).toBeDisabled();
    state.failedFeed = false;
    state.posts = rejection === 404 ? [] : [{ ...post, revision: `wp:${'b'.repeat(64)}`, body: 'Aktualisierte Kurzfassung.' }];
    await refresh.click();
    await expect(page.locator('#start-news-title')).toHaveText(rejection === 404 ? 'Noch keine Beiträge veröffentlicht.' : post.title);
    if (rejection === 404) await expect(read).toBeDisabled();
    else {
      await expect(read).toBeEnabled();
      await expect(page.locator('#start-news-body')).toHaveText('Aktualisierte Kurzfassung.');
    }
    expect(await page.evaluate(() => window.__blogTestClips.length)).toBe(1);
    await page.locator('#start-login').click();
    await expect(page.locator('#login-form')).toBeVisible();
  });
}

test('refresh stops the current clip even when the feed is unavailable', async ({ page }) => {
  const state = await prepare(page, 503);
  await page.locator('#start-news-read').click();
  await expect.poll(() => page.evaluate(() => window.__blogTestClips.length)).toBe(1);
  state.failedFeed = true;
  await page.locator('#start-news-refresh').click();
  await expect(page.locator('#start-news-status')).toContainText('nicht verfügbar');
  expect(await page.evaluate(() => window.__blogTestClips[0].paused)).toBe(true);
  await expect(page.locator('#start-news-stop')).toBeDisabled();
  expect(state.chunks).toEqual([0]);
});

test('refresh preserves focused card identity and handles withdrawal without autoplay', async ({ page }) => {
  const state = await prepare(page, 409);
  let release;
  await page.route('**/api/developer_blog.php?action=list', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { success: true, posts: state.posts } });
  });
  const refresh = page.locator('#start-news-refresh');
  await refresh.click();
  await expect.poll(() => typeof release).toBe('function');
  await page.locator('.start-news-choice').focus();
  state.posts = [{ ...post, title: 'Aktualisierte Nachricht' }];
  release();
  await expect(page.locator('.start-news-choice')).toHaveText(/Aktualisierte Nachricht/);
  await expect(page.locator('.start-news-choice')).toBeFocused();
  release = undefined;
  await refresh.click();
  await expect.poll(() => typeof release).toBe('function');
  await page.locator('.start-news-choice').focus();
  state.posts = [];
  release();
  await expect(page.locator('.start-news-choice')).toHaveCount(0);
  await expect(refresh).toBeFocused();
  expect(await page.evaluate(() => window.__blogTestClips.length)).toBe(0);
});
