import { useRef, useEffect, useState } from 'react';
import { Copy, Trash2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { fetchHermesTrace } from '../lib/api';
import type { HermesTraceEntry } from '../lib/api';

const LEVEL_COLORS: Record<string, string> = {
  info: 'var(--color-text)',
  warn: 'var(--color-warning)',
  error: 'var(--color-error)',
};

const TRACE_STATUS_COLORS: Record<string, string> = {
  ok: 'var(--color-success)',
  ready: 'var(--color-success)',
  prepared: 'var(--color-warning)',
  error: 'var(--color-error)',
  fail: 'var(--color-error)',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function LogsPage() {
  const logEntries = useAppStore((s) => s.logEntries);
  const clearLogs = useAppStore((s) => s.clearLogs);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [traceEntries, setTraceEntries] = useState<HermesTraceEntry[]>([]);
  const [traceUpdatedAt, setTraceUpdatedAt] = useState('');
  const [traceLoading, setTraceLoading] = useState(true);

  const loadTrace = () => {
    setTraceLoading(true);
    fetchHermesTrace()
      .then((d) => { setTraceEntries(d.entries); setTraceUpdatedAt(d.updated_at); })
      .catch(() => {})
      .finally(() => setTraceLoading(false));
  };

  useEffect(() => { loadTrace(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logEntries.length]);

  const handleCopy = async () => {
    const text = logEntries
      .map((e) => `${formatTime(e.timestamp)} [${e.level}] [${e.category}] ${e.message}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
  };

  const traceTime = traceUpdatedAt
    ? new Date(traceUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="max-w-4xl mx-auto w-full space-y-6">

        {/* Section 1 — Trace Hermès */}
        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text)' }}>
                Trace Hermès
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Dernière requête traitée par l'orchestrateur
                {traceTime && <span> · {traceTime}</span>}
              </p>
            </div>
            <button
              onClick={loadTrace}
              disabled={traceLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
            >
              <RefreshCw size={12} className={traceLoading ? 'animate-spin' : ''} />
              Actualiser
            </button>
          </div>
          <div
            className="rounded-xl p-4 font-mono text-xs leading-relaxed"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            {traceEntries.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
                {traceLoading ? 'Chargement…' : 'Aucune trace disponible.'}
              </div>
            ) : (
              traceEntries.map((entry, i) => (
                <div key={i} className="py-0.5 flex gap-2">
                  <span
                    className="shrink-0 w-16 text-right"
                    style={{ color: TRACE_STATUS_COLORS[entry.status] || 'var(--color-text-tertiary)' }}
                  >
                    {entry.status}
                  </span>
                  <span className="shrink-0" style={{ color: 'var(--color-accent)' }}>
                    [{entry.tool}]
                  </span>
                  <span style={{ color: 'var(--color-text)' }}>
                    {entry.event_type}
                  </span>
                  {entry.notes && (
                    <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>
                      — {entry.notes}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Section 2 — Logs session */}
        <section className="flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text)' }}>
                Journaux de session
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Événements chat, modèles, outils — session courante uniquement
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {logEntries.length} entrées
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                <Copy size={12} /> Copier
              </button>
              <button
                onClick={clearLogs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                <Trash2 size={12} /> Effacer
              </button>
            </div>
          </div>
          <div
            className="rounded-xl p-4 font-mono text-xs leading-relaxed"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minHeight: '160px' }}
          >
            {logEntries.length === 0 ? (
              <div className="text-center py-12" style={{ color: 'var(--color-text-tertiary)' }}>
                Aucun log de session. Les logs apparaissent lors des échanges, changements de modèle et interactions.
              </div>
            ) : (
              logEntries.map((entry, i) => (
                <div key={i} className="py-0.5">
                  <span style={{ color: 'var(--color-text-tertiary)' }}>{formatTime(entry.timestamp)}</span>
                  {' '}
                  <span style={{ color: LEVEL_COLORS[entry.level] || 'var(--color-text)' }}>
                    [{entry.category}]
                  </span>
                  {' '}
                  <span style={{ color: LEVEL_COLORS[entry.level] || 'var(--color-text)' }}>
                    {entry.message}
                  </span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </section>

      </div>
    </div>
  );
}
