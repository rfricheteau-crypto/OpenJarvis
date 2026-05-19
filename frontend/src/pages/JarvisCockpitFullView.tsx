import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  Clock3,
  Layers,
  Lightbulb,
  Loader2,
  Mail,
  Mic,
  MoveRight,
  Plus,
  Radio,
  RefreshCw,
  GitBranch,
  TrendingUp,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchPersonalCockpit, fetchIdeas, createIdea, toggleIdea, fetchAdvSnapshot, submitHermesAlertAction, submitHermesValidation } from '../lib/api';
import type { AdvSnapshot, HermesAlertAction, HermesValidationDecision } from '../lib/api';
import type { ObsidianActionInboxSource, ObsidianActionItem, PersonalCockpitFileHealth, PersonalCockpitRecord, PersonalCockpitSnapshot } from '../types';
import { HermesChatPanel } from '../components/Hermes/HermesChatPanel';

function isRecord(value: unknown): value is PersonalCockpitRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fmtDate(value?: string) {
  if (!value) return 'n/a';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fmtAgo(seconds?: number | null) {
  if (seconds == null) return 'n/a';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

function fmtUsd(value?: number | null) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return `${value.toFixed(2)} $`;
}

function budgetFlag(ratio?: number, level?: string) {
  const value = ratio || 0;
  if (level === 'blocked' || value >= 1) return { label: 'Budget bloqué', tone: 'error' as const };
  if (value >= 0.95) return { label: 'Alerte 95 %', tone: 'error' as const };
  if (value >= 0.8) return { label: 'Alerte 80 %', tone: 'warning' as const };
  if (value >= 0.5) return { label: 'Alerte 50 %', tone: 'warning' as const };
  return { label: 'Budget sain', tone: 'ok' as const };
}

function toneFromText(value: string) {
  const text = value.toLowerCase();
  if (text.includes('ok') || text.includes('active') || text.includes('recent') || text.includes('executed')) {
    return {
      color: 'var(--color-success)',
      bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
      border: 'color-mix(in srgb, var(--color-success) 30%, transparent)',
    };
  }
  if (
    text.includes('pending') ||
    text.includes('pause') ||
    text.includes('warning') ||
    text.includes('idle') ||
    text.includes('info')
  ) {
    return {
      color: 'var(--color-warning)',
      bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
      border: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
    };
  }
  return {
    color: 'var(--color-error)',
    bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)',
    border: 'color-mix(in srgb, var(--color-error) 30%, transparent)',
  };
}

function Badge({ value }: { value: string }) {
  const tone = toneFromText(value);
  return (
    <span
      className="px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      {value}
    </span>
  );
}

function Section({
  title,
  subtitle,
  icon: Icon,
  action,
  id,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Mic;
  action?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="hud-panel p-5 scroll-mt-6">
      <div className="hud-panel-head flex items-start gap-3 mb-5">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
          }}
        >
          <Icon size={15} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-[0.14em] uppercase" style={{ color: 'var(--color-text)' }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function SummaryCard({
  title,
  value,
  note,
  badge,
  accent = 'var(--color-accent)',
}: {
  title: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  badge?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      className="hud-panel p-4"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 8%, var(--color-surface)), var(--color-surface))`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-tertiary)' }}>
          {title}
        </div>
        {badge}
      </div>
      <div className="mt-3 text-2xl font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
        {value}
      </div>
      {note && (
        <div className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {note}
        </div>
      )}
    </div>
  );
}

function MessageCard({
  title,
  icon: Icon,
  content,
  compact = false,
}: {
  title: string;
  icon: typeof Mic;
  content: string;
  compact?: boolean;
}) {
  return (
    <Section title={title} icon={Icon}>
      <div
        className={`rounded-2xl px-4 py-4 ${compact ? 'min-h-[112px]' : 'min-h-[148px]'}`}
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        <ExpandableText text={content} emptyLabel="Aucun contenu récent." maxChars={260} />
      </div>
    </Section>
  );
}

function AttentionCard({
  title,
  detail,
  level,
}: {
  title: string;
  detail: string;
  level: 'warning' | 'info' | 'ok';
}) {
  const tone =
    level === 'ok'
      ? toneFromText('ok')
      : level === 'info'
      ? toneFromText('warning')
      : toneFromText('error');

  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <div className="text-sm font-semibold" style={{ color: tone.color }}>
        {title}
      </div>
      <div className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>
        {detail}
      </div>
    </div>
  );
}

function GuidanceCard({
  title,
  detail,
  hint,
}: {
  title: string;
  detail: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="text-xs uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-tertiary)' }}>
        {title}
      </div>
      <div className="text-sm font-medium mt-2" style={{ color: 'var(--color-text)' }}>
        {detail}
      </div>
      {hint && (
        <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      className="rounded-full px-3 py-1.5 text-xs"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}:</span>{' '}
      <span style={{ color: 'var(--color-text)' }}>{value}</span>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
      <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
        {label}
      </div>
      <div className="text-sm text-right max-w-[70%]" style={{ color: 'var(--color-text)' }}>
        {value}
      </div>
    </div>
  );
}

function ExpandableText({
  text,
  emptyLabel,
  maxChars = 220,
}: {
  text: string;
  emptyLabel: string;
  maxChars?: number;
}) {
  if (!text) {
    return <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{emptyLabel}</div>;
  }
  if (text.length <= maxChars) {
    return (
      <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
        {text}
      </div>
    );
  }
  return (
    <details className="group">
      <summary className="list-none cursor-pointer">
        <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
          {text.slice(0, maxChars).trim()}…
        </div>
        <div className="text-xs mt-2" style={{ color: 'var(--color-accent)' }}>
          Voir tout
        </div>
      </summary>
      <div className="text-sm whitespace-pre-wrap mt-3" style={{ color: 'var(--color-text)' }}>
        {text}
      </div>
    </details>
  );
}

function CompactRecord({
  record,
  labels,
}: {
  record?: PersonalCockpitRecord | null;
  labels: Array<{ key: string; label: string }>;
}) {
  if (!record) {
    return <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Aucun état disponible.</div>;
  }

  return (
    <div className="space-y-1">
      {labels.map(({ key, label }) => {
        const value = record[key];
        if (value == null || value === '') return null;
        return <MetricRow key={key} label={label} value={String(value)} />;
      })}
    </div>
  );
}

function compactValuePreview(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} élément(s)`;
  if (!isRecord(value)) return '';
  const preferredKeys = ['request', 'title', 'action', 'decision', 'tool', 'status', 'summary', 'label', 'intent'];
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const keys = Object.keys(value);
  return keys.length ? `objet (${keys.slice(0, 3).join(', ')})` : 'objet vide';
}

function OrchestratorRecordCard({
  title,
  payload,
}: {
  title: string;
  payload?: unknown;
}) {
  const preview = compactValuePreview(payload);
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
        {title}
      </div>
      <div className="text-sm" style={{ color: preview ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>
        {preview || 'Absent pour le moment.'}
      </div>
      {isRecord(payload) && Object.keys(payload).length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs" style={{ color: 'var(--color-accent)' }}>
            Voir le payload
          </summary>
          <pre
            className="text-xs mt-3 whitespace-pre-wrap break-words rounded-xl px-3 py-3 overflow-x-auto"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
          >
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

type PendingValidation = {
  id: string;
  project: string;
  title: string;
  source: string;
  why_pending: string;
  expected_action: string;
  owner: 'Ruth' | 'Claude' | 'Codex' | 'Hermès';
  status: 'real' | 'mock' | 'partial' | 'to_connect' | 'done';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  updated_at: string;
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'var(--color-error)',
  high: 'var(--color-warning)',
  medium: 'var(--color-accent-blue)',
  low: 'var(--color-text-secondary)',
};

const OWNER_COLOR: Record<string, string> = {
  Ruth: 'var(--color-accent-purple)',
  Claude: 'var(--color-accent-blue)',
  Codex: 'var(--color-success)',
  'Hermès': 'var(--color-warning)',
};

const OWNER_INSTRUCTION: Record<string, string> = {
  Ruth: 'À faire par Ruth',
  Claude: 'À faire par Claude',
  Codex: 'À faire par Codex',
  'Hermès': 'À router par Hermès',
};

function PendingValidationsList({
  items,
}: {
  items: PendingValidation[];
}) {
  const [expanded, setExpanded] = useState(true);
  const active = items.filter((v) => v.status !== 'done');

  if (active.length === 0) {
    return (
      <div
        className="rounded-2xl px-4 py-4"
        style={{
          background: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-success) 24%, transparent)',
        }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
          <div className="font-semibold" style={{ color: 'var(--color-text)' }}>
            Aucune validation en attente
          </div>
        </div>
        <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
          Toutes les validations sont traitées.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {active.length} validation{active.length > 1 ? 's' : ''} — source : <code>pending_validations.json</code>
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium px-3 py-1 rounded-full cursor-pointer"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {expanded ? '▲ Masquer' : `▼ Voir les ${active.length} validations`}
        </button>
      </div>
      {expanded && active.map((v) => (
        <div
          key={v.id}
          className="rounded-2xl px-4 py-4"
          style={{
            background: 'color-mix(in srgb, var(--color-bg-card) 80%, transparent)',
            border: `1px solid color-mix(in srgb, ${PRIORITY_COLOR[v.priority] || 'var(--color-border)'} 35%, transparent)`,
          }}
        >
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} style={{ color: PRIORITY_COLOR[v.priority] || 'var(--color-warning)', flexShrink: 0 }} />
              <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                {v.title}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: `color-mix(in srgb, ${PRIORITY_COLOR[v.priority]} 15%, transparent)`,
                  color: PRIORITY_COLOR[v.priority],
                }}
              >
                {v.priority}
              </span>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: `color-mix(in srgb, ${OWNER_COLOR[v.owner] || 'var(--color-text-secondary)'} 15%, transparent)`,
                  color: OWNER_COLOR[v.owner] || 'var(--color-text-secondary)',
                }}
              >
                {v.owner}
              </span>
            </div>
          </div>
          <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
            <span style={{ fontWeight: 500, color: 'var(--color-text-tertiary)' }}>Pourquoi : </span>
            {v.why_pending}
          </div>
          <div
            className="text-sm mt-2 px-3 py-2 rounded-xl"
            style={{
              background: 'color-mix(in srgb, var(--color-accent-blue) 8%, transparent)',
              color: 'var(--color-text)',
            }}
          >
            <span style={{ color: 'var(--color-text-secondary)' }}>Action : </span>
            {v.expected_action}
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2 mt-3">
            <div className="flex flex-wrap gap-2">
              <InfoChip label="Projet" value={v.project} />
              <InfoChip label="Source" value={v.source.split('·')[0].trim()} />
              <InfoChip label="Mis à jour" value={fmtDate(v.updated_at)} />
            </div>
            <div
              className="text-xs font-medium px-3 py-1.5 rounded-full"
              style={{
                background: `color-mix(in srgb, ${OWNER_COLOR[v.owner] || 'var(--color-text-secondary)'} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${OWNER_COLOR[v.owner] || 'var(--color-text-secondary)'} 25%, transparent)`,
                color: OWNER_COLOR[v.owner] || 'var(--color-text-secondary)',
              }}
            >
              {OWNER_INSTRUCTION[v.owner] ?? v.owner}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PendingValidationCard({
  pending,
  onValidate,
}: {
  pending?: PersonalCockpitRecord | null;
  onValidate: (decision: HermesValidationDecision) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState<HermesValidationDecision | null>(null);
  if (!pending) {
    return (
      <div
        className="rounded-2xl px-4 py-4"
        style={{
          background: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-success) 24%, transparent)',
        }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
          <div className="font-semibold" style={{ color: 'var(--color-text)' }}>
            Aucune validation vocale en attente
          </div>
        </div>
        <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
          Ruth n'a rien à confirmer vocalement au moment du snapshot.
        </div>
      </div>
    );
  }

  const action = String(pending.action || 'Action réelle en attente');
  const executable = String(pending.executable || 'n/a');
  const requestedAt = String(pending.requested_at || '');
  const busy = submitting !== null;

  const handleDecision = async (decision: HermesValidationDecision) => {
    if (busy) return;
    setSubmitting(decision);
    try {
      await onValidate(decision);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{
        background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} style={{ color: 'var(--color-warning)' }} />
          <div className="font-semibold" style={{ color: 'var(--color-text)' }}>
            Validation vocale Hermès
          </div>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded"
          style={{ background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)' }}
        >
          [CONNECTÉ — validation cockpit]
        </span>
      </div>
      <div className="text-sm font-medium mt-3" style={{ color: 'var(--color-text)' }}>
        {action}
      </div>
      <div className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
        Jarvis attend un oui/non explicite. Le cockpit enregistre la décision dans Hermès, sans exécuter d'action externe directement.
      </div>
      <div className="flex gap-2 mt-3">
        <button
          disabled={busy}
          onClick={() => void handleDecision('approve')}
          className="flex-1 py-2 rounded-xl text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'color-mix(in srgb, var(--color-success) 18%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)' }}
          title="Enregistre une approbation Hermès, sans exécution externe directe"
        >
          {submitting === 'approve' ? 'Validation...' : '✓ Oui, valider'}
        </button>
        <button
          disabled={busy}
          onClick={() => void handleDecision('reject')}
          className="flex-1 py-2 rounded-xl text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'color-mix(in srgb, var(--color-error) 12%, transparent)', color: 'var(--color-error)', border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)' }}
          title="Refuse la validation Hermès, sans exécution externe"
        >
          {submitting === 'reject' ? 'Refus...' : '✗ Non, refuser'}
        </button>
      </div>
      <div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
        POST /api/hermes/validate · exécution externe désactivée dans ce bouton.
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <InfoChip label="Executable" value={executable} />
        <InfoChip label="Demandée" value={fmtDate(requestedAt)} />
      </div>
    </div>
  );
}

function MailList({
  title,
  items,
}: {
  title: string;
  items: Array<Record<string, unknown>>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
        {title}
      </div>
      {items.slice(0, 4).map((item, index) => (
        <div key={`${String(item.message_id || item.subject || index)}`} className="rounded-xl px-3 py-3" style={{ background: 'var(--color-bg-secondary)' }}>
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {String(item.subject || 'Sans sujet')}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {String(item.sender || '')}
          </div>
          <div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
            {String(item.source_folder || '')} → {String(item.target_folder || '')}
          </div>
        </div>
      ))}
    </div>
  );
}

function OperationResultCard({
  title,
  summary,
  status,
  chips,
  children,
}: {
  title: string;
  summary: string;
  status: string;
  chips: Array<{ label: string; value: React.ReactNode }>;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center gap-3">
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {title}
        </div>
        <Badge value={status} />
      </div>
      <div className="text-sm mt-3" style={{ color: 'var(--color-text)' }}>
        {summary}
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        {chips.map((chip) => (
          <InfoChip key={chip.label} label={chip.label} value={chip.value} />
        ))}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

function ActionSummary({
  title,
  subtitle,
  record,
  labels,
  compact = false,
}: {
  title: string;
  subtitle: string;
  record?: PersonalCockpitRecord | null;
  labels: Array<{ key: string; label: string }>;
  compact?: boolean;
}) {
  const items = Array.isArray(record?.items) ? (record?.items as Array<Record<string, unknown>>) : [];
  const results = Array.isArray(record?.results) ? (record?.results as Array<Record<string, unknown>>) : [];

  return (
    <Section title={title} subtitle={subtitle} icon={Mail}>
      <CompactRecord record={record} labels={labels} />
      {!compact && (
        <div className="mt-4">
          <MailList title="Messages" items={items.length ? items : results} />
        </div>
      )}
    </Section>
  );
}

function ContinuityCard({
  heading,
  summary,
  isLatest = false,
}: {
  heading: string;
  summary: string;
  isLatest?: boolean;
}) {
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{
        background: isLatest ? 'color-mix(in srgb, var(--color-accent) 7%, var(--color-bg-secondary))' : 'var(--color-bg-secondary)',
        border: isLatest
          ? '1px solid color-mix(in srgb, var(--color-accent) 24%, transparent)'
          : '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-center gap-2">
        {isLatest && <Badge value="à reprendre" />}
        <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {heading}
        </div>
      </div>
      <div className="text-sm mt-3" style={{ color: 'var(--color-text-secondary)' }}>
        {summary || '—'}
      </div>
    </div>
  );
}

function SecondaryDetails({
  title,
  subtitle,
  children,
  defaultOpen = false,
  id,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  return (
    <details
      id={id}
      className="hud-panel px-5 py-4 group"
      open={defaultOpen}
    >
      <summary className="list-none cursor-pointer flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </div>
          {subtitle && (
            <div className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {subtitle}
            </div>
          )}
        </div>
        <ChevronDown
          size={16}
          className="ml-auto transition-transform group-open:rotate-180"
          style={{ color: 'var(--color-text-tertiary)' }}
        />
      </summary>
      <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
        {children}
      </div>
    </details>
  );
}

function MiniAttentionRow({
  items,
}: {
  items: Array<{ title: string; detail: string; level: 'warning' | 'info' | 'ok' }>;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-2.5">
      {items.map((item) => {
        const tone =
          item.level === 'ok'
            ? toneFromText('ok')
            : item.level === 'info'
            ? toneFromText('warning')
            : toneFromText('error');
        return (
          <div
            key={item.title}
            className="rounded-xl px-3.5 py-3"
            style={{
              background: tone.bg,
              border: `1px solid ${tone.border}`,
            }}
          >
            <div className="text-xs uppercase tracking-[0.14em]" style={{ color: tone.color }}>
              {item.title}
            </div>
            <div className="text-sm mt-1.5" style={{ color: 'var(--color-text)' }}>
              {item.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: typeof RefreshCw;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm cursor-pointer disabled:cursor-not-allowed"
      style={{
        background: disabled ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        color: disabled ? 'var(--color-text-tertiary)' : 'var(--color-text)',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function deriveHermesStatus(data: PersonalCockpitSnapshot): 'active' | 'idle' | 'offline' {
  const overall = String(data.hermes?.overall || data.general_state?.status || '').toLowerCase();
  if (overall.includes('ok') || overall.includes('active') || overall.includes('recent') || overall.includes('executed'))
    return 'active';
  if (overall.includes('pending') || overall.includes('idle') || overall.includes('pause') || overall.includes('warning'))
    return 'idle';
  if (!data.hermes?.overall && !data.general_state?.status) return 'offline';
  return 'idle';
}

const HERMES_STATUS_CONFIG = {
  active: {
    label: 'Actif',
    color: 'var(--color-success)',
    bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
    pulse: true,
  },
  idle: {
    label: 'En attente',
    color: 'var(--color-warning)',
    bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)',
    pulse: false,
  },
  offline: {
    label: 'Hors ligne',
    color: 'var(--color-text-tertiary)',
    bg: 'color-mix(in srgb, var(--color-text-tertiary) 14%, transparent)',
    pulse: false,
  },
} as const;

function HermesPanel({
  data,
  onReply,
}: {
  data: PersonalCockpitSnapshot;
  onReply: () => void;
}) {
  const status = deriveHermesStatus(data);
  const cfg = HERMES_STATUS_CONFIG[status];

  const lastMessage = (
    String(data.hermes?.last_summary || '').trim() ||
    String(data.priority_lane?.detail || '').trim() ||
    String(data.general_state?.last_response || '').trim() ||
    "Hermès surveille. Aucune alerte ni résumé récent."
  );

  const recommendedAction = (
    String(data.hermes?.last_recommended_action || '').trim() ||
    String(data.general_state?.last_recommended_action || '').trim()
  );

  const nextActions = Array.isArray(data.hermes?.next_actions)
    ? (data.hermes!.next_actions as Array<{ label?: string; why?: string }>).slice(0, 2)
    : [];

  return (
    <div
      className="hud-panel overflow-hidden"
      style={{
        background:
          'linear-gradient(160deg, color-mix(in srgb, var(--color-accent-purple) 8%, var(--color-surface)) 0%, var(--color-surface) 60%)',
        border: '1px solid color-mix(in srgb, var(--color-accent-purple) 18%, transparent)',
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--color-accent-purple) 18%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent-purple) 28%, transparent)',
            }}
          >
            <Sparkles size={15} style={{ color: 'var(--color-accent-purple)' }} />
          </div>
          <span
            className="text-sm font-semibold tracking-[0.14em] uppercase"
            style={{ color: 'var(--color-text)' }}
          >
            {"Hermès me parle"}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
          style={{ background: cfg.bg, color: cfg.color }}
        >
          <span className="relative flex h-1.5 w-1.5">
            {cfg.pulse && (
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-70"
                style={{ background: cfg.color }}
              />
            )}
            <span
              className="relative inline-flex rounded-full h-1.5 w-1.5"
              style={{ background: cfg.color }}
            />
          </span>
          {cfg.label}
        </div>
      </div>

      {/* Message bubble */}
      <div className="px-5 pb-2">
        <div
          className="rounded-2xl px-4 py-4 mb-4"
          style={{
            background: 'color-mix(in srgb, var(--color-accent-purple) 6%, var(--color-bg-secondary))',
            border: '1px solid color-mix(in srgb, var(--color-accent-purple) 12%, transparent)',
          }}
        >
          <ExpandableText
            text={lastMessage}
            emptyLabel={"Hermès surveille. Aucune alerte récente."}
            maxChars={260}
          />
        </div>

        {/* Recommended action */}
        {recommendedAction && (
          <div className="mb-4">
            <div
              className="text-[10px] uppercase tracking-[0.18em] mb-1.5"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {"Action recommandée"}
            </div>
            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {recommendedAction}
            </div>
          </div>
        )}

        {/* Next actions */}
        {nextActions.length > 0 && (
          <div className="mb-4">
            <div
              className="text-[10px] uppercase tracking-[0.18em] mb-2"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {"Prochaines actions"}
            </div>
            <div className="space-y-1.5">
              {nextActions.map((action, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <span style={{ color: 'var(--color-accent-purple)' }}>›</span>
                  <span>{String(action.label || action.why || '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions footer */}
        <div className="flex items-center gap-3 pb-5">
          <button
            onClick={onReply}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium cursor-pointer"
            style={{
              background: 'var(--color-accent-purple)',
              color: '#fff',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <Sparkles size={14} />
            {"Répondre à Hermès"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Projects ────────────────────────────────────────────────────────────────

// ADV_KPI_MOCK — valeurs fallback jusqu'à connexion réelle Stripe + Firebase
const ADV_KPI_MOCK = {
  mrr: '0 €',
  subscriptions: 17,
  users: 21,
  churn: '0 %',
  launch: 'pré-lancement',
  quotesGenerated: 42,
  invoicesGenerated: 18,
  creditsConsumed: '1 240',
  mainIssue: 'Vérifier Stripe live · Brevo DNS · emails transactionnels',
  nextAction: 'Activer Stripe live et valider un paiement test',
} as const;

// GRAPHIFY_MOCK — valeurs fallback jusqu'au prochain scan
const GRAPHIFY_MOCK = {
  lastScan: '—',
  orphanNotes: '—',
  duplicates: '—',
  weakLinks: '—',
  nextAction: 'Lancer /graphify sur le vault ADV',
} as const;

// OBSIDIAN_MOCK — valeurs fallback
const OBSIDIAN_MOCK = {
  ideasInbox: '—',
  toClassify: '—',
  lastStateUpdate: '—',
  memoryHealth: 'À vérifier',
} as const;

// VALENA_MOCK — valeurs fallback
const VALENA_MOCK = {
  status: 'conception',
  nextStep: 'Définir le MVP vocal',
  pendingDocs: '—',
} as const;

const PROJECTS_STORAGE_KEY = 'ruth_project_statuses';

type ProjectStatus = 'active' | 'pause' | 'alert';

interface ProjectDef {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  defaultStatus: ProjectStatus;
  kpiLabel: string;
  kpiValue: string;
}

const PROJECT_DEFS: ProjectDef[] = [
  {
    id: 'adv',
    name: 'ADV',
    tagline: "Facturation vocale pour artisans",
    accent: 'var(--color-success)',
    defaultStatus: 'active',
    kpiLabel: 'MRR',
    kpiValue: ADV_KPI_MOCK.mrr,
  },
  {
    id: 'jarvis',
    name: 'Jarvis / Hermès',
    tagline: "Cockpit personnel et assistant vocal",
    accent: 'var(--color-accent-purple)',
    defaultStatus: 'active',
    kpiLabel: 'Version active',
    kpiValue: 'V4 stable',
  },
  {
    id: 'graphify',
    name: 'Graphify',
    tagline: "Cartographie du vault Obsidian",
    accent: 'var(--color-accent)',
    defaultStatus: 'active',
    kpiLabel: 'Dernier scan',
    kpiValue: GRAPHIFY_MOCK.lastScan,
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    tagline: "Second brain et mémoire durable",
    accent: 'var(--color-accent-purple)',
    defaultStatus: 'active',
    kpiLabel: 'Santé mémoire',
    kpiValue: OBSIDIAN_MOCK.memoryHealth,
  },
  {
    id: 'valena',
    name: 'Valéna',
    tagline: "Assistante vocale IA",
    accent: '#F87171',
    defaultStatus: 'pause',
    kpiLabel: 'Statut',
    kpiValue: VALENA_MOCK.status,
  },
  {
    id: 'abg',
    name: 'ABG',
    tagline: "Projet en cours",
    accent: 'var(--color-accent)',
    defaultStatus: 'pause',
    kpiLabel: 'Statut',
    kpiValue: 'En pause',
  },
];

const PROJECT_STATUS_CYCLE: Record<ProjectStatus, ProjectStatus> = {
  active: 'pause',
  pause: 'alert',
  alert: 'active',
};

const PROJECT_STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  active: { label: 'Actif', color: 'var(--color-success)' },
  pause: { label: 'En pause', color: 'var(--color-text-tertiary)' },
  alert: { label: 'Alerte', color: 'var(--color-warning)' },
};

function ProjectCard({
  project,
  status,
  alertCount,
  lastActivity,
  onStatusClick,
}: {
  project: ProjectDef;
  status: ProjectStatus;
  alertCount: number;
  lastActivity: string;
  onStatusClick: () => void;
}) {
  const cfg = PROJECT_STATUS_CONFIG[status];
  const navigate = useNavigate();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/jarvis-personal/project/${project.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/jarvis-personal/project/${project.id}`); }}
      className="hud-panel p-5 flex flex-col gap-3 cursor-pointer"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${project.accent} 6%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
        border: `1px solid color-mix(in srgb, ${project.accent} 16%, transparent)`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm leading-tight" style={{ color: 'var(--color-text)' }}>
            {project.name}
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>
            {project.tagline}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onStatusClick(); }}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer"
          style={{
            background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
            color: cfg.color,
            border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)`,
          }}
          title={"Clic pour changer le statut"}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          <span className="inline-block rounded-full h-1.5 w-1.5" style={{ background: cfg.color }} />
          {cfg.label}
        </button>
      </div>

      {/* KPI */}
      <div
        className="rounded-xl px-3 py-2.5"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div
          className="text-[10px] uppercase tracking-[0.14em] mb-0.5"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {project.kpiLabel}
        </div>
        <div className="text-sm font-semibold" style={{ color: project.accent }}>
          {project.kpiValue}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto">
        <div
          className="text-xs"
          style={{ color: alertCount > 0 ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}
        >
          {alertCount > 0 ? `⚠ ${alertCount} alerte${alertCount > 1 ? 's' : ''}` : '✓ Aucune alerte'}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {lastActivity}
        </div>
      </div>
    </div>
  );
}

const LIVE_STATUS_LABELS: Record<string, string> = {
  active_window: 'Actif',
  recently_active: 'Récemment actif',
  idle: 'En veille',
  paused: 'En pause',
};

function JarvisProjectCard({
  status,
  onStatusClick,
  cockpitData,
}: {
  status: ProjectStatus;
  onStatusClick: () => void;
  cockpitData: PersonalCockpitSnapshot;
}) {
  const navigate = useNavigate();
  const cfg = PROJECT_STATUS_CONFIG[status];
  const accent = 'var(--color-accent)';

  const hermes = cockpitData.hermes ?? {};
  const gs = cockpitData.general_state;
  const activeIntent = (hermes.active_intent ?? gs.active_intent ?? '—').replace(/_/g, ' ');
  const lastSkill = hermes.last_skill_run as Record<string, unknown> | null | undefined;
  const lastSkillLabel = String(lastSkill?.label ?? lastSkill?.skill ?? '—');
  const liveStatus = LIVE_STATUS_LABELS[gs.live_status] ?? gs.live_status ?? '—';
  const alertCount = cockpitData.alerts.filter((a) => a.level === 'warning' || a.level === 'error').length;
  const lastActivity = gs.age_seconds != null ? `${fmtAgo(gs.age_seconds)} ago` : '—';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/jarvis-personal/project/jarvis')}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate('/jarvis-personal/project/jarvis'); }}
      className="hud-panel p-5 flex flex-col gap-3 h-full cursor-pointer"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 6%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
        border: `1px solid color-mix(in srgb, ${accent} 16%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <Brain size={13} style={{ color: accent }} />
            Jarvis / Hermès
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>
            Orchestrateur et mémoire IA
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onStatusClick(); }}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer"
          style={{
            background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
            color: cfg.color,
            border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)`,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          <span className="inline-block rounded-full h-1.5 w-1.5" style={{ background: cfg.color }} />
          {cfg.label}
        </button>
      </div>

      <div
        className="rounded-xl px-3 py-2.5 flex-1"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div className="space-y-1 text-xs">
          {([
            ['Statut live', liveStatus],
            ['Intent actif', activeIntent],
            ['Dernier skill', lastSkillLabel],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <span className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
              <span className="truncate text-right" style={{ color: 'var(--color-text)' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto">
        <div className="text-xs" style={{ color: alertCount > 0 ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}>
          {alertCount > 0 ? `⚠ ${alertCount} alerte${alertCount > 1 ? 's' : ''}` : '✓ Aucune alerte'}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{lastActivity}</div>
      </div>
    </div>
  );
}

function AdvProjectCard({
  status,
  onStatusClick,
  snap,
}: {
  status: ProjectStatus;
  onStatusClick: () => void;
  snap: AdvSnapshot | null;
}) {
  const navigate = useNavigate();
  const cfg = PROJECT_STATUS_CONFIG[status];
  const accent = 'var(--color-success)';

  const isLive = !!snap && !snap._empty;
  const isStale = isLive && !!snap?._stale;
  const mrr = snap?.business?.mrr !== undefined ? `${snap.business.mrr} €` : ADV_KPI_MOCK.mrr;
  const abos = snap?.abonnements?.actifs ?? ADV_KPI_MOCK.subscriptions;
  const users = snap?.utilisateurs?.total ?? ADV_KPI_MOCK.users;
  const churn = snap?.abonnements?.churn_rate !== undefined ? `${snap.abonnements.churn_rate} %` : ADV_KPI_MOCK.churn;
  const devis = snap?.usage?.devis_total ?? ADV_KPI_MOCK.quotesGenerated;
  const factures = snap?.usage?.factures_total ?? ADV_KPI_MOCK.invoicesGenerated;

  const nonOkServices = Object.entries(snap?.sante_technique?.services ?? {}).filter(([, v]) => v !== 'ok').map(([k]) => k);
  const mainIssue = nonOkServices.length > 0
    ? nonOkServices.join(' · ') + ' non configuré'
    : ADV_KPI_MOCK.mainIssue;

  const subtitle = isLive
    ? `données N8N · ${new Date(snap!.generated_at!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${isStale ? ' (périmées)' : ''}`
    : 'pré-lancement · données estimées';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/jarvis-personal/project/adv')}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate('/jarvis-personal/project/adv'); }}
      className="hud-panel p-5 cursor-pointer"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 6%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
        border: `1px solid color-mix(in srgb, ${accent} 16%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <div className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <TrendingUp size={14} style={{ color: accent }} />
            ADV — Facturation vocale pour artisans
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            {subtitle}
            {!isLive && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
                style={{ background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', color: 'var(--color-warning)', border: '1px solid color-mix(in srgb, var(--color-warning) 22%, transparent)' }}
              >
                estimé
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onStatusClick(); }}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer"
          style={{
            background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
            color: cfg.color,
            border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)`,
          }}
          title="Clic pour changer le statut"
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          <span className="inline-block rounded-full h-1.5 w-1.5" style={{ background: cfg.color }} />
          {cfg.label}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {([
          ['MRR', mrr, !isLive],
          ['Abonnements', abos, !isLive],
          ['Utilisateurs', users, !isLive],
          ['Churn', churn, !isLive],
          ['Devis générés', devis, !isLive],
          ['Factures générées', factures, !isLive],
          ['Crédits IA', `${ADV_KPI_MOCK.creditsConsumed} tokens`, true],
          ['Lancement', ADV_KPI_MOCK.launch, true],
        ] as [string, string | number, boolean][]).map(([label, value, isMock]) => (
          <div
            key={label}
            className="rounded-xl px-3 py-2"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center gap-1.5">
              <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-tertiary)' }}>
                {label}
              </div>
              {isMock && (
                <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', borderRadius: '3px', padding: '0px 4px', letterSpacing: '0.06em' }}>
                  MOCK
                </span>
              )}
            </div>
            <div className="text-sm font-semibold mt-0.5" style={{ color: isMock ? 'var(--color-text-tertiary)' : accent }}>
              {String(value)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div
          className="rounded-xl px-3 py-2.5"
          style={{
            background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-warning) 24%, transparent)',
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--color-warning)' }}>
            Alerte principale
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text)' }}>
            {mainIssue}
          </div>
        </div>
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div className="text-[10px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Prochaine action ADV
            </div>
            {!isLive && (
              <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', borderRadius: '3px', padding: '0px 4px', letterSpacing: '0.06em' }}>
                MOCK
              </span>
            )}
          </div>
          <div className="text-xs" style={{ color: 'var(--color-text)' }}>
            {ADV_KPI_MOCK.nextAction}
          </div>
        </div>
      </div>
    </div>
  );
}

function GraphifyProjectCard({
  status,
  onStatusClick,
  connector,
}: {
  status: ProjectStatus;
  onStatusClick: () => void;
  connector?: { status: string; summary?: string; details: Record<string, unknown>; updated_at: string } | null;
}) {
  const navigate = useNavigate();
  const cfg = PROJECT_STATUS_CONFIG[status];
  const accent = 'var(--color-accent)';
  const isLive = !!connector;

  const details = connector?.details ?? {};
  const rows: [string, string][] = isLive
    ? [
        ['Statut', String(details.status ?? connector?.status ?? '—')],
        ['Route HTML', String(details.html_route ?? '—')],
        ['Smoke test', String(details.smoke_test ?? '—')],
        ['Mode rendu', String(details.render_mode ?? '—')],
      ]
    : [
        ['Dernier scan', GRAPHIFY_MOCK.lastScan],
        ['Notes orphelines', GRAPHIFY_MOCK.orphanNotes],
        ['Doublons concepts', GRAPHIFY_MOCK.duplicates],
        ['Liens faibles', GRAPHIFY_MOCK.weakLinks],
      ];

  const nextAction = isLive
    ? `Voir le graphe → ${String(details.html_route ?? '/graphify/jarvis')}`
    : GRAPHIFY_MOCK.nextAction;

  const htmlRoute = String(connector?.details?.html_route ?? '/graphify/jarvis');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/jarvis-personal/project/graphify')}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate('/jarvis-personal/project/graphify'); }}
      className="hud-panel p-5 flex flex-col gap-3 h-full cursor-pointer"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 6%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
        border: `1px solid color-mix(in srgb, ${accent} 16%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-sm flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <GitBranch size={13} style={{ color: accent }} />
            Graphify
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            Cartographie et analyse du vault
            {!isLive && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
                style={{ background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', color: 'var(--color-warning)', border: '1px solid color-mix(in srgb, var(--color-warning) 22%, transparent)' }}
              >
                à connecter
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onStatusClick}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer"
          style={{
            background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
            color: cfg.color,
            border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)`,
          }}
        >
          <span className="inline-block rounded-full h-1.5 w-1.5" style={{ background: cfg.color }} />
          {cfg.label}
        </button>
      </div>
      <div
        className="rounded-xl px-3 py-2.5 flex-1"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div className="space-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
              <span style={{ color: 'var(--color-text)' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
      {isLive ? (
        <a
          href={htmlRoute}
          onClick={(e) => e.stopPropagation()}
          className="text-xs mt-auto"
          style={{ color: accent }}
        >
          › {nextAction}
        </a>
      ) : (
        <div className="text-xs mt-auto" style={{ color: accent }}>
          › {nextAction}
        </div>
      )}
    </div>
  );
}

function ObsidianProjectCard({
  status,
  onStatusClick,
  ideas,
}: {
  status: ProjectStatus;
  onStatusClick: () => void;
  ideas: { total: number; pending: number } | null;
}) {
  const navigate = useNavigate();
  const cfg = PROJECT_STATUS_CONFIG[status];
  const accent = 'var(--color-accent-purple)';
  const isLive = ideas !== null;

  const rows: [string, string, string?][] = isLive
    ? [
        ['Idées inbox', String(ideas.total)],
        ['En attente', String(ideas.pending)],
        ['Traitées', String(ideas.total - ideas.pending)],
      ]
    : [
        ['Idées inbox', OBSIDIAN_MOCK.ideasInbox],
        ['À classer', OBSIDIAN_MOCK.toClassify],
        ['État actuel mis à jour', OBSIDIAN_MOCK.lastStateUpdate],
      ];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate('/jarvis-personal/project/obsidian')}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate('/jarvis-personal/project/obsidian'); }}
      className="hud-panel p-5 flex flex-col gap-3 h-full cursor-pointer"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 6%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
        border: `1px solid color-mix(in srgb, ${accent} 16%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-sm flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <BookOpen size={13} style={{ color: accent }} />
            Obsidian
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            Second brain et mémoire durable
            {!isLive && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
                style={{ background: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', color: 'var(--color-warning)', border: '1px solid color-mix(in srgb, var(--color-warning) 22%, transparent)' }}
              >
                à connecter
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onStatusClick(); }}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer"
          style={{
            background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
            color: cfg.color,
            border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)`,
          }}
        >
          <span className="inline-block rounded-full h-1.5 w-1.5" style={{ background: cfg.color }} />
          {cfg.label}
        </button>
      </div>
      <div
        className="rounded-xl px-3 py-2.5 flex-1"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div className="space-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
              <span style={{ color: 'var(--color-text)' }}>{value}</span>
            </div>
          ))}
          <div className="flex justify-between">
            <span style={{ color: 'var(--color-text-tertiary)' }}>Santé mémoire</span>
            <span style={{ color: isLive ? 'var(--color-success)' : 'var(--color-warning)' }}>
              {isLive ? 'OK' : OBSIDIAN_MOCK.memoryHealth}
            </span>
          </div>
        </div>
      </div>
      <div className="text-xs mt-auto" style={{ color: accent }}>
        › {isLive ? `${ideas!.total} idées — voir vault` : 'Connecter vault Obsidian'}
      </div>
    </div>
  );
}

function ValenaProjectCard({
  status,
  onStatusClick,
}: {
  status: ProjectStatus;
  onStatusClick: () => void;
}) {
  const cfg = PROJECT_STATUS_CONFIG[status];
  const accent = '#F87171';

  return (
    <div
      className="hud-panel p-5 flex flex-col gap-3 h-full cursor-default"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 6%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
        border: `1px solid color-mix(in srgb, ${accent} 16%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-sm flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <Mic size={13} style={{ color: accent }} />
            Valéna
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            Assistante vocale IA
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide"
              style={{ background: 'color-mix(in srgb, var(--color-text-tertiary) 12%, transparent)', color: 'var(--color-text-tertiary)', border: '1px solid color-mix(in srgb, var(--color-text-tertiary) 20%, transparent)' }}
            >
              conception
            </span>
          </div>
        </div>
        <button
          onClick={onStatusClick}
          className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer"
          style={{
            background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
            color: cfg.color,
            border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)`,
          }}
        >
          <span className="inline-block rounded-full h-1.5 w-1.5" style={{ background: cfg.color }} />
          {cfg.label}
        </button>
      </div>
      <div
        className="rounded-xl px-3 py-2.5 flex-1"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div className="space-y-1 text-xs">
          {([
            ['Statut', VALENA_MOCK.status],
            ['Prochaine étape', VALENA_MOCK.nextStep],
            ['Docs en attente', VALENA_MOCK.pendingDocs],
          ] as const).map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
              <span style={{ color: 'var(--color-text)' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="text-xs mt-auto" style={{ color: 'var(--color-text-tertiary)' }}>
        › {VALENA_MOCK.nextStep}
      </div>
    </div>
  );
}

function ProjectsGrid({ cockpitData }: { cockpitData: PersonalCockpitSnapshot }) {
  const [advSnap, setAdvSnap] = useState<AdvSnapshot | null>(null);
  useEffect(() => { fetchAdvSnapshot().then(setAdvSnap).catch(() => {}); }, []);

  const [obsidianIdeas, setObsidianIdeas] = useState<{ total: number; pending: number } | null>(null);
  useEffect(() => {
    fetchIdeas().then((items) => setObsidianIdeas({ total: items.length, pending: items.filter((i) => !i.done).length })).catch(() => {});
  }, []);

  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>(() => {
    try {
      const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
      const stored = raw ? JSON.parse(raw) : {};
      const result: Record<string, ProjectStatus> = {};
      for (const p of PROJECT_DEFS) {
        result[p.id] = (stored[p.id] as ProjectStatus) || p.defaultStatus;
      }
      return result;
    } catch {
      const result: Record<string, ProjectStatus> = {};
      for (const p of PROJECT_DEFS) result[p.id] = p.defaultStatus;
      return result;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(statuses));
    } catch {}
  }, [statuses]);

  const cycleStatus = (id: string) =>
    setStatuses((prev) => ({ ...prev, [id]: PROJECT_STATUS_CYCLE[prev[id] || 'active'] }));

  const graphifyConnector = cockpitData.connectors.find((c) => c.name === 'Graphify') ?? null;

  const jarvisAlerts = cockpitData.alerts.filter(
    (a) => a.level === 'warning' || a.level === 'error',
  ).length;

  const lastActivityJarvis =
    cockpitData.general_state.age_seconds != null
      ? `${fmtAgo(cockpitData.general_state.age_seconds)} ago`
      : '—';

  const standardProjects = PROJECT_DEFS.filter((p) => !['adv', 'graphify', 'obsidian', 'valena'].includes(p.id));

  return (
    <Section id="projects" title="Mes projets" icon={Layers}>
      {/* ADV — carte pleine largeur avec KPIs business */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, delay: 0, ease: [0.25, 0.1, 0.25, 1] }}
        className="mb-3"
      >
        <AdvProjectCard
          status={statuses['adv'] || 'active'}
          onStatusClick={() => cycleStatus('adv')}
          snap={advSnap}
        />
      </motion.div>

      {/* Rangée 2 : Jarvis/Hermès, Graphify, Obsidian */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        {([
          <JarvisProjectCard
            status={statuses['jarvis'] || 'active'}
            onStatusClick={() => cycleStatus('jarvis')}
            cockpitData={cockpitData}
          />,
          <GraphifyProjectCard
            status={statuses['graphify'] || 'active'}
            onStatusClick={() => cycleStatus('graphify')}
            connector={graphifyConnector}
          />,
          <ObsidianProjectCard
            status={statuses['obsidian'] || 'active'}
            onStatusClick={() => cycleStatus('obsidian')}
            ideas={obsidianIdeas}
          />,
        ].map((card, i) => (
          <motion.div
            key={i}
            className="h-full"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.07 + i * 0.07, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {card}
          </motion.div>
        )))}
      </div>

      {/* Rangée 3 : Valéna + projets standards (ABG…) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <motion.div
          className="h-full"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <ValenaProjectCard
            status={statuses['valena'] || 'pause'}
            onStatusClick={() => cycleStatus('valena')}
          />
        </motion.div>
        {standardProjects.map((project, i) => (
          <motion.div
            key={project.id}
            className="h-full"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.35 + i * 0.07, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <ProjectCard
              project={project}
              status={statuses[project.id] || project.defaultStatus}
              alertCount={0}
              lastActivity="—"
              onStatusClick={() => cycleStatus(project.id)}
            />
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ─── Obsidian Action Inbox ────────────────────────────────────────────────────

const ACTION_CATEGORY_COLORS: Record<string, { color: string; bg: string }> = {
  idea: { color: 'var(--color-accent-blue)', bg: 'color-mix(in srgb, var(--color-accent-blue) 14%, transparent)' },
  task: { color: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)' },
  note: { color: 'var(--color-text-secondary)', bg: 'color-mix(in srgb, var(--color-text-secondary) 14%, transparent)' },
  decision: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)' },
  urgency: { color: 'var(--color-error)', bg: 'color-mix(in srgb, var(--color-error) 14%, transparent)' },
  document: { color: 'var(--color-text-tertiary)', bg: 'color-mix(in srgb, var(--color-text-tertiary) 14%, transparent)' },
};

const ACTION_PRIORITY_COLOR: Record<string, string> = {
  urgent: 'var(--color-error)',
  high: 'var(--color-warning)',
  medium: 'var(--color-accent-blue)',
  low: 'var(--color-text-tertiary)',
};

function ObsidianActionInboxList({
  items,
  source,
}: {
  items: ObsidianActionItem[];
  source?: ObsidianActionInboxSource;
}) {
  const [expanded, setExpanded] = useState(true);
  const mode = source?.mode || 'mock';
  const sourceBadge =
    mode === 'real'
      ? { label: 'Obsidian réel', color: 'var(--color-success)' }
      : mode === 'fallback_json'
      ? { label: 'Fallback JSON', color: 'var(--color-warning)' }
      : { label: 'Mock', color: 'var(--color-text-tertiary)' };
  return (
    <div
      className="rounded-2xl mb-4"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text)' }}>
            À traiter — structuré
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ color: sourceBadge.color, background: `color-mix(in srgb, ${sourceBadge.color} 14%, transparent)` }}
          >
            {sourceBadge.label}
          </span>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs cursor-pointer"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {expanded ? '▲ Masquer' : `▼ Voir les ${items.length} éléments`}
          </button>
        )}
      </div>
      {source?.detail && (
        <div className="px-4 pb-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {source.detail}
        </div>
      )}
      {/* List */}
      {items.length === 0 ? (
        <div className="px-4 pb-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Aucun élément structuré à traiter dans la source active.
        </div>
      ) : expanded && (
        <div className="px-4 pb-4 flex flex-col gap-2">
          {items.map((item) => {
            const catColor = ACTION_CATEGORY_COLORS[item.category] ?? ACTION_CATEGORY_COLORS.note;
            const prioColor = ACTION_PRIORITY_COLOR[item.priority] ?? 'var(--color-text-tertiary)';
            return (
              <div
                key={item.id}
                className="rounded-xl p-3"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderLeft: `3px solid ${prioColor}`,
                }}
              >
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--color-text)' }}>
                    {item.title}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                    style={{ color: catColor.color, background: catColor.bg }}
                  >
                    {item.category}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                    style={{ color: prioColor, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
                  >
                    {item.priority}
                  </span>
                </div>
                <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {item.action_requested}
                </p>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    {item.project}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    Owner : {item.owner}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                    {item.source_path}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    {fmtDate(item.updated_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Ideas Inbox ──────────────────────────────────────────────────────────────

const INBOX_STORAGE_KEY = 'ruth_ideas_inbox';

type IdeaTag = 'Business' | 'ADV' | 'Jarvis' | 'TikTok' | 'Perso' | 'Urgent' | 'À classer';

interface IdeaItem {
  id: string;
  text: string;
  tag: IdeaTag;
  createdAt: number;
  obsidian_path?: string;
  section?: string;
}

const IDEA_TAGS: IdeaTag[] = ['Urgent', 'ADV', 'Jarvis', 'Business', 'Perso', 'TikTok', 'À classer'];

const IDEA_TAG_COLORS: Record<IdeaTag, { color: string; bg: string }> = {
  Business: {
    color: 'var(--color-accent)',
    bg: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
  },
  ADV: {
    color: 'var(--color-success)',
    bg: 'color-mix(in srgb, var(--color-success) 16%, transparent)',
  },
  Jarvis: {
    color: 'var(--color-accent-purple)',
    bg: 'color-mix(in srgb, var(--color-accent-purple) 16%, transparent)',
  },
  TikTok: {
    color: '#F87171',
    bg: 'color-mix(in srgb, #F87171 16%, transparent)',
  },
  Perso: {
    color: 'var(--color-text-secondary)',
    bg: 'color-mix(in srgb, var(--color-text-secondary) 14%, transparent)',
  },
  Urgent: {
    color: 'var(--color-error)',
    bg: 'color-mix(in srgb, var(--color-error) 14%, transparent)',
  },
  'À classer': {
    color: 'var(--color-text-tertiary)',
    bg: 'color-mix(in srgb, var(--color-text-tertiary) 12%, transparent)',
  },
};

function fmtIdeaDate(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days}j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function IdeasInbox({
  structuredItems = [],
  structuredSource,
}: {
  structuredItems?: ObsidianActionItem[];
  structuredSource?: ObsidianActionInboxSource;
}) {
  const [ideas, setIdeas] = useState<IdeaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [selectedTag, setSelectedTag] = useState<IdeaTag>('Business');
  const [filterTag, setFilterTag] = useState<IdeaTag | null>(null);
  const [saving, setSaving] = useState(false);

  const loadIdeas = useCallback(() => {
    fetchIdeas()
      .then((data) => {
        setIdeas(
          data
            .filter((item) => !item.done)
            .map((item) => ({
              id: item.id,
              text: item.text,
              tag: (IDEA_TAGS.includes(item.tag as IdeaTag) ? item.tag : 'Business') as IdeaTag,
              createdAt: 0,
              obsidian_path: item.obsidian_path,
              section: item.section,
            })),
        );
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem(INBOX_STORAGE_KEY);
          if (raw) setIdeas(JSON.parse(raw));
        } catch {}
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadIdeas();
    const interval = setInterval(loadIdeas, 60_000);
    return () => clearInterval(interval);
  }, [loadIdeas]);

  const addIdea = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const result = await createIdea(text, selectedTag, today);
      setIdeas((prev) => [
        { id: crypto.randomUUID(), text, tag: selectedTag, createdAt: Date.now(), obsidian_path: result.obsidian_path, section: result.section },
        ...prev,
      ]);
      if (result.ok) {
        toast.success("Idée enregistrée dans Obsidian", {
          description: result.section,
          duration: 3000,
        });
      }
    } catch {
      setIdeas((prev) => [
        { id: crypto.randomUUID(), text, tag: selectedTag, createdAt: Date.now() },
        ...prev,
      ]);
      toast.info("Hermès hors ligne — idée sauvegardée localement");
    } finally {
      setSaving(false);
      setDraft('');
    }
  };

  const deleteIdea = (idea: IdeaItem) => {
    setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
    if (idea.obsidian_path) {
      toggleIdea(idea.text, idea.section || '', true).catch(() => {});
    }
  };

  const visible = filterTag ? ideas.filter((i) => i.tag === filterTag) : ideas;

  return (
    <Section id="ideas-inbox" title="Inbox Obsidian / À traiter" subtitle="Idées, tâches, notes ADV, Jarvis, business, perso — tout ce qui n'est pas encore traité." icon={Lightbulb}>
      {/* Structured action inbox */}
      <ObsidianActionInboxList items={structuredItems} source={structuredSource} />
      {/* Capture */}
      <div
        className="rounded-2xl p-4 mb-4"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addIdea(); }}
            placeholder={"Capturer une idée..."}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--color-text)' }}
          />
          <button
            onClick={addIdea}
            disabled={!draft.trim() || saving}
            className="shrink-0 p-1.5 rounded-lg disabled:opacity-30 cursor-pointer"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {IDEA_TAGS.map((tag) => {
            const tc = IDEA_TAG_COLORS[tag];
            const active = selectedTag === tag;
            return (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className="px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-opacity"
                style={{
                  color: tc.color,
                  background: active ? tc.bg : 'transparent',
                  border: `1px solid ${active ? tc.color : 'var(--color-border)'}`,
                  opacity: active ? 1 : 0.6,
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter pills */}
      {ideas.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setFilterTag(null)}
            className="px-2.5 py-1 rounded-full text-xs cursor-pointer"
            style={{
              background: filterTag === null ? 'var(--color-bg-tertiary)' : 'transparent',
              color: filterTag === null ? 'var(--color-text)' : 'var(--color-text-tertiary)',
              border: '1px solid var(--color-border)',
            }}
          >
            Tout ({ideas.length})
          </button>
          {IDEA_TAGS.filter((t) => ideas.some((i) => i.tag === t)).map((tag) => {
            const tc = IDEA_TAG_COLORS[tag];
            const count = ideas.filter((i) => i.tag === tag).length;
            return (
              <button
                key={tag}
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                className="px-2.5 py-1 rounded-full text-xs cursor-pointer"
                style={{
                  color: tc.color,
                  background: filterTag === tag ? tc.bg : 'transparent',
                  border: `1px solid ${filterTag === tag ? tc.color : 'var(--color-border)'}`,
                }}
              >
                {tag} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Cards */}
      {loading ? (
        <div className="flex items-center gap-2 py-4" style={{ color: 'var(--color-text-tertiary)' }}>
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">{"Chargement depuis Obsidian..."}</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-sm py-4 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
          {ideas.length === 0
            ? "Aucune idée capturée. Commence à écrire ci-dessus."
            : "Aucune idée dans cette catégorie."}
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((idea, i) => {
            const tc = IDEA_TAG_COLORS[idea.tag];
            return (
              <motion.div
                key={idea.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.18, delay: i * 0.04 }}
                className="rounded-2xl p-4 group relative"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {/* Tag + delete */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ color: tc.color, background: tc.bg }}
                  >
                    {idea.tag}
                  </span>
                  <button
                    onClick={() => deleteIdea(idea)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5 rounded"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    <X size={13} />
                  </button>
                </div>
                {/* Text */}
                <div className="text-sm leading-snug" style={{ color: 'var(--color-text)' }}>
                  {idea.text}
                </div>
                {/* Date / Obsidian badge */}
                <div className="flex items-center gap-1.5 mt-2">
                  {idea.obsidian_path && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        color: 'var(--color-success)',
                        background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                      }}
                    >
                      Obsidian
                    </span>
                  )}
                  {idea.createdAt > 0 && (
                    <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {fmtIdeaDate(idea.createdAt)}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
        </AnimatePresence>
      )}
    </Section>
  );
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

const DISMISSED_ALERTS_KEY = 'ruth_dismissed_alerts';

function alertFingerprint(a: { level: string; title: string }): string {
  return `${a.level}:${a.title}`;
}

const ALERT_LEVEL_CONFIG = {
  error: {
    label: 'Critique',
    color: 'var(--color-error)',
    bg: 'color-mix(in srgb, var(--color-error) 10%, var(--color-surface))',
    border: 'color-mix(in srgb, var(--color-error) 28%, transparent)',
    dot: 'var(--color-error)',
  },
  warning: {
    label: 'Important',
    color: 'var(--color-warning)',
    bg: 'color-mix(in srgb, var(--color-warning) 8%, var(--color-surface))',
    border: 'color-mix(in srgb, var(--color-warning) 24%, transparent)',
    dot: 'var(--color-warning)',
  },
  info: {
    label: 'Info',
    color: 'var(--color-text-secondary)',
    bg: 'var(--color-bg-secondary)',
    border: 'var(--color-border)',
    dot: 'var(--color-text-tertiary)',
  },
} as const;

type AlertLevel = keyof typeof ALERT_LEVEL_CONFIG;

function AlertRow({
  level,
  title,
  detail,
  onAction,
  onDismiss,
}: {
  level: AlertLevel;
  title: string;
  detail: string;
  onAction?: (action: HermesAlertAction) => Promise<void>;
  onDismiss?: () => void;
}) {
  const [submitting, setSubmitting] = useState<HermesAlertAction | null>(null);
  const cfg = ALERT_LEVEL_CONFIG[level];
  const connected = typeof onAction === 'function';

  const triggerAction = async (action: HermesAlertAction) => {
    if (!onAction || submitting) return;
    setSubmitting(action);
    try {
      await onAction(action);
      if (action === 'ignore') {
        onDismiss?.();
      }
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1 shrink-0 inline-block rounded-full h-2 w-2"
          style={{ background: cfg.dot }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium" style={{ color: cfg.color }}>
              {title}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded"
                style={{
                  background: connected
                    ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
                    : 'color-mix(in srgb, var(--color-text-tertiary) 10%, transparent)',
                  color: connected ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                  border: connected
                    ? '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)'
                    : '1px solid var(--color-border)',
                }}
              >
                {connected ? '[ACTION CONNECTÉE]' : '[ACTION NON CONNECTÉE]'}
              </span>
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  title="Masquer cette alerte"
                  className="p-1 rounded cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          {detail && (
            <div className="text-sm mt-0.5 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>
              {detail}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3 pl-5">
        {[
          { label: 'Corriger', value: 'fix' as HermesAlertAction },
          { label: 'Créer tâche', value: 'create_task' as HermesAlertAction },
          { label: 'Ignorer', value: 'ignore' as HermesAlertAction },
        ].map((entry) => (
          <button
            key={entry.value}
            disabled={!connected || submitting !== null}
            onClick={() => void triggerAction(entry.value)}
            className={`text-xs px-3 py-1 rounded-full ${connected ? 'cursor-pointer' : 'cursor-not-allowed opacity-45'}`}
            style={{
              background: 'color-mix(in srgb, var(--color-text-tertiary) 10%, transparent)',
              color: 'var(--color-text-tertiary)',
              border: '1px solid var(--color-border)',
            }}
            title={connected ? "Journalise l'action d'alerte dans Hermès" : "Backend d'action alerte absent"}
          >
            {submitting === entry.value ? '...' : entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AlertsSection({
  alerts,
  onAlertAction,
}: {
  alerts: Array<{ level: string; title: string; detail: string }>;
  onAlertAction: (action: HermesAlertAction, alert: { level: string; title: string; detail: string }) => Promise<void>;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const dismiss = (fp: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(fp);
      try {
        localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const resetDismissed = () => {
    setDismissed(new Set());
    try {
      localStorage.removeItem(DISMISSED_ALERTS_KEY);
    } catch {}
  };

  const activeAlerts = alerts.filter((a) => {
    if (a.level === 'ok') return false;
    return !dismissed.has(alertFingerprint(a));
  });

  const byLevel = (lvl: AlertLevel) =>
    activeAlerts.filter((a) => a.level === lvl) as Array<{ level: AlertLevel; title: string; detail: string }>;

  const critiques = byLevel('error');
  const importants = byLevel('warning');
  const infos = byLevel('info');

  const totalDismissed = dismissed.size;

  const countBadge = (count: number, cfg: (typeof ALERT_LEVEL_CONFIG)[AlertLevel]) =>
    count > 0 ? (
      <span
        className="px-2 py-0.5 rounded-full text-[11px] font-medium"
        style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
      >
        {count}
      </span>
    ) : null;

  const actionArea = totalDismissed > 0 && (
    <button
      onClick={resetDismissed}
      className="text-xs cursor-pointer hover:underline"
      style={{ color: 'var(--color-text-tertiary)' }}
    >
      {`Réafficher ${totalDismissed} traité${totalDismissed > 1 ? 's' : ''}`}
    </button>
  );

  return (
    <Section
      id="alerts"
      title="Alertes"
      icon={Bell}
      action={
        <div className="flex items-center gap-2">
          {countBadge(critiques.length, ALERT_LEVEL_CONFIG.error)}
          {countBadge(importants.length, ALERT_LEVEL_CONFIG.warning)}
          {countBadge(infos.length, ALERT_LEVEL_CONFIG.info)}
          {actionArea}
        </div>
      }
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {activeAlerts.length === 0 ? (
          <motion.div
            key="nominal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-2 rounded-xl px-4 py-3"
            style={{
              background: 'color-mix(in srgb, var(--color-success) 8%, var(--color-surface))',
              border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)',
            }}
          >
            <CheckCircle2 size={15} style={{ color: 'var(--color-success)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>
              {"Aucune alerte active — tout est nominal."}
            </span>
          </motion.div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {[...critiques, ...importants, ...infos].map((a) => (
                <motion.div
                  key={alertFingerprint(a)}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <AlertRow
                    level={a.level}
                    title={a.title}
                    detail={a.detail}
                    onAction={(action) => onAlertAction(action, a)}
                    onDismiss={() => dismiss(alertFingerprint(a))}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>
    </Section>
  );
}

// ─── Today ────────────────────────────────────────────────────────────────────

const TODAY_STORAGE_KEY = 'ruth_today_priorities';

function TodaySection({
  alerts,
  nextMove,
  pendingValidations,
}: {
  alerts: Array<{ title: string; detail: string; level: 'warning' | 'info' | 'ok' }>;
  nextMove: { title: string; detail: string; actionLabel: string; targetId: string };
  pendingValidations: PendingValidation[];
}) {
  const [priorities, setPriorities] = useState<Array<{ id: string; text: string; done: boolean }>>(() => {
    try {
      const raw = localStorage.getItem(TODAY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(TODAY_STORAGE_KEY, JSON.stringify(priorities));
    } catch {}
  }, [priorities]);

  const addItem = () => {
    const text = draft.trim();
    if (!text) return;
    setPriorities((p) => [...p, { id: crypto.randomUUID(), text, done: false }]);
    setDraft('');
  };

  const toggleItem = (id: string) =>
    setPriorities((p) => p.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));

  const deleteItem = (id: string) => setPriorities((p) => p.filter((item) => item.id !== id));

  const activeAlerts = alerts.filter((a) => a.level !== 'ok');
  const activePvs = pendingValidations.filter((v) => v.status !== 'done');
  const topPv = activePvs.find((v) => v.priority === 'urgent') ?? activePvs[0];

  return (
    <Section id="today" title="Aujourd'hui" icon={CalendarDays}>
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-4">
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <div className="text-xs uppercase tracking-[0.16em] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
            {"Priorités du jour"}
          </div>
          {priorities.length === 0 && (
            <div className="text-sm mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
              {"Aucune priorité. Ajoute la première ci-dessous."}
            </div>
          )}
          <ul className="space-y-2 mb-4">
            {priorities.map((item) => (
              <li key={item.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => toggleItem(item.id)}
                  className="shrink-0 cursor-pointer transition-colors"
                  style={{ color: item.done ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
                >
                  {item.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                </button>
                <span
                  className="flex-1 text-sm"
                  style={{
                    color: item.done ? 'var(--color-text-tertiary)' : 'var(--color-text)',
                    textDecoration: item.done ? 'line-through' : 'none',
                  }}
                >
                  {item.text}
                </span>
                <button
                  onClick={() => deleteItem(item.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              placeholder="Ajouter une priorité..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--color-text)' }}
            />
            <button
              onClick={addItem}
              disabled={!draft.trim()}
              className="shrink-0 p-1 rounded-lg disabled:opacity-30 cursor-pointer"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
                color: 'var(--color-accent)',
              }}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {topPv && (
            <div
              className="rounded-2xl px-4 py-3"
              style={{
                background: topPv.priority === 'urgent'
                  ? 'color-mix(in srgb, var(--color-error) 10%, var(--color-surface))'
                  : 'color-mix(in srgb, var(--color-warning) 10%, var(--color-surface))',
                border: `1px solid color-mix(in srgb, ${topPv.priority === 'urgent' ? 'var(--color-error)' : 'var(--color-warning)'} 30%, transparent)`,
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={13} style={{ color: topPv.priority === 'urgent' ? 'var(--color-error)' : 'var(--color-warning)', flexShrink: 0 }} />
                  <span className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: topPv.priority === 'urgent' ? 'var(--color-error)' : 'var(--color-warning)' }}>
                    À valider · {topPv.project}
                  </span>
                </div>
                {activePvs.length > 1 && (
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    +{activePvs.length - 1} autre{activePvs.length > 2 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                {topPv.title}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                {topPv.expected_action.length > 100 ? topPv.expected_action.slice(0, 100) + '…' : topPv.expected_action}
              </div>
              <button
                onClick={() => document.getElementById('pending-validation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="text-xs mt-2 cursor-pointer"
                style={{ color: 'var(--color-accent-blue)', textDecoration: 'underline', background: 'none', border: 'none', padding: 0 }}
              >
                Voir toutes les validations ({activePvs.length})
              </button>
            </div>
          )}
          {activeAlerts.length > 0 && !topPv ? (
            activeAlerts.slice(0, 2).map((a, i) => (
              <AttentionCard key={i} title={a.title} detail={a.detail} level={a.level} />
            ))
          ) : activeAlerts.length > 0 && topPv ? (
            <AttentionCard title={activeAlerts[0].title} detail={activeAlerts[0].detail} level={activeAlerts[0].level} />
          ) : !topPv ? (
            <div
              className="rounded-2xl px-4 py-4"
              style={{
                background: 'color-mix(in srgb, var(--color-success) 8%, var(--color-surface))',
                border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)',
              }}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} style={{ color: 'var(--color-success)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>
                  {"Aucune alerte active · Aucune validation en attente"}
                </span>
              </div>
            </div>
          ) : null}
          <GuidanceCard title={nextMove.title} detail={nextMove.detail} />
        </div>
      </div>
    </Section>
  );
}

function MemoryGraphifySection({
  fileHealth,
}: {
  fileHealth: Record<string, PersonalCockpitFileHealth>;
}) {
  const entries = Object.entries(fileHealth || {});
  const presentCount = entries.filter(([, v]) => v.exists).length;
  const missingCount = entries.filter(([, v]) => !v.exists).length;

  return (
    <Section
      id="memory-graphify"
      title="Mémoire & Graphify"
      subtitle="Santé Obsidian, états actuel, carte conceptuelle."
      icon={Brain}
    >
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Fichiers Hermès */}
        <div
          className="rounded-2xl px-4 py-4"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <div className="text-xs uppercase tracking-[0.16em] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
            Fichiers Hermès (file_health)
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div
              className="rounded-xl px-3 py-2 text-center"
              style={{
                background: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-success) 24%, transparent)',
              }}
            >
              <div className="text-xl font-semibold" style={{ color: 'var(--color-success)' }}>{presentCount}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Présents</div>
            </div>
            <div
              className="rounded-xl px-3 py-2 text-center"
              style={{
                background: missingCount > 0
                  ? 'color-mix(in srgb, var(--color-error) 8%, transparent)'
                  : 'var(--color-surface)',
                border: missingCount > 0
                  ? '1px solid color-mix(in srgb, var(--color-error) 22%, transparent)'
                  : '1px solid var(--color-border)',
              }}
            >
              <div
                className="text-xl font-semibold"
                style={{ color: missingCount > 0 ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}
              >
                {missingCount}
              </div>
              <div className="text-[10px] uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Manquants</div>
            </div>
          </div>
          <div className="space-y-1.5">
            {entries.slice(0, 8).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>{key}</span>
                <Badge value={val.exists ? 'présent' : 'absent'} />
              </div>
            ))}
          </div>
        </div>

        {/* Graphify */}
        <div
          className="rounded-2xl px-4 py-4"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <GitBranch size={13} style={{ color: 'var(--color-accent)' }} />
            <div className="text-xs uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Graphify — Carte conceptuelle
            </div>
          </div>
          <div className="space-y-2 text-xs mb-4">
            {([
              ['Dernier scan', GRAPHIFY_MOCK.lastScan],
              ['Notes orphelines', GRAPHIFY_MOCK.orphanNotes],
              ['Doublons conceptuels', GRAPHIFY_MOCK.duplicates],
              ['Liens faibles', GRAPHIFY_MOCK.weakLinks],
            ] as const).map(([label, value]) => (
              <div key={label} className="flex justify-between items-center">
                <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                <span style={{ color: 'var(--color-text)' }}>{value}</span>
              </div>
            ))}
          </div>
          <div
            className="rounded-xl px-3 py-2.5 mb-3"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--color-accent)' }}>
              Prochaine action
            </div>
            <div className="text-xs" style={{ color: 'var(--color-text)' }}>
              {GRAPHIFY_MOCK.nextAction}
            </div>
          </div>
          <div className="text-xs mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
            Inbox globale · Liens à créer · Notes à classer
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['Inbox', 'Liens', 'À classer'] as const).map((chip) => (
              <span
                key={chip}
                className="px-2 py-1 rounded-full text-[11px]"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {chip} —
              </span>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

export function JarvisCockpitFullView() {
  const [data, setData] = useState<PersonalCockpitSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forceHermesChatFocus, setForceHermesChatFocus] = useState(false);
  const [alertActionKey, setAlertActionKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchPersonalCockpit();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cockpit indisponible');
    } finally {
      setLoading(false);
    }
  }, []);

  const scrollToId = useCallback((id: string) => {
    const node = document.getElementById(id);
    if (!node) return;
    const details = node.tagName.toLowerCase() === 'details' ? (node as HTMLDetailsElement) : null;
    if (details) details.open = true;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const copyText = useCallback(async (value: string, successLabel: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successLabel);
    } catch {
      toast.error('Impossible de copier cette information');
    }
  }, []);

  const handleHermesValidation = useCallback(async (decision: HermesValidationDecision) => {
    try {
      const result = await submitHermesValidation(decision);
      if (decision === 'approve') {
        toast.success(result.message || 'Validation Hermès enregistrée');
      } else {
        toast.info(result.message || 'Validation Hermès refusée');
      }
      if (result.warning) {
        toast.warning(result.warning);
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation Hermès impossible');
      throw err;
    }
  }, [refresh]);

  const handleAlertAction = useCallback(async (
    action: HermesAlertAction,
    alert: { level: string; title: string; detail: string },
  ) => {
    try {
      const result = await submitHermesAlertAction(action, {
        alert_title: alert.title,
        alert_detail: alert.detail,
        alert_level: alert.level,
        source: 'cockpit',
      });
      toast.success(result.message || "Action d'alerte enregistrée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action d'alerte impossible");
      throw err;
    }
  }, []);

  useEffect(() => {
    refresh();
    let timer: number | null = null;

    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(() => {
        refresh();
        schedule();
      }, 12000);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    const shouldFocusChat = () => {
      const hash = window.location.hash || '';
      const params = new URLSearchParams(window.location.search);
      if (hash !== '#hermes-chat' && params.get('mode') !== 'chat') return;
      setForceHermesChatFocus(false);
      window.setTimeout(() => setForceHermesChatFocus(true), 40);
      const section = document.getElementById('hermes-chat');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    shouldFocusChat();
    window.addEventListener('hashchange', shouldFocusChat);
    return () => window.removeEventListener('hashchange', shouldFocusChat);
  }, []);

  const derived = useMemo(() => {
    if (!data) {
      return {
        attentionCards: [] as Array<{ title: string; detail: string; level: 'warning' | 'info' | 'ok' }>,
        connectorSummary: '',
        continuityLead: '',
        latestOperationalSummary: '',
        nextMove: {
          title: '',
          detail: '',
          actionLabel: '',
          targetId: '',
        },
      };
    }

    const attentionCards: Array<{ title: string; detail: string; level: 'warning' | 'info' | 'ok' }> = [];

    const pvs = (data.pending_validations ?? []) as PendingValidation[];
    const activePvs = pvs.filter((v) => v.status !== 'done');
    const topPv = activePvs.find((v) => v.priority === 'urgent') ?? activePvs[0];
    if (topPv) {
      attentionCards.push({
        title: `À valider : ${topPv.title}`,
        detail: `${topPv.expected_action}${activePvs.length > 1 ? ` (+${activePvs.length - 1} autre${activePvs.length > 2 ? 's' : ''})` : ''}`,
        level: topPv.priority === 'urgent' ? 'warning' : 'info',
      });
    } else if (data.pending_validation) {
      attentionCards.push({
        title: 'Validation Hermès en attente',
        detail: String(data.pending_validation.action || 'Une action réelle attend une validation.'),
        level: 'warning',
      });
    } else {
      attentionCards.push({
        title: 'Aucune validation bloquante',
        detail: "Aucun blocage en attente maintenant.",
        level: 'ok',
      });
    }

    if (data.alerts.length > 0) {
      const first = data.alerts[0];
      attentionCards.push({
        title: first.title,
        detail: first.detail,
        level: first.level === 'warning' ? 'warning' : first.level === 'info' ? 'info' : 'warning',
      });
    } else {
      attentionCards.push({
        title: 'Alerte récente',
        detail: 'Aucune alerte notable sur les dernières traces du cockpit.',
        level: 'ok',
      });
    }

    if (data.priority_lane?.headline) {
      attentionCards.push({
        title: data.priority_lane.headline,
        detail: data.priority_lane.detail,
        level: data.priority_lane.severity === 'warning' ? 'warning' : data.priority_lane.severity === 'ok' ? 'ok' : 'info',
      });
    } else {
      const lastDynamicSummary =
        String(data.yahoo_dynamic_result?.voice_summary || data.yahoo_dynamic_result?.action || '').trim() ||
        'Pas de résultat Yahoo dynamique récent.';
      attentionCards.push({
        title: 'Dernier mouvement Yahoo',
        detail: lastDynamicSummary,
        level: 'info',
      });
    }

    const connectorSummary = data.connectors
      .map((connector) => `${connector.name}: ${connector.status}`)
      .join(' · ');

    const continuityLead = data.continuity[0]?.summary || 'Aucun extrait de continuité récent.';
    const latestOperationalSummary =
      String(
        data.yahoo_dynamic_result?.voice_summary ||
          data.yahoo_targeted_move?.voice_summary ||
          data.last_live_brief?.voice_summary ||
          '',
      ).trim() || 'Aucun résultat opérationnel récent.';

    let nextMove = {
      title: "Rafraîchir ou relire l'état",
      detail: "Le cockpit ne voit pas de blocage immédiat. Le geste le plus utile est de vérifier le dernier résultat ou la continuité récente.",
      actionLabel: 'Aller au dernier résultat',
      targetId: 'yahoo-result',
    };

    if (topPv) {
      nextMove = {
        title: `Traiter : ${topPv.title}`,
        detail: `${topPv.project} — ${topPv.expected_action}`,
        actionLabel: 'Voir les validations',
        targetId: 'pending-validation',
      };
    } else if (data.pending_validation) {
      nextMove = {
        title: 'Traiter la validation vocale en attente',
        detail: "Jarvis attend un oui/non explicite avant toute exécution réelle.",
        actionLabel: 'Ouvrir la validation',
        targetId: 'pending-validation',
      };
    } else if (data.continuity.length > 0) {
      nextMove = {
        title: 'Reprendre le prochain contexte utile',
        detail: "Aucun blocage immédiat n'est en attente. Le geste le plus utile est de relire l'artefact de continuité le plus récent avant de reprendre.",
        actionLabel: 'Ouvrir la continuité',
        targetId: 'continuity-details',
      };
    } else if (latestOperationalSummary) {
      nextMove = {
        title: 'Relire le dernier résultat confirmé',
        detail: 'Le geste le plus sûr est de repartir du dernier résultat opérationnel réellement observé par le cockpit.',
        actionLabel: 'Ouvrir le résultat',
        targetId: 'yahoo-result',
      };
    }

    return { attentionCards, connectorSummary, continuityLead, latestOperationalSummary, nextMove };
  }, [data]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="hud-panel px-6 py-5 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          <span style={{ color: 'var(--color-text)' }}>Chargement du cockpit Jarvis personnel…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
        <div className="max-w-5xl mx-auto">
          <Section title="Cockpit indisponible" icon={AlertTriangle}>
            <div className="text-sm" style={{ color: 'var(--color-error)' }}>
              {error || 'Impossible de charger les données du cockpit.'}
            </div>
          </Section>
        </div>
      </div>
    );
  }

  const general = data.general_state;
  const hermes = data.hermes || {};
  const liveSummary = data.last_live_brief;
  const targeted = data.yahoo_targeted_move;
  const candidate = data.yahoo_dynamic_candidate;
  const finalBatch = data.yahoo_dynamic_result;
  const handoffPath = data.file_health.session_handoffs?.path || '';
  const latestYahooSummary = String(finalBatch?.voice_summary || targeted?.voice_summary || '').trim();
  const hermesNextActions = Array.isArray(hermes.next_actions) ? hermes.next_actions : [];
  const riskGuard = (hermes.risk_guard || {}) as PersonalCockpitRecord;
  const sessionCloser = (hermes.session_closer || {}) as PersonalCockpitRecord;
  const orchestrator = (hermes.orchestrator || {}) as PersonalCockpitRecord;
  const delegation = (hermes.delegation || {}) as PersonalCockpitRecord;
  const toolResearch = (hermes.tool_research || {}) as PersonalCockpitRecord;
  const orchestratorTrace = Array.isArray(orchestrator.recent_trace)
    ? (orchestrator.recent_trace as Array<Record<string, unknown>>)
    : [];
  const backendAttention = Array.isArray(data.attention_now) ? data.attention_now : [];
  const priorities = data.priorities;
  const signals = data.signals || {};
  const cloudBudgetFlag = budgetFlag(
    data.hermes?.chat_runtime?.budget?.estimated_usage_ratio,
    data.hermes?.chat_runtime?.budget?.warning_level,
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8">
      <div className="max-w-7xl mx-auto space-y-4">
        <header
          className="hud-panel p-6"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 8%, var(--color-surface)) 0%, var(--color-surface) 45%, color-mix(in srgb, var(--color-accent-purple) 10%, var(--color-surface)) 100%)',
          }}
        >
          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="hud-heartbeat" />
                <span className="hud-label uppercase tracking-[0.22em]">Ruth OS</span>
              </div>
              <h1
                className="text-3xl md:text-4xl font-semibold leading-tight"
                style={{ color: 'var(--color-text)' }}
              >
                Ruth OS
              </h1>
              <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--color-text-secondary)' }}>
                {"Projets · Hermès · Alertes · Idées · Vie"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="rounded-xl px-3 py-2 text-center"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                  Snapshot
                </div>
                <div className="text-xs hud-mono mt-0.5" style={{ color: 'var(--color-text)' }}>
                  {fmtDate(data.meta.generated_at)}
                </div>
              </div>
              <button
                onClick={refresh}
                className="p-2.5 rounded-xl cursor-pointer"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
                title="Rafraîchir"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          {/* 4 KPI cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
            <SummaryCard
              title="Hermès"
              value={String(hermes.overall || general.status || 'unknown')}
              note={String(general.last_recommended_action || general.active_intent || 'En veille')}
              badge={<Badge value={String(hermes.overall || general.status || 'unknown')} />}
              accent="var(--color-accent-purple)"
            />
            <SummaryCard
              title="Alertes"
              value={
                data.alerts.filter((a) => a.level === 'error' || a.level === 'warning').length > 0
                  ? `${data.alerts.filter((a) => a.level === 'error' || a.level === 'warning').length} active${data.alerts.filter((a) => a.level === 'error' || a.level === 'warning').length > 1 ? 's' : ''}`
                  : 'Nominal'
              }
              note={
                data.alerts.filter((a) => a.level === 'error').length > 0
                  ? `${data.alerts.filter((a) => a.level === 'error').length} critique${data.alerts.filter((a) => a.level === 'error').length > 1 ? 's' : ''}`
                  : 'Aucune critique'
              }
              badge={
                <Badge
                  value={
                    data.alerts.filter((a) => a.level === 'error').length > 0
                      ? 'error'
                      : data.alerts.filter((a) => a.level === 'warning').length > 0
                      ? 'warning'
                      : 'ok'
                  }
                />
              }
              accent={
                data.alerts.filter((a) => a.level === 'error').length > 0
                  ? 'var(--color-error)'
                  : data.alerts.filter((a) => a.level === 'warning').length > 0
                  ? 'var(--color-warning)'
                  : 'var(--color-success)'
              }
            />
            {(() => {
              const pvs = (data.pending_validations ?? []) as PendingValidation[];
              const active = pvs.filter((v) => v.status !== 'done');
              const topUrgent = active.find((v) => v.priority === 'urgent') ?? active[0];
              const urgentCount = active.filter((v) => v.priority === 'urgent').length;
              const highCount = active.filter((v) => v.priority === 'high').length;
              const topAccent = topUrgent?.priority === 'urgent'
                ? 'var(--color-error)'
                : topUrgent?.priority === 'high'
                ? 'var(--color-warning)'
                : active.length > 0 ? 'var(--color-accent-blue)' : 'var(--color-success)';
              return (
                <SummaryCard
                  title="Validations"
                  value={
                    active.length > 0
                      ? `${active.length} en attente`
                      : 'Rien à valider'
                  }
                  note={
                    topUrgent
                      ? <><span style={{ color: topAccent, fontWeight: 600 }}>
                          {urgentCount > 0 ? `${urgentCount} critique${urgentCount > 1 ? 's' : ''}` : highCount > 0 ? `${highCount} haute${highCount > 1 ? 's' : ''}` : ''}
                        </span>{' '}
                        {topUrgent.project} · <a onClick={() => scrollToId('pending-validation')} style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--color-text-secondary)' }}>voir liste</a></>
                      : 'Aucun blocage'
                  }
                  badge={
                    active.length > 0
                      ? <span style={{ fontSize: '11px', fontWeight: 700, color: topAccent, background: `color-mix(in srgb, ${topAccent} 15%, transparent)`, borderRadius: '9999px', padding: '2px 8px' }}>{active.length}</span>
                      : <Badge value="ok" />
                  }
                  accent={topAccent}
                />
              );
            })()}
            <SummaryCard
              title="Activité"
              value={fmtAgo(general.age_seconds)}
              note={`${general.turn_count} tour${general.turn_count > 1 ? 's' : ''} en mémoire`}
              badge={<Clock3 size={15} style={{ color: 'var(--color-text-tertiary)' }} />}
              accent="var(--color-accent)"
            />
          </div>

          {/* Next action + quick nav */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 items-center">
            <GuidanceCard
              title={data.priority_lane?.headline || derived.nextMove.title}
              detail={data.priority_lane?.detail || derived.nextMove.detail}
            />
            <div className="flex flex-wrap gap-2">
              <ActionButton
                label="Hermès"
                icon={Sparkles}
                onClick={() => scrollToId('hermes-chat')}
              />
              <ActionButton
                label="Alertes"
                icon={Bell}
                onClick={() => scrollToId('alerts')}
              />
              <ActionButton
                label="Projets"
                icon={Layers}
                onClick={() => scrollToId('projects')}
              />
              <ActionButton
                label="Rafraîchir"
                icon={RefreshCw}
                onClick={refresh}
              />
            </div>
          </div>
        </header>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.05 }}>
          <TodaySection
            alerts={derived.attentionCards}
            nextMove={derived.nextMove}
            pendingValidations={(data.pending_validations ?? []) as PendingValidation[]}
          />
        </motion.div>

        {/* Centre du cockpit : Hermès + Projets */}
        <motion.div
          className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 items-start"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.12 }}
        >
          <HermesPanel data={data} onReply={() => scrollToId('hermes-chat')} />
          <ProjectsGrid cockpitData={data} />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.19 }}>
          <AlertsSection alerts={data.alerts} onAlertAction={handleAlertAction} />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.26 }}>
          <IdeasInbox
            structuredItems={(data.obsidian_action_inbox ?? []) as ObsidianActionItem[]}
            structuredSource={data.obsidian_action_inbox_source}
          />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.33 }}>
          <MemoryGraphifySection fileHealth={data.file_health} />
        </motion.div>

        <Section
          id="hermes-chat"
          title="Discussion avec Hermès"
          subtitle="Chat officiel Hermès. Une seule interface conversationnelle, branchée sur le backend OpenJarvis réel."
          icon={Sparkles}
        >
          {!!data.hermes?.chat_runtime?.personalization?.summary_lines?.length && (
            <div
              className="rounded-2xl px-4 py-4 mb-4"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-tertiary)' }}>
                Contexte Ruth actif
              </div>
              <div className="mt-2 space-y-2">
                {data.hermes.chat_runtime.personalization.summary_lines.slice(0, 4).map((line, index) => (
                  <div key={`${index}-${line}`} className="text-sm" style={{ color: 'var(--color-text)' }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            <HermesChatPanel
              initialRuntime={data.hermes?.chat_runtime || null}
              forceFocus={forceHermesChatFocus}
            />
          </div>
        </Section>

        <Section
          id="ruth-memory"
          title="Mémoire Ruth Active"
          subtitle="Ce que Hermès lit réellement comme contexte compact Ruth avant de répondre."
          icon={Brain}
        >
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {([
              ['Profil Ruth', data.hermes?.chat_runtime?.personalization?.profile || []],
              ['Préférences de travail', data.hermes?.chat_runtime?.personalization?.preferences || []],
              ['Règles Hermès', data.hermes?.chat_runtime?.personalization?.rules || []],
              ['Mémoire validée', data.hermes?.chat_runtime?.personalization?.validated_memory || []],
              ["Journal d'apprentissage", data.hermes?.chat_runtime?.personalization?.learning_journal || []],
            ] as const).map(([title, items]) => (
              <div
                key={title}
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {title}
                </div>
                <div className="mt-3 space-y-2">
                  {items.length ? (
                    items.slice(0, 6).map((item, index) => (
                      <div key={`${title}-${index}-${item}`} className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        • {item}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                      Rien de compact disponible pour le moment.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div
            className="rounded-2xl px-4 py-4 mt-4"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Sources Obsidian utilisées
            </div>
            <div className="mt-3 space-y-2">
              {(data.hermes?.chat_runtime?.personalization?.sources || []).map((source) => (
                <div key={source.path} className="flex items-center justify-between gap-3 text-sm">
                  <span style={{ color: 'var(--color-text)' }}>{source.label}</span>
                  <Badge value={source.exists ? 'présente' : 'absente'} />
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Section
          id="cloud-budget"
          title="Budget Cloud Et Clés"
          subtitle="Suivi de la consommation estimée de tes providers et état de tes clés backend."
          icon={ShieldCheck}
          action={<Badge value={cloudBudgetFlag.label} />}
        >
          <div
            className="rounded-2xl px-4 py-4 mb-4"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <div className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Pourquoi Hermès choisit ce moteur
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>
              {data.hermes?.chat_runtime?.selection_reason ||
                "Hermès arbitre entre local, OpenRouter et OpenAI selon le mode demandé, le coût, la disponibilité et la sensibilité de la demande."}
            </div>
          </div>
          <div
            className="rounded-2xl px-4 py-4 mb-4"
            style={{
              background:
                cloudBudgetFlag.tone === 'ok'
                  ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
                  : cloudBudgetFlag.tone === 'warning'
                  ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)'
                  : 'color-mix(in srgb, var(--color-error) 12%, transparent)',
              border:
                cloudBudgetFlag.tone === 'ok'
                  ? '1px solid color-mix(in srgb, var(--color-success) 26%, transparent)'
                  : cloudBudgetFlag.tone === 'warning'
                  ? '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)'
                  : '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)',
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {cloudBudgetFlag.label}
              </div>
              <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {Math.round((data.hermes?.chat_runtime?.budget?.estimated_usage_ratio || 0) * 100)} % du budget mensuel utilisé
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SummaryCard
              title="Dépense du jour"
              value={fmtUsd(data.hermes?.chat_runtime?.budget?.estimated_today_usd)}
              note="Estimation Hermes"
            />
            <SummaryCard
              title="Dépense du mois"
              value={fmtUsd(data.hermes?.chat_runtime?.budget?.estimated_month_usd)}
              note={`Sur ${fmtUsd(data.hermes?.chat_runtime?.budget?.budget_month_usd)}`}
              accent="var(--color-accent-amber)"
            />
            <SummaryCard
              title="Budget restant"
              value={fmtUsd(data.hermes?.chat_runtime?.budget?.budget_remaining_usd)}
              note="Blocage auto à 100 %"
              accent="var(--color-success)"
            />
            <SummaryCard
              title="Clés cloud"
              value={String(data.hermes?.chat_runtime?.budget?.configured_provider_count ?? 0)}
              note="Providers backend configurés"
              accent="var(--color-accent-purple)"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            {(data.hermes?.chat_runtime?.budget?.providers || []).map((provider) => (
              <div
                key={provider.id}
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {provider.label}
                  </div>
                  <Badge value={provider.id === 'local_ollama' ? 'gratuit' : provider.configured ? 'clé active' : 'clé absente'} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <InfoChip label="Aujourd'hui" value={fmtUsd(provider.estimated_today_usd)} />
                  <InfoChip label="Mois" value={fmtUsd(provider.estimated_month_usd)} />
                </div>
                <div className="text-xs mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
                  {provider.last_model ? `Dernier modèle : ${provider.last_model}` : 'Pas encore utilisé ce mois-ci.'}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="attention-now"
          title="Ce Qui Compte Maintenant"
          subtitle="Le signal prioritaire, avant les détails."
          icon={Sparkles}
        >
          <MiniAttentionRow
            items={
              backendAttention.length > 0
                ? backendAttention.map((item) => ({
                    title: item.title,
                    detail: item.detail,
                    level: item.level === 'warning' ? 'warning' : item.level === 'ok' ? 'ok' : 'info',
                  }))
                : derived.attentionCards
            }
          />
        </Section>

        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-3">
          <Section
            title="Priorités Hermes"
            subtitle="Ce que le noyau Hermes considère comme le prochain travail utile."
            icon={Sparkles}
          >
            <div className="grid grid-cols-1 gap-3">
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                  Priorité principale
                </div>
                <div className="text-base font-medium mt-2" style={{ color: 'var(--color-text)' }}>
                  {String(priorities?.primary || data.priority_lane?.headline || 'Aucune priorité synthétisée.')}
                </div>
                <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {String(data.priority_lane?.detail || general.last_recommended_action || 'Aucune explication complémentaire.')}
                </div>
              </div>
              {Array.isArray(priorities?.secondary) && priorities.secondary.length > 0 && (
                <div
                  className="rounded-2xl px-4 py-4"
                  style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
                >
                  <div className="text-xs uppercase tracking-[0.14em] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                    Priorités secondaires
                  </div>
                  <div className="space-y-2">
                    {priorities.secondary.slice(0, 2).map((item, index) => (
                      <div key={`${item}-${index}`} className="text-sm" style={{ color: 'var(--color-text)' }}>
                        {index + 1}. {item}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section
            title="Signaux Runtime"
            subtitle="Lecture courte des trois couches utiles : Hermes, voix, Yahoo."
            icon={Radio}
          >
            <div className="space-y-3">
              <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Hermes</div>
                  <Badge value={String(signals.hermes?.status || hermes.overall || 'unknown')} />
                </div>
                <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {String(signals.hermes?.top_next_action || signals.hermes?.last_recommended_action || 'Aucun signal Hermes détaillé.')}
                </div>
              </div>
              <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Voix</div>
                  <Badge value={String(signals.voice?.status || general.status || 'unknown')} />
                </div>
                <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {String(signals.voice?.live_status || general.live_status || 'n/a')} · {String(signals.voice?.wake_word || data.voice_live.wake_word || 'n/a')}
                </div>
              </div>
              <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Yahoo</div>
                  <Badge value={String(signals.yahoo?.status || 'unknown')} />
                </div>
                <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                  {String(signals.yahoo?.last_summary || derived.latestOperationalSummary || 'Aucun signal Yahoo récent.')}
                </div>
              </div>
            </div>
          </Section>
        </div>

        <Section
          title="Derniers Échanges Vocaux"
          subtitle="Ce que Ruth vient de dire, puis la dernière réponse utile de Jarvis."
          icon={Mic}
        >
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Dernière transcription
              </div>
              <div
                className="rounded-2xl px-4 py-4 min-h-[112px]"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <ExpandableText text={data.latest_transcription} emptyLabel="Aucune transcription récente." maxChars={220} />
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Dernière réponse Jarvis
              </div>
              <div
                className="rounded-2xl px-4 py-4 min-h-[112px]"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <ExpandableText text={data.latest_response} emptyLabel="Aucune réponse récente." maxChars={220} />
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="pending-validation"
          title={`Validations en attente${(data.pending_validations_count ?? 0) > 0 ? ` (${data.pending_validations_count})` : ''}`}
          subtitle="Chaque validation : projet, source, pourquoi bloquée, qui doit agir."
          icon={ShieldCheck}
        >
          <PendingValidationsList
            items={(data.pending_validations ?? []) as PendingValidation[]}
          />
          {data.pending_validation && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Validation vocale Hermès (runtime)
              </div>
              <PendingValidationCard pending={data.pending_validation} onValidate={handleHermesValidation} />
            </div>
          )}
        </Section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <Section
            id="voice-state"
            title="État voix"
            subtitle="Configuration et statut du pipeline vocal."
            icon={Mic}
          >
            <div className="space-y-1">
              <MetricRow label="Mode voix" value={<Badge value={general.status || 'unknown'} />} />
              <MetricRow label="Voix live" value={<Badge value={general.live_status || 'idle'} />} />
              <MetricRow label="Wake word" value={data.voice_live.wake_word || 'n/a'} />
              <MetricRow label="Chaîne voix" value={`${data.voice_live.stt || 'n/a'} → ${data.voice_live.tts || 'n/a'}`} />
            </div>
          </Section>

          <Section
            id="alerts-section"
            title="Alertes récentes"
            subtitle="Incidents ou signaux faibles à traiter. Actions disponibles une fois branchées."
            icon={AlertTriangle}
          >
            <div className="space-y-3">
              {data.alerts.length === 0 && (
                <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    Aucune alerte récente remontée par le cockpit.
                  </div>
                </div>
              )}
              {data.alerts.map((alert, index) => {
                const isError = alert.level === 'error';
                const accentColor = isError ? 'var(--color-error)' : alert.level === 'warning' ? 'var(--color-warning)' : 'var(--color-accent-blue)';
                const alertActions = [
                  { label: 'Corriger', value: 'fix' as HermesAlertAction },
                  { label: 'Créer tâche', value: 'create_task' as HermesAlertAction },
                  { label: 'Ignorer', value: 'ignore' as HermesAlertAction },
                ];
                return (
                  <div key={`${alert.title}-${index}`} className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)', borderLeft: `3px solid ${accentColor}` }}>
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <div className="flex items-center gap-2">
                        <Badge value={alert.level} />
                        <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                          {alert.title}
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded"
                        style={{
                          background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                          color: 'var(--color-success)',
                          border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
                        }}
                      >
                        [ACTION CONNECTÉE]
                      </span>
                    </div>
                    <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {alert.detail}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {alertActions.map((entry) => {
                        const key = `${index}:${entry.value}`;
                        const busy = alertActionKey === key;
                        const busyAny = alertActionKey !== null;
                        return (
                          <button
                            key={entry.value}
                            disabled={busyAny}
                            onClick={() => void (async () => {
                              setAlertActionKey(key);
                              try {
                                await handleAlertAction(entry.value, alert);
                              } finally {
                                setAlertActionKey(null);
                              }
                            })()}
                            className="text-xs px-3 py-1 rounded-full cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            style={entry.value === 'fix'
                              ? { background: 'color-mix(in srgb, var(--color-error) 12%, transparent)', color: 'var(--color-error)', border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)' }
                              : entry.value === 'create_task'
                                ? { background: 'color-mix(in srgb, var(--color-accent-blue) 12%, transparent)', color: 'var(--color-accent-blue)', border: '1px solid color-mix(in srgb, var(--color-accent-blue) 20%, transparent)' }
                                : { background: 'color-mix(in srgb, var(--color-text-tertiary) 10%, transparent)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}
                            title="Journalise l'action d'alerte dans Hermès"
                          >
                            {busy ? '...' : entry.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-3">
          <Section
            id="hermes-core"
            title="Hermès Core — Moteur d'orchestration"
            subtitle={`État technique du moteur Hermès (routing, délégation, outils, risk guard). Source : runtime JSON local. Snapshot : ${fmtDate(data.meta.generated_at)}`}
            icon={Sparkles}
          >
            {(() => {
              const snapshotAge = data.meta.generated_at
                ? Math.floor((Date.now() - new Date(data.meta.generated_at).getTime()) / 1000)
                : null;
              const isFresh = snapshotAge !== null && snapshotAge < 300;
              const isStale = snapshotAge !== null && snapshotAge > 600;
              const coreEmpty = !hermes.overall || Object.keys(hermes).length < 3;
              return (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded"
                    style={{
                      background: coreEmpty ? 'color-mix(in srgb, var(--color-text-tertiary) 10%, transparent)' : isFresh ? 'color-mix(in srgb, var(--color-success) 12%, transparent)' : isStale ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)' : 'color-mix(in srgb, var(--color-accent-blue) 12%, transparent)',
                      color: coreEmpty ? 'var(--color-text-tertiary)' : isFresh ? 'var(--color-success)' : isStale ? 'var(--color-warning)' : 'var(--color-accent-blue)',
                      border: '1px solid currentColor',
                    }}
                  >
                    {coreEmpty ? 'NON CONNECTÉ' : isFresh ? 'À JOUR' : isStale ? 'ANCIEN' : 'RÉCENT'}
                  </span>
                  {snapshotAge !== null && (
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      Snapshot il y a {snapshotAge < 60 ? `${snapshotAge}s` : `${Math.floor(snapshotAge / 60)}min`}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    Source : runtime/hermes/*.json · GET /v1/personal-cockpit
                  </span>
                </div>
              );
            })()}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="space-y-1">
                  <MetricRow label="Statut Hermes" value={<Badge value={String(hermes.overall || 'unknown')} />} />
                  <MetricRow label="Intent actif" value={String(general.active_intent || 'n/a')} />
                  <MetricRow
                    label="Dernier skill"
                    value={String((general.last_skill_run?.label as string) || (general.last_skill_run?.skill as string) || 'n/a')}
                  />
                  <MetricRow label="Action recommandée" value={String(general.last_recommended_action || 'n/a')} />
                </div>
              </div>
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="text-xs uppercase tracking-[0.14em] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                  Prochaines actions Hermes
                </div>
                <div className="space-y-2">
                  {hermesNextActions.length === 0 && (
                    <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                      Aucune action Hermes synthétisée.
                    </div>
                  )}
                  {hermesNextActions.slice(0, 3).map((item, index) => (
                    <div key={index} className="rounded-xl px-3 py-3" style={{ background: 'var(--color-surface)' }}>
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {index + 1}. {String(item.label || 'n/a')}
                      </div>
                      {Boolean(item.why) && (
                        <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                          {String(item.why)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                    Délégation gouvernée
                  </div>
                  <Badge value={String(delegation.delegation_status || 'inactive')} />
                </div>
                <div className="space-y-1">
                  <MetricRow label="Validation" value={<Badge value={String(delegation.validation_status || 'unknown')} />} />
                  <MetricRow label="Cible" value={String(delegation.delegation_target || 'n/a')} />
                  <MetricRow label="Packet prêt" value={<Badge value={delegation.packet_ready ? 'oui' : 'non'} />} />
                  <MetricRow
                    label="Résolution outil"
                    value={<Badge value={String(delegation.tool_resolution_mode || 'unknown')} />}
                  />
                  <MetricRow label="Coût" value={String(delegation.tool_resolution_cost || 'unknown')} />
                  <MetricRow label="Fallback" value={String(delegation.tool_fallback || 'n/a')} />
                </div>
                <div className="text-sm mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                  {String(delegation.handoff_summary || 'Aucun handoff gouverné actif pour le moment.')}
                </div>
                <div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  Validation gate : {String(delegation.tool_validation_gate || delegation.validation_status || 'unknown')}
                </div>
              </div>
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                    Résultat de délégation
                  </div>
                  <Badge value={String(delegation.result_status || delegation.lifecycle_status || 'en attente')} />
                </div>
                <div className="space-y-1">
                  <MetricRow label="Cycle" value={String(delegation.lifecycle_status || 'n/a')} />
                  <MetricRow label="Statut résultat" value={String(delegation.result_status || 'n/a')} />
                  <MetricRow label="Dernière mise à jour" value={fmtDate(String(delegation.result_logged_at || ''))} />
                </div>
                <div className="text-sm mt-3" style={{ color: 'var(--color-text-secondary)' }}>
                  {String(delegation.result_summary || 'Aucun résultat exécuteur enregistré pour le moment.')}
                </div>
              </div>
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  Dernier risk guard
                </div>
                <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {riskGuard.overall_risk_level ? `Risque ${String(riskGuard.overall_risk_level)}` : 'Aucun diagnostic récent.'}
                </div>
                {Boolean(riskGuard.recommended_response) && (
                  <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                    {String(riskGuard.recommended_response)}
                  </div>
                )}
              </div>
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  Dernière clôture Hermes
                </div>
                <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {sessionCloser.summary ? String(sessionCloser.summary) : 'Aucune clôture récente.'}
                </div>
                {Boolean(sessionCloser.next_step) && (
                  <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                    Prochain pas : {String(sessionCloser.next_step)}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3">
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                    Discovery outil
                  </div>
                  <Badge
                    value={
                      toolResearch.required
                        ? String(toolResearch.status || 'research_needed')
                        : 'non requis'
                    }
                  />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <MetricRow label="Requête marché" value={toolResearch.required ? 'oui' : 'non'} />
                    <MetricRow label="Outil recommandé" value={String(toolResearch.recommended_tool || 'n/a')} />
                    <MetricRow label="Alternative gratuite" value={String(toolResearch.free_alternative || 'n/a')} />
                    <MetricRow label="Alternative payante" value={String(toolResearch.paid_alternative || 'n/a')} />
                    <MetricRow label="Coût cible" value={String(toolResearch.cost_level || 'unknown')} />
                    <MetricRow label="Dernière vérif" value={fmtDate(String(toolResearch.last_checked_at || ''))} />
                  </div>
                  <div>
                    <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                      {String(toolResearch.recommended_next_step || toolResearch.reason || 'Aucune comparaison outil active.')}
                    </div>
                    {Array.isArray(toolResearch.candidate_tools) && toolResearch.candidate_tools.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {toolResearch.candidate_tools.slice(0, 6).map((tool, index) => (
                          <InfoChip key={`${String(tool)}-${index}`} label={`Option ${index + 1}`} value={String(tool)} />
                        ))}
                      </div>
                    )}
                    {Array.isArray(toolResearch.signals) && toolResearch.signals.length > 0 && (
                      <div className="text-xs mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
                        Signaux runtime : {toolResearch.signals.map((signal) => String(signal)).join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div
                className="rounded-2xl px-4 py-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                    Hermes Orchestrateur V1
                  </div>
                  <Badge
                    value={
                      orchestrator.current_request ||
                      orchestrator.current_packet ||
                      orchestrator.current_tool_decision ||
                      orchestratorTrace.length > 0
                        ? 'actif'
                        : 'repos'
                    }
                  />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                  <OrchestratorRecordCard title="Requête courante" payload={orchestrator.current_request} />
                  <OrchestratorRecordCard title="Paquet courant" payload={orchestrator.current_packet} />
                  <OrchestratorRecordCard title="Décision outil courante" payload={orchestrator.current_tool_decision} />
                </div>
                {Boolean(toolResearch.required) && (
                  <div className="grid grid-cols-1 mt-3">
                    <OrchestratorRecordCard title="Recherche outil courante" payload={orchestrator.current_tool_research || toolResearch} />
                  </div>
                )}
                <div className="mt-3">
                  <div className="text-xs uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                    Trace récente
                  </div>
                  {orchestratorTrace.length === 0 ? (
                    <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                      Aucune trace orchestrateur disponible pour le moment.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {orchestratorTrace.slice(0, 4).map((item, index) => (
                        <div
                          key={`${String(item.timestamp || item.step || item.tool || 'trace')}-${index}`}
                          className="rounded-xl px-3 py-3"
                          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)' }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge value={String(item.status || item.decision || 'trace')} />
                            {Boolean(item.tool) && <InfoChip label="Outil" value={String(item.tool)} />}
                            {Boolean(item.step) && <InfoChip label="Étape" value={String(item.step)} />}
                            {Boolean(item.timestamp) && <InfoChip label="Quand" value={fmtDate(String(item.timestamp))} />}
                          </div>
                          <div className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>
                            {compactValuePreview(item.summary) ||
                              compactValuePreview(item.decision) ||
                              compactValuePreview(item)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Section>

          <Section
            id="yahoo-result"
            title="Dernier résultat opérationnel"
            subtitle="Ce qui vient réellement de se produire ou de rester en place."
            icon={Mail}
          >
            <OperationResultCard
              title="Synthèse opérationnelle"
              summary={derived.latestOperationalSummary}
              status={finalBatch ? 'yahoo dynamique' : targeted ? 'yahoo ciblé' : 'brief live'}
              chips={[
                {
                  label: 'Messages demandés',
                  value: String(finalBatch?.messages_requested ?? targeted?.messages_requested ?? 'n/a'),
                },
                {
                  label: 'Déplacés maintenant',
                  value: String(finalBatch?.messages_moved_now ?? targeted?.messages_moved_now ?? 'n/a'),
                },
                {
                  label: 'Déjà en cible',
                  value: String(finalBatch?.messages_already_in_target ?? targeted?.messages_already_in_target ?? 'n/a'),
                },
              ]}
            >
              <div className="grid grid-cols-1 gap-3">
                <details className="rounded-xl px-3 py-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <summary className="cursor-pointer text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Voir le résultat Yahoo dynamique
                  </summary>
                  <div className="mt-3">
                    <CompactRecord
                      record={finalBatch}
                      labels={[
                        { key: 'action', label: 'action' },
                        { key: 'voice_summary', label: 'résumé' },
                        { key: 'messages_requested', label: 'messages demandés' },
                        { key: 'messages_moved_now', label: 'déplacés maintenant' },
                        { key: 'messages_already_in_target', label: 'déjà dans la cible' },
                      ]}
                    />
                    <div className="mt-4">
                      <MailList
                        title="Messages concernés"
                        items={Array.isArray(finalBatch?.results) ? (finalBatch?.results as Array<Record<string, unknown>>) : []}
                      />
                    </div>
                  </div>
                </details>

                <details className="rounded-xl px-3 py-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <summary className="cursor-pointer text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Voir le résultat Yahoo ciblé
                  </summary>
                  <div className="mt-3">
                    <CompactRecord
                      record={targeted}
                      labels={[
                        { key: 'action', label: 'action' },
                        { key: 'voice_summary', label: 'résumé' },
                        { key: 'messages_requested', label: 'messages demandés' },
                        { key: 'messages_moved_now', label: 'déplacés maintenant' },
                        { key: 'messages_already_in_target', label: 'déjà dans la cible' },
                      ]}
                    />
                  </div>
                </details>
              </div>
            </OperationResultCard>
          </Section>

          <ActionSummary
            title="Dernier brief live"
            subtitle="Contexte multi-source le plus récent."
            record={liveSummary}
            labels={[
              { key: 'action', label: 'action' },
              { key: 'voice_summary', label: 'résumé' },
              { key: 'generated_at', label: 'généré' },
            ]}
            compact
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <Section
            title="Historique court de session"
            subtitle="Les derniers échanges utiles sans bruit inutile."
            icon={Mic}
          >
            <div className="space-y-3">
              {data.session_history.length === 0 && (
                <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  Aucun historique de session disponible.
                </div>
              )}
              {data.session_history.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {entry.intent || 'intent inconnu'}
                    </div>
                    <div className="text-xs hud-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                      {fmtDate(entry.timestamp)}
                    </div>
                  </div>
                  <div className="text-sm mt-3" style={{ color: 'var(--color-text)' }}>
                    <strong>Ruth :</strong> {entry.user || '—'}
                  </div>
                  <div className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                    <strong>Jarvis :</strong> {entry.assistant || '—'}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Vue connecteurs"
            subtitle="Résumé rapide avant les détails techniques."
            icon={ShieldCheck}
          >
            <div
              className="rounded-2xl px-4 py-4 mb-4"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <div className="text-xs uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-tertiary)' }}>
                Résumé
              </div>
              <div className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>
                {derived.connectorSummary}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {Array.isArray(data.connectors_overview?.healthy) && data.connectors_overview.healthy.length > 0 && (
                  <InfoChip label="OK" value={data.connectors_overview.healthy.join(', ')} />
                )}
                {Array.isArray(data.connectors_overview?.attention) && data.connectors_overview.attention.length > 0 && (
                  <InfoChip label="Attention" value={data.connectors_overview.attention.join(', ')} />
                )}
                {Array.isArray(data.connectors_overview?.offline) && data.connectors_overview.offline.length > 0 && (
                  <InfoChip label="Hors ligne" value={data.connectors_overview.offline.join(', ')} />
                )}
              </div>
            </div>
            <div className="space-y-3">
              {data.connectors.map((connector) => (
                <div key={connector.name} className="rounded-2xl px-4 py-4" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold" style={{ color: 'var(--color-text)' }}>
                      {connector.name}
                    </div>
                    <Badge value={connector.status || 'unknown'} />
                  </div>
                  <div className="text-xs mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                    Mis à jour : {fmtDate(connector.updated_at)}
                  </div>
                  {connector.summary && (
                    <div className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>
                      {connector.summary}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {connector.stale_seconds != null && (
                      <InfoChip label="Âge" value={fmtAgo(connector.stale_seconds)} />
                    )}
                    {connector.attention_needed && <InfoChip label="État" value="À surveiller" />}
                    {Object.entries(connector.services || {}).map(([name, value]) => (
                      <span
                        key={name}
                        className="px-2.5 py-1 rounded-full text-xs"
                        style={{
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {name}: {value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <SecondaryDetails
            title="Yahoo dynamique candidat"
            subtitle="Le batch préparé avant exécution reste visible mais secondaire."
          >
            <CompactRecord
              record={candidate}
              labels={[
                { key: 'action', label: 'action' },
                { key: 'source_name', label: 'source revue' },
                { key: 'batch_size', label: 'taille' },
                { key: 'batch_revision', label: 'révision' },
                { key: 'voice_summary', label: 'résumé' },
              ]}
            />
            <div className="mt-4">
              <MailList
                title="Messages candidats"
                items={Array.isArray(candidate?.items) ? (candidate?.items as Array<Record<string, unknown>>) : []}
              />
            </div>
          </SecondaryDetails>

          <SecondaryDetails
            id="continuity-details"
            title="Continuité récente"
            subtitle={derived.continuityLead}
            defaultOpen
          >
            {data.continuity.length > 0 && (
              <div className="space-y-3">
                <ContinuityCard
                  heading={data.continuity[0].heading}
                  summary={data.continuity[0].summary}
                  isLatest
                />
                {data.continuity.length > 1 && (
                  <details className="rounded-xl px-3 py-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <summary className="cursor-pointer text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      Voir les autres extraits de continuité
                    </summary>
                    <div className="space-y-3 mt-3">
                      {data.continuity.slice(1).map((entry, index) => (
                        <ContinuityCard
                          key={`${entry.heading}-${index + 1}`}
                          heading={entry.heading}
                          summary={entry.summary}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </SecondaryDetails>

          <SecondaryDetails
            title="Santé des fichiers runtime"
            subtitle="Détails techniques utiles, mais hors du premier regard."
          >
            <div className="space-y-2">
              {Object.entries(data.file_health).map(([name, file]) => (
                <div key={name} className="rounded-xl px-3 py-3" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {name}
                    </div>
                    <Badge value={file.exists ? 'ok' : 'missing'} />
                  </div>
                  <div className="text-xs mt-2 break-all" style={{ color: 'var(--color-text-secondary)' }}>
                    {file.path}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    Modifié : {fmtDate(file.modified_at)}
                  </div>
                </div>
              ))}
            </div>
          </SecondaryDetails>
        </div>
      </div>
    </div>
  );
}
