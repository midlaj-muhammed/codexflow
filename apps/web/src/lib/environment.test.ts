import { describe, expect, it } from 'vitest';

import { getPublicEnvironment } from './environment';

describe('getPublicEnvironment', () => {
  it('uses CodexFlow as the safe default application name', () => {
    expect(getPublicEnvironment({})).toEqual({ appName: 'CodexFlow' });
  });

  it('rejects blank application names', () => {
    expect(() => getPublicEnvironment({ NEXT_PUBLIC_APP_NAME: '  ' })).toThrow();
  });
});
