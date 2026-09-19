import { expect, test } from '@playwright/test';

test('shows developer control plane and health endpoint', async ({ page, request }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /understand every agent change before it reaches github/i }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /import a local repository/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^tasks$/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^operations$/i })).toBeVisible();

  const response = await request.get('/api/health');
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({ service: 'CodexFlow', status: 'ok' });
  const readiness = await request.get('/api/readiness');
  await expect(readiness).toBeOK();
  await expect(readiness.json()).resolves.toMatchObject({ service: 'CodexFlow', status: 'ready' });
});
