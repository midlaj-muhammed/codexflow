import { expect, test } from '@playwright/test';

test('shows the Phase 0 foundation and health endpoint', async ({ page, request }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /mission control for ai coding agents/i }),
  ).toBeVisible();

  const response = await request.get('/api/health');
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({ service: 'CodexFlow', status: 'ok' });
});
