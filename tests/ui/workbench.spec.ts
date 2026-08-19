import { expect, test } from '@playwright/test';

test.describe('排工工作台 vertical slice', () => {
  test('shows Sunday-first week, four Works and a persistent people sidebar', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: /^日 16/ })).toBeVisible();
    await expect(page.getByTestId('work-1')).toBeVisible();
    await expect(page.getByTestId('work-2')).toBeVisible();
    await expect(page.getByTestId('work-3')).toBeVisible();
    await expect(page.getByTestId('work-4')).toBeVisible();
    await expect(page.getByRole('complementary', { name: '當晚可用人員' })).toBeVisible();
    await expect(page.getByText('S1 支援隊')).toBeVisible();
    await expect(page.getByText('S5 主工作隊')).toBeVisible();
    await expect(page.getByTestId('location-night:2026-08-20:work-1:wcd').getByRole('button', { name: 'CP 分配區，需要 CP(P)' })).toContainText('CP(P)');
    await expect(page.getByRole('button', { name: 'YW Ho S2 夜更 · 已派 W1' })).toBeVisible();
  });

  test('keeps scenario edits isolated until Apply Scenario', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: '測試方案 A', exact: true }).click();
    await page.getByRole('textbox', { name: 'Work 2 Project Code' }).fill('UI-SCENARIO');
    await page.getByRole('button', { name: '主要方案' }).click();
    await expect(page.getByRole('textbox', { name: 'Work 2 Project Code' })).toHaveValue('C7731');

    await page.getByRole('button', { name: '測試方案 A', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Work 2 Project Code' })).toHaveValue('UI-SCENARIO');
    await page.getByRole('button', { name: 'Apply Scenario' }).click();
    await expect(page.getByRole('button', { name: '主要方案' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Work 2 Project Code' })).toHaveValue('UI-SCENARIO');
    await expect(page.getByText('已明確套用至主要方案')).toBeVisible();
  });

  test('routes an invalid expired qualification through the validation path', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'LF To S2 夜更' }).click();
    await page.getByTestId('location-night:2026-08-20:work-1:main-line').getByRole('button', { name: 'CP 分配區，需要 CP(P)' }).click();
    await expect(page.getByText('人員缺少有效 CP(P) 資格。')).toBeVisible();
    await expect(page.getByTestId('location-night:2026-08-20:work-1:main-line').getByRole('button', { name: 'CP 分配區，需要 CP(P)' })).toContainText('未獲派');
  });

  test('supports drag and drop into a PA Work CP row', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('work-2').getByRole('button', { name: 'PA Work' }).click();
    await page.getByRole('button', { name: 'KW Ng S2 夜更' }).dragTo(
      page.getByTestId('location-night:2026-08-20:work-2:url').getByRole('button', { name: 'CP 分配區，CP(T) 優先，接受 CP(P)' }),
    );
    await expect(page.getByTestId('location-night:2026-08-20:work-2:url')).toContainText('KW Ng · S2');
  });

  test('keeps date edits in the local week session and updates the displayed year', async ({ page }) => {
    await page.goto('/');

    const projectCode = page.getByRole('textbox', { name: 'Work 2 Project Code' });
    await projectCode.fill('DATE-PERSIST');

    const dateInput = page.locator('input[type="date"]');
    await dateInput.fill('2027-01-02');
    await expect(page.getByText('2027 年第 1 週')).toBeVisible();

    await dateInput.fill('2026-08-20');
    await expect(page.getByRole('textbox', { name: 'Work 2 Project Code' })).toHaveValue('DATE-PERSIST');
  });
});
