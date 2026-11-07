const { test, expect } = require('@playwright/test');

const post = {
  id: 106, revision: `wp:${'a'.repeat(64)}`, title: 'Wichtige Entwicklung',
  body: 'Eine freigegebene Kurzfassung.', published_at: '2026-11-06 10:00:00',
  categories: ['entwicklung'], tags: ['game-start', 'hero'],
};

async function prepare(page, rejection) {
  const state = { posts: [post], failedFeed: false, chunks: [] };
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
  await page.locator('[data-start-panel="news"]').click();
  await expect(page.locator('.start-news-choice')).toHaveCount(1);
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
