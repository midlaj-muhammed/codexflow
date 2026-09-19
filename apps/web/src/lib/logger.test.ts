import { describe, expect, it } from 'vitest';

import { redactLogContext } from './logger';

describe('redactLogContext', () => {
  it('redacts values whose keys look credential-related', () => {
    expect(redactLogContext({ apiToken: 'do-not-log', requestId: 'request-1' })).toEqual({
      apiToken: '[REDACTED]',
      requestId: 'request-1',
    });
  });
});
