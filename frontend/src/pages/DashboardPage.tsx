import { EnergyDashboard } from '../components/Dashboard/EnergyDashboard';
import { CostComparison } from '../components/Dashboard/CostComparison';
import { TraceDebugger } from '../components/Dashboard/TraceDebugger';
import { ExternalLink } from 'lucide-react';

export function DashboardPage() {
  const now = new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              System Overview
            </h1>
            <div className="flex items-center gap-3">
              <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {stamp}
              </div>
              <a
                href="/graphify/jarvis"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{
                  background: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)',
                  color: 'var(--color-on-accent)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <ExternalLink size={14} />
                Graphify
              </a>
            </div>
          </div>
          <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--color-text-secondary)' }}>
            Live telemetry for the on-device inference engine — power draw, token throughput, and cost savings versus cloud APIs.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <EnergyDashboard />
          <CostComparison />
        </div>

        <TraceDebugger />
      </div>
    </div>
  );
}
