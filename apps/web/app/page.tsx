const foundationCapabilities = [
  'Web-first runtime',
  'Typed configuration',
  'Structured logging',
  'Error boundary',
  'Test and E2E harnesses',
];

export default function HomePage() {
  return (
    <main
      style={{
        display: 'grid',
        gap: '2rem',
        maxWidth: '60rem',
        margin: '0 auto',
        padding: '5rem 1.5rem',
      }}
    >
      <header>
        <p style={{ color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.08em' }}>
          CODEXFLOW / PHASE 0
        </p>
        <h1 style={{ fontSize: 'clamp(2.5rem, 8vw, 5rem)', margin: '0.25rem 0' }}>
          Mission control for AI coding agents.
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '1.15rem', lineHeight: 1.6 }}>
          The development foundation is ready. Repository import, isolated worktrees, and agent
          workflows will be added in their approved phases.
        </p>
      </header>

      <section
        aria-labelledby="foundation-heading"
        style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1.5rem' }}
      >
        <h2 id="foundation-heading">Foundation status</h2>
        <ul style={{ color: 'var(--muted)', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
          {foundationCapabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
