import { Suspense, lazy } from 'react';
import { ExternalLink, MoveRight, Sparkles } from 'lucide-react';

const EnergyDashboard = lazy(() =>
  import('../components/Dashboard/EnergyDashboard').then((m) => ({ default: m.EnergyDashboard })),
);
const CostComparison = lazy(() =>
  import('../components/Dashboard/CostComparison').then((m) => ({ default: m.CostComparison })),
);
const TraceDebugger = lazy(() =>
  import('../components/Dashboard/TraceDebugger').then((m) => ({ default: m.TraceDebugger })),
);

export function DashboardPage() {
  const now = new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-4">
        <header
          className="hud-panel p-6"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 9%, var(--color-surface)) 0%, var(--color-surface) 52%, color-mix(in srgb, var(--color-accent-purple) 7%, var(--color-surface)) 100%)',
          }}
        >
          <div className="flex flex-col xl:flex-row xl:items-start gap-4">
            <div className="min-w-0 max-w-3xl">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} style={{ color: 'var(--color-accent)' }} />
                <span className="hud-label uppercase tracking-[0.22em]">Point d’entrée système</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
                Point d’entrée Jarvis
              </h1>
              <p className="text-sm md:text-base mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                Le cockpit quotidien de Ruth est maintenant `Jarvis Personal`. Cette page garde la télémétrie système comme vue secondaire et t’envoie d’abord vers le cockpit Hermes/Jarvis utile au quotidien.
              </p>
            </div>

            <div className="xl:ml-auto flex flex-col sm:flex-row sm:items-center gap-3">
              <div
                className="rounded-2xl px-4 py-3"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-tertiary)' }}>
                  Capture
                </div>
                <div className="text-sm hud-mono mt-1" style={{ color: 'var(--color-text)' }}>
                  {stamp}
                </div>
              </div>
              <a
                href="/jarvis-personal"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl"
                style={{
                  background: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)',
                  color: 'var(--color-on-accent)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                Ouvrir Ruth OS 360°
                <MoveRight size={15} />
              </a>
              <a
                href="/graphify/jarvis"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                Graphify
                <ExternalLink size={15} />
              </a>
            </div>
          </div>
        </header>

        <section className="hud-panel p-5">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <h2 className="text-sm font-semibold tracking-[0.14em] uppercase" style={{ color: 'var(--color-text)' }}>
                Télémétrie système
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Vue secondaire utile pour l’inférence locale, les coûts et le debugging, sans concurrencer le cockpit personnel.
              </p>
            </div>
          </div>

          <Suspense
            fallback={
              <div
                className="rounded-2xl px-4 py-4"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                Chargement de la télémétrie système…
              </div>
            }
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <EnergyDashboard />
              <CostComparison />
            </div>

            <TraceDebugger />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
