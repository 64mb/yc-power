import {test, expect} from '@playwright/test';

for (const [scenario, type] of [['folder-icons', 'folder'], ['delayed-cloud-icons', 'cloud']]) {
  test(`expanded icon presets remain usable for ${type}s`, async ({page}, testInfo) => {
    await page.goto(`/tests/fixtures/native-tree.html?scenario=${scenario}`);
    const row = page.locator(`.ycp-${type}`).first();
    await expect(row).toBeVisible();
    await row.hover();
    await row.locator('.ycp-row-action').last().click();
    const icons = page.locator('.ycp-icons');
    await expect(icons.locator('button')).toHaveCount(40);
    expect(await icons.locator('[role="row"]').evaluateAll(rows => rows.map(row => row.querySelectorAll('button').length))).toEqual([8, 8, 8, 8, 8]);
    expect(await icons.locator('.g-icon').evaluateAll(icons => new Set(icons.map(icon => icon.innerHTML)).size)).toBe(40);
    await expect(icons.locator('button[value="identity"] [data-ycp-tooltip]')).toHaveAttribute('data-ycp-tooltip', 'Identity');
    const last = icons.locator('button[value="identity"]');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => {
        document.querySelector('.cloud-tree-list-container').style.backgroundColor = theme === 'dark' ? 'rgb(31, 37, 43)' : 'white';
        document.body.className = `g-root g-root_theme_${theme}`;
      }, theme);
      await expect(page.locator('.ycp-root')).toHaveClass(new RegExp(`g-root_theme_${theme}(?:\\s|$)`));
      await expect(page.locator('.ycp-header button').last()).toHaveCSS('color', theme === 'dark' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)');
      await last.scrollIntoViewIfNeeded();
      const screenshot = testInfo.outputPath(`icons-${type}-${theme}.png`);
      await page.screenshot({path: screenshot});
      await testInfo.attach(`${type}-${theme}`, {path: screenshot, contentType: 'image/png'});
    }
    await page.setViewportSize({width: 1200, height: 600});
    await last.click();
    const expectedIcon = await last.locator('.g-icon').innerHTML();
    await page.locator('.ycp-edit button[type="submit"]').click();
    await expect.poll(() => page.evaluate(type => fixture.memory[`yc-power:${location.origin}:organization:id:org-alpha`]?.custom[`${type}:${type}-alpha`]?.icon, type)).toBe('identity');
    await page.goto(`/tests/fixtures/native-tree.html?scenario=${scenario}`);
    await expect(row.locator('.ycp-item-icon .g-icon')).toHaveJSProperty('innerHTML', expectedIcon);
  });
}
