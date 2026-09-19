'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error; reset: () => void }>) {
  useEffect(() => {
    console.error('Unhandled application error', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: '42rem', margin: '0 auto', padding: '5rem 1.5rem' }}>
          <h1>CodexFlow encountered an error.</h1>
          <p>Nothing has been changed. Retry the operation or return to the dashboard.</p>
          <button type="button" onClick={reset}>
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
