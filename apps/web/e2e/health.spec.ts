import { expect, test } from '@playwright/test';

test('shows the public landing page, dashboard entry, and health endpoint', async ({ page, request }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /ai coding agents\. under control\./i }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /open dashboard/i })).toBeVisible();
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /take a verified change from task to github/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /open a project from this computer/i })).toBeVisible();
  await expect(page.getByText(/open a local project or connect github before creating a task/i)).toBeVisible();

  const response = await request.get('/api/health');
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({ service: 'CodexFlow', status: 'ok' });
  const readiness = await request.get('/api/readiness');
  await expect(readiness).toBeOK();
  await expect(readiness.json()).resolves.toMatchObject({ service: 'CodexFlow', status: 'ready' });
});
