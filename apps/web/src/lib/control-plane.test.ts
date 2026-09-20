import { describe, expect, it } from 'vitest';
import { taskExecutionEnvironmentBlocker } from './control-plane';

describe('task execution environment preflight', () => {
  it('blocks full runtime execution on standard Vercel functions', () => {
    expect(taskExecutionEnvironmentBlocker({ VERCEL: '1' }))
      .toContain('persistent Node runtime');
  });

  it('allows a persistent Node environment to start the runtime', () => {
    expect(taskExecutionEnvironmentBlocker({})).toBeUndefined();
  });
});
