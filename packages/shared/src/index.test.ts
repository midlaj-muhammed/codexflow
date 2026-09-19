import { describe, expect, it } from 'vitest';

import { CODEXFLOW_PACKAGE_NAME } from './index';

describe('shared package foundation', () => {
  it('exports the package identity', () => {
    expect(CODEXFLOW_PACKAGE_NAME).toBe('@codexflow/shared');
  });
});
