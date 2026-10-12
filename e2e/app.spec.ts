import { expect, test, type Page } from '@playwright/test';

const MOCK = 'http://localhost:9090';

async function key(page: Page, k: string, times = 1) {
  for (let i = 0; i < times; i++) await page.keyboard.press(k);
}
const focused = (page: Page) => page.locator(':focus');

async function addXtream(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Add playlist').first()).toBeVisible();
  await focused(page).press('Enter'); // "+ Add playlist" is focused by default
  await expect(page.getByRole('heading', { name: 'Add playlist' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Mock Xtream');
  await page.getByLabel('Server URL').fill(MOCK);
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Add playlist' }).click();
  await expect(page.locator('.tile.t-live .tile-count')).toHaveText('10');
  await expect(page.locator('.tile.t-movie .tile-count')).toHaveText('3');
  await expect(page.locator('.tile.t-series .tile-count')).toHaveText('2');
}

async function videoAdvances(page: Page) {
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20000 }).toBeGreaterThan(1.5);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
});

test('xtream login, D-pad navigation and live playback with zapping', async ({ page }) => {
  await addXtream(page);
  // Home: Live TV tile is focused by default
  await expect(focused(page)).toHaveClass(/t-live/);
  await key(page, 'ArrowRight');
  await expect(focused(page)).toHaveClass(/t-movie/);
  await key(page, 'ArrowLeft');
  await key(page, 'Enter');
  await expect(page.getByRole('heading', { name: 'Live TV' })).toBeVisible();
  // Categories column -> "All" focused
  await expect(focused(page)).toContainText('All');
  await key(page, 'ArrowDown', 3); // Favorites, Recent, News
  await expect(focused(page)).toContainText('News');
  await expect(page.locator('.ch-name')).toHaveText(['CNN Test', 'BBC Test', 'Sky News Test']);
  await key(page, 'ArrowRight');
  await expect(focused(page)).toContainText('CNN Test');
  // EPG panel (Xtream short EPG)
  await expect(page.locator('.epg')).toContainText('Morning Show');
  await key(page, 'ArrowDown');
  await expect(focused(page)).toContainText('BBC Test');
  await key(page, 'Enter');
  await expect(page.locator('.player')).toBeVisible();
  await expect(page.locator('.player-title')).toContainText('BBC Test');
  await videoAdvances(page);
  // zap to next channel with ArrowDown
  await key(page, 'ArrowDown');
  await expect(page.locator('.player-title')).toContainText('Sky News Test');
  await videoAdvances(page);
  await key(page, 'Escape');
  await expect(page.locator('.player')).toHaveCount(0);
  // focus restored to the channel we came from
  await expect(focused(page)).toContainText('BBC Test');
  // recently watched
  await key(page, 'ArrowLeft');
  await key(page, 'ArrowUp');
  await expect(focused(page)).toContainText('Recently watched');
  await expect(page.locator('.ch-name').first()).toHaveText('Sky News Test', { timeout: 3000 });
});

test('hide and reorder categories and channels', async ({ page }) => {
  await addXtream(page);
  await page.getByRole('button', { name: /Hide & reorder/ }).click();
  await expect(page.locator('.layer:not(.inactive) .mrow-name')).toHaveCount(4);
  const adult = page.locator('.layer:not(.inactive) .mrow', { hasText: 'Adult (hide me)' });
  await adult.getByRole('button', { name: /Visible/ }).click();
  await expect(adult.getByRole('button', { name: /Hidden/ })).toBeVisible();
  // Move "Kids" to top
  await page.locator('.layer:not(.inactive) .mrow', { hasText: 'Kids' }).getByRole('button', { name: 'Move to top' }).click();
  await expect(page.locator('.layer:not(.inactive) .mrow-name').first()).toContainText('Kids');
  // Search: filter categories, and moves still act on the full order
  await page.getByPlaceholder('Search categories…').fill('spo');
  await expect(page.locator('.layer:not(.inactive) .mrow-name')).toHaveCount(1);
  await expect(page.locator('.layer:not(.inactive) .mrow-pos')).toHaveText('3'); // real position: Kids, News, Sports
  await page.locator('.layer:not(.inactive) .mrow', { hasText: 'Sports' }).getByRole('button', { name: 'Move to top' }).click();
  await expect(page.locator('.layer:not(.inactive) .mrow-pos')).toHaveText('1');
  await page.getByPlaceholder('Search categories…').fill('zzz');
  await expect(page.getByText('No categories match')).toBeVisible();
  await page.getByPlaceholder('Search categories…').fill('');
  await expect(page.locator('.layer:not(.inactive) .mrow-name').first()).toContainText('Sports');
  const sportsDown = page.locator('.layer:not(.inactive) .mrow', { hasText: 'Sports' }).getByRole('button', { name: 'Move down' });
  await sportsDown.click();
  await sportsDown.click();
  await expect(page.locator('.layer:not(.inactive) .mrow-name')).toHaveText([/Kids/, /News/, /Sports/, /Adult/]);
  // Reorder channels within Sports: move beIN up twice
  await page.locator('.layer:not(.inactive) .mrow', { hasText: 'Sports' }).getByRole('button', { name: /Channels/ }).click();
  await page.getByPlaceholder('Search in this category…').fill('espn');
  await expect(page.locator('.layer:not(.inactive) .mrow-name')).toHaveText(['ESPN Test']);
  await page.getByPlaceholder('Search in this category…').fill('');
  const bein = page.locator('.layer:not(.inactive) .mrow', { hasText: 'beIN Test' });
  await bein.getByRole('button', { name: 'Move up' }).click();
  await bein.getByRole('button', { name: 'Move up' }).click();
  await expect(page.locator('.layer:not(.inactive) .mrow-name').first()).toHaveText('beIN Test');
  await page.locator('.layer:not(.inactive) .mrow', { hasText: 'ESPN Test' }).getByRole('button', { name: /Visible/ }).click();
  await key(page, 'Escape');
  await key(page, 'Escape');
  // Home count drops by the 2 hidden adult channels + 1 hidden channel
  await expect(page.locator('.tile.t-live .tile-count')).toHaveText('7');
  await page.locator('.tile.t-live').click();
  const cats = page.locator('.cats .cat-name');
  await expect(cats).toHaveText(['All', '★ Favorites', '⟲ Recently watched', 'Kids', 'News', 'Sports']);
  await page.locator('.cat', { hasText: 'Sports' }).click();
  await expect(page.locator('.ch-name')).toHaveText(['beIN Test', 'Sky Sports Test']);
  // persists across reloads
  await page.reload();
  await page.locator('.tile.t-live').click();
  await expect(cats).toHaveText(['All', '★ Favorites', '⟲ Recently watched', 'Kids', 'News', 'Sports']);
});

test('movies: details, playback, resume and continue watching', async ({ page }) => {
  await addXtream(page);
  await page.locator('.tile.t-movie').click();
  await expect(page.locator('.poster')).toHaveCount(3);
  await expect(focused(page)).toContainText('All'); // screen's initial focus
  await key(page, 'ArrowRight'); // into the grid
  await expect(focused(page)).toContainText('Test Movie One');
  await key(page, 'Enter');
  await expect(page.getByRole('heading', { name: 'Test Movie One' })).toBeVisible();
  await expect(page.getByText('The plot of Test Movie One.')).toBeVisible();
  await page.getByRole('button', { name: '☆ Favorite' }).click();
  await page.getByRole('button', { name: /▶ Play/ }).click();
  await videoAdvances(page);
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 20; });
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(20);
  await key(page, 'Escape'); // close player
  await expect(page.getByRole('button', { name: /Resume 0:2\d/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume/ }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(19);
  await key(page, 'Escape'); // close player
  await key(page, 'Escape'); // back to movies
  await expect(page.locator('.poster-fav')).toHaveCount(1);
  await key(page, 'Escape'); // home
  await expect(page.getByRole('heading', { name: 'Continue watching' })).toBeVisible();
  await expect(page.locator('.cw-title')).toHaveText('Test Movie One');
});

test('series: seasons and episodes', async ({ page }) => {
  await addXtream(page);
  await page.locator('.tile.t-series').click();
  await page.locator('.poster', { hasText: 'Test Drama' }).click();
  await expect(page.locator('.episode')).toHaveCount(3);
  await page.getByRole('button', { name: 'Season 2' }).click();
  await expect(page.locator('.ep-title').first()).toHaveText('Test Drama S02E01');
  await page.locator('.episode').nth(1).click();
  await expect(page.locator('.player-title')).toContainText('S2 E2');
  await videoAdvances(page);
});

test('M3U URL playlist, search and favorites', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Add playlist' }).click();
  await page.getByRole('button', { name: 'M3U URL' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Plain M3U');
  await page.getByLabel('Playlist URL').fill(`${MOCK}/playlist.m3u`);
  await page.getByRole('button', { name: 'Add playlist' }).click();
  await expect(page.locator('.tile.t-live .tile-count')).not.toHaveText('…');
  await page.locator('.tile.t-live').click();
  await page.getByPlaceholder('Search live tv…').fill('hls');
  await expect(page.locator('.ch-name')).toHaveText(['HLS Test Channel']);
  await page.locator('.fav').first().click();
  await page.getByPlaceholder('Search live tv…').fill('');
  await page.locator('.cat', { hasText: 'Favorites' }).click();
  await expect(page.locator('.ch-name')).toHaveText(['HLS Test Channel']);
  await page.locator('.ch').first().click();
  await videoAdvances(page);
});

test('M3U file upload', async ({ page }) => {
  const text = await (await fetch(`${MOCK}/get.php?username=demo&password=demo`)).text();
  await page.goto('/');
  await page.getByRole('button', { name: '+ Add playlist' }).click();
  await page.getByRole('button', { name: 'M3U File' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'my.m3u', mimeType: 'audio/x-mpegurl', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Add playlist' }).click();
  await expect(page.locator('.tile.t-live .tile-count')).toHaveText('11');
  await expect(page.locator('.tile.t-series .tile-count')).toHaveText('2');
  await page.locator('.tile.t-movie').click();
  await page.locator('.poster', { hasText: 'Funny Test Movie' }).click();
  await page.getByRole('button', { name: /▶ Play/ }).click();
  await videoAdvances(page);
});

test('bad login shows an error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Add playlist' }).click();
  await page.getByLabel('Server URL').fill(MOCK);
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Add playlist' }).click();
  await expect(page.locator('.banner.error')).toContainText('Login failed');
});

test('User-Agent preset is sent to the provider', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ Add playlist' }).click();
  await page.getByLabel('Server URL').fill(MOCK);
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill('demo');
  await page.getByLabel(/Player User-Agent/).selectOption({ label: 'IPTV Smarters Player Lite' });
  await expect(page.getByLabel('Custom User-Agent')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add playlist' }).click();
  await page.locator('.tile.t-live').click();
  await page.locator('.ch').first().click();
  await videoAdvances(page);
  expect(await (await fetch(`${MOCK}/debug/last-ua`)).text()).toBe('iptv_smarters_player_lite');
  // Edit -> custom value
  await key(page, 'Escape'); await key(page, 'Escape');
  await page.getByRole('button', { name: '⚙ Settings' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel(/Player User-Agent/)).toHaveValue('iptv_smarters_player_lite');
  await page.getByLabel(/Player User-Agent/).selectOption({ label: 'Custom…' });
  await page.getByLabel('Custom User-Agent').fill('MyPlayer/9.9');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.tile.t-live .tile-count')).toHaveText('10');
  await page.locator('.tile.t-live').click();
  await page.locator('.ch').first().click();
  await videoAdvances(page);
  expect(await (await fetch(`${MOCK}/debug/last-ua`)).text()).toBe('MyPlayer/9.9');
});
