import { expect, test } from '@playwright/test';

test.describe('Manpower Planner workflow', () => {
  test('starts with two Works and adds only through Work 5', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('work-1')).toBeVisible();
    await expect(page.getByTestId('work-2')).toBeVisible();
    await expect(page.getByTestId('work-3')).toBeVisible();
    await expect(page.getByText('已安排 2 / 5 個 Work')).toBeVisible();

    const add = page.getByRole('button', { name: '新增 Work', exact: true });
    await add.click();
    await add.click();
    await expect(page.getByText('已安排 4 / 5 個 Work')).toBeVisible();
    await add.click();
    await expect(page.getByText('已安排 5 / 5 個 Work')).toBeVisible();
    await add.click();
    await expect(page.getByText('每晚最多安排 5 個 Work')).toBeVisible();
  });

  test('renders operational modules instead of a dead navigation state', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Projects' }).click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await page.getByRole('button', { name: 'Roster' }).click();
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
    await page.getByRole('button', { name: 'Booking Rules' }).click();
    await expect(page.getByRole('heading', { name: 'Booking Rules' })).toBeVisible();
  });

  test('keeps browser import mode explicit', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '資料匯入', exact: true }).click();
    await expect(page.getByRole('heading', { name: '資料匯入 staging' })).toBeVisible();
    await expect(page.getByText(/瀏覽器 review mode 沒有 Electron IPC/)).toBeVisible();
    await page.getByLabel('Excel 檔案路徑').fill('C:\\imports\\roster.xlsx');
    await page.getByRole('tab', { name: 'Qualification' }).click();
    await expect(page.getByLabel('Excel 檔案路徑')).toHaveValue('');
    await page.getByLabel('Excel 檔案路徑').fill('C:\\imports\\qualification.xlsx');
    await page.getByRole('tab', { name: 'Roster' }).click();
    await expect(page.getByLabel('Excel 檔案路徑')).toHaveValue('C:\\imports\\roster.xlsx');
    await page.getByText('上傳前查看預期 Excel 結構').click();
    await expect(page.getByText(/AL \(AM\) \/ AL \(PM\) 代表 AL 半日/)).toBeVisible();
  });
});
