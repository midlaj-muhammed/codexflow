import { describe, expect, it } from 'vitest';
import { TaskLifecycle, runMockWorkflow } from './index.js';
describe('runtime', () => {
  it('rejects invalid transitions', () => {
    const lifecycle = new TaskLifecycle();
    lifecycle.create('x');
    expect(() => lifecycle.transition('x', 'APPLIED')).toThrow('Invalid');
  });
  it('executes a deterministic lifecycle to approval', async () => {
    await expect(runMockWorkflow('x')).resolves.toMatchObject({ status: 'READY_FOR_APPROVAL' });
  });
});
