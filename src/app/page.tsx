export default function Home() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-teal">
          Phase 0 · Foundations
        </p>
        <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.05] tracking-[-0.02em]">
          Smart City Travel Planner
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">
          Tell us the city, where you&rsquo;re starting from and how long you&rsquo;ve got. We
          solve for the best route through real places, using real travel times, and get you
          back where you started.
        </p>
        <p className="mt-8 border-t border-border pt-5 text-sm text-subtle">
          The planner is not built yet. This deploy exists to prove the pipeline: scaffold,
          data model, tests and CI are in place.
        </p>
      </div>
    </main>
  );
}
