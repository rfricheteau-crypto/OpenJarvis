import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  AlertTriangle,
  BarChart2,
  BookOpen,
  CheckCircle2,
  Circle,
  FileText,
  GitBranch,
  Loader2,
  Plus,
  Rocket,
  Server,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { fetchPersonalCockpit, fetchAdvSnapshot, fetchAdvObsidian } from '../lib/api';
import type { AdvSnapshot, AdvObsidian } from '../lib/api';
import type { PersonalCockpitSnapshot } from '../types';

// ─── Static project data ──────────────────────────────────────────────────────

interface KPI {
  label: string;
  value: string;
  note?: string;
}

interface Decision {
  text: string;
  date: string;
}

interface ProjectData {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  kpis: KPI[];
  decisions: Decision[];
  obsidianPath?: string;
  graphifyPath?: string;
}

const PROJECTS: Record<string, ProjectData> = {
  adv: {
    id: 'adv',
    name: 'ADV',
    tagline: "Facturation vocale pour artisans",
    accent: 'var(--color-success)',
    kpis: [
      { label: "MRR", value: "—", note: "Bridge Stripe" },
      { label: "Abonnements", value: "—" },
      { label: "Utilisateurs actifs", value: "—" },
      { label: "Churn", value: "—" },
    ],
    decisions: [
      { text: "4 statuts figés (brouillon / envoyé / accepté / refusé)", date: "2026-04-17" },
      { text: "Architecture chantier-centrique validée", date: "2026-04-17" },
      { text: "Design tokens et palette figés", date: "2026-04-18" },
      { text: "Stripe : save card non bloquant — pas un bug critique", date: "2026-05-11" },
    ],
    obsidianPath: "ADV",
  },
  jarvis: {
    id: 'jarvis',
    name: "Jarvis / Hermès",
    tagline: "Cockpit personnel et assistant vocal",
    accent: 'var(--color-accent-purple)',
    kpis: [
      { label: "Version", value: "V4 stable" },
      { label: "Backend", value: "OpenJarvis" },
      { label: "Cockpit", value: "Ruth OS V1" },
    ],
    decisions: [
      { text: "Hermès Core comme couche d'orchestration centrale", date: "2026-05-07" },
      { text: "Cockpit Ruth OS — vision V1/V2/V3 validée", date: "2026-05-12" },
      { text: "Obsidian reste la mémoire source, cockpit = interface", date: "2026-05-12" },
    ],
    graphifyPath: "/Users/ruthpierre/.openjarvis/jarvis-personal/graphify-out/graph.html",
    obsidianPath: "JARVIS",
  },
  abg: {
    id: 'abg',
    name: 'ABG',
    tagline: "Projet en pause",
    accent: 'var(--color-accent)',
    kpis: [
      { label: "Statut", value: "En pause" },
    ],
    decisions: [],
  },
};

const actionsKey = (id: string) => `ruth_project_actions_${id}`;

// ─── Types ────────────────────────────────────────────────────────────────────

type AdvTab = 'business' | 'utilisateurs' | 'technique' | 'marketing' | 'lancement' | 'juridique' | 'obsidian' | 'codex';

const ADV_TABS: { id: AdvTab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'business', label: 'Business', Icon: BarChart2 },
  { id: 'utilisateurs', label: 'Utilisateurs', Icon: Users },
  { id: 'technique', label: 'Technique', Icon: Server },
  { id: 'marketing', label: 'Marketing', Icon: TrendingUp },
  { id: 'lancement', label: 'Lancement', Icon: Rocket },
  { id: 'juridique', label: 'Juridique', Icon: Shield },
  { id: 'obsidian', label: 'Obsidian', Icon: BookOpen },
  { id: 'codex', label: 'Codex', Icon: FileText },
];

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtNum = (n?: number | null) => (n != null ? n.toLocaleString('fr-FR') : '—');
const fmtEur = (n?: number | null) => (n != null ? `${n.toLocaleString('fr-FR')} €` : '—');
const fmtPct = (n?: number | null) => (n != null ? `${(n * 100).toFixed(1)} %` : '—');

// ─── Alerts ───────────────────────────────────────────────────────────────────

function computeAdvAlerts(
  snap: AdvSnapshot | null,
): Array<{ level: 'warning' | 'error'; title: string; detail?: string }> {
  if (!snap || snap._empty) return [];
  const out: Array<{ level: 'warning' | 'error'; title: string; detail?: string }> = [];
  const services = snap.sante_technique?.services ?? {};
  if (services.stripe === 'non_configure') {
    out.push({ level: 'warning', title: 'Stripe non configuré', detail: 'MRR et revenus non tracés' });
  }
  if (services.brevo === 'non_configure') {
    out.push({ level: 'warning', title: 'Brevo non configuré', detail: 'Emails transactionnels inactifs' });
  }
  for (const b of snap.lancement?.blocages_critiques ?? []) {
    out.push({ level: 'error', title: 'Blocage critique', detail: String(b) });
  }
  return out;
}

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

function KpiCard({ kpi, accent, delay }: { kpi: KPI; accent: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay }}
      className="rounded-xl p-3"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-0.5"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {kpi.label}
      </div>
      <div className="text-xl font-semibold" style={{ color: accent }}>
        {kpi.value}
      </div>
      {kpi.note && (
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          {kpi.note}
        </div>
      )}
    </motion.div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.14em] mb-0.5"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {label}
      </div>
      <div className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] uppercase tracking-[0.16em] mb-3"
      style={{ color: 'var(--color-text-tertiary)' }}
    >
      {children}
    </div>
  );
}

function ProgressBar({ value, max, accent }: { value: number; max: number; accent: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="mt-4">
      <div
        className="flex justify-between text-xs mb-1.5"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <span>{"Objectif MRR 1 000 €/mois"}</span>
        <span style={{ color: accent }}>{pct.toFixed(0)} %</span>
      </div>
      <div
        className="h-1 rounded-full overflow-hidden"
        style={{ background: 'var(--color-border)' }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: accent }}
          initial={{ width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.4 }}
        />
      </div>
      <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
        {fmtEur(value)} {"sur"} {fmtEur(max)}
      </div>
    </div>
  );
}

function ServiceBadge({ name, status }: { name: string; status: string }) {
  const isOk = status === 'ok';
  const isWarn = status === 'non_configure';
  const color = isOk
    ? 'var(--color-success)'
    : isWarn
    ? 'var(--color-warning)'
    : 'var(--color-error)';
  const label = isOk ? 'OK' : isWarn ? 'Non configuré' : 'Erreur';
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-sm capitalize" style={{ color: 'var(--color-text)' }}>
        {name}
      </span>
      <span className="text-xs ml-auto font-medium" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// ─── ADV Tab panels ───────────────────────────────────────────────────────────

function BusinessPanel({
  snap,
  decisions,
  actions,
  setActions,
  draft,
  setDraft,
  accent,
}: {
  snap: AdvSnapshot | null;
  decisions: Decision[];
  actions: Array<{ id: string; text: string; done: boolean }>;
  setActions: React.Dispatch<React.SetStateAction<Array<{ id: string; text: string; done: boolean }>>>;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  accent: string;
}) {
  const addAction = () => {
    const text = draft.trim();
    if (!text) return;
    setActions((prev) => [...prev, { id: crypto.randomUUID(), text, done: false }]);
    setDraft('');
  };
  const toggleAction = (aid: string) =>
    setActions((prev) => prev.map((a) => (a.id === aid ? { ...a, done: !a.done } : a)));
  const deleteAction = (aid: string) =>
    setActions((prev) => prev.filter((a) => a.id !== aid));

  return (
    <div className="space-y-6">
      <div>
        <SectionLabel>{"Revenus"}</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="MRR"
            value={fmtEur(snap?.business?.mrr)}
            sub={snap?.business?.mrr === 0 ? 'Stripe V2' : undefined}
          />
          <StatCard label="ARR" value={fmtEur(snap?.business?.arr)} />
          <StatCard label="CA mensuel" value={fmtEur(snap?.business?.ca_mensuel)} />
        </div>
      </div>

      <div>
        <SectionLabel>{"Plans actifs"}</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Starter" value={fmtNum(snap?.abonnements?.starter)} sub="comptes" />
          <StatCard label="Pro" value={fmtNum(snap?.abonnements?.pro)} sub="comptes" />
          <StatCard label="Premium" value={fmtNum(snap?.abonnements?.premium)} sub="comptes" />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-2">
          <StatCard label="Essais actifs" value={fmtNum(snap?.abonnements?.essais_actifs)} />
          <StatCard label="Churn" value={fmtPct(snap?.abonnements?.churn_rate)} />
          <StatCard label="Annulations" value={fmtNum(snap?.abonnements?.annulations)} />
        </div>
      </div>

      <div>
        <SectionLabel>{"Usage"}</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Devis générés" value={fmtNum(snap?.usage?.devis_total)} />
          <StatCard label="Factures générées" value={fmtNum(snap?.usage?.factures_total)} />
        </div>
      </div>

      {decisions.length > 0 && (
        <div>
          <SectionLabel>{"Décisions clés"}</SectionLabel>
          <div className="space-y-2">
            {decisions.map((d, i) => (
              <div key={i} className="flex items-start gap-3">
                <span
                  className="text-[11px] mt-0.5 shrink-0 tabular-nums"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {d.date}
                </span>
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {d.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>{"Prochaines actions"}</SectionLabel>
        {actions.length === 0 && (
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
            {"Aucune action. Ajoute ci-dessous."}
          </p>
        )}
        <AnimatePresence>
          <ul className="space-y-2 mb-3">
            {actions.map((action) => (
              <motion.li
                key={action.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-2 group"
              >
                <button
                  onClick={() => toggleAction(action.id)}
                  className="shrink-0 cursor-pointer"
                  style={{ color: action.done ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
                >
                  {action.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                </button>
                <span
                  className="flex-1 text-sm"
                  style={{
                    color: action.done ? 'var(--color-text-tertiary)' : 'var(--color-text)',
                    textDecoration: action.done ? 'line-through' : 'none',
                  }}
                >
                  {action.text}
                </span>
                <button
                  onClick={() => deleteAction(action.id)}
                  className="opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <Trash2 size={12} />
                </button>
              </motion.li>
            ))}
          </ul>
        </AnimatePresence>
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addAction(); }}
            placeholder={"Ajouter une action..."}
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--color-text)' }}
          />
          <button
            onClick={addAction}
            disabled={!draft.trim()}
            className="p-1 rounded cursor-pointer disabled:opacity-30"
            style={{ color: accent }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function UtilisateursPanel({ snap }: { snap: AdvSnapshot | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <StatCard label="Total comptes" value={fmtNum(snap?.utilisateurs?.total)} />
      <StatCard label="Payants" value={fmtNum(snap?.utilisateurs?.payants)} />
      <StatCard label="En essai" value={fmtNum(snap?.utilisateurs?.essai)} />
      <StatCard label="Actifs 30j" value={fmtNum(snap?.utilisateurs?.actifs_30j)} />
      <StatCard label="Nouveaux / sem." value={fmtNum(snap?.utilisateurs?.nouveaux_semaine)} />
      <StatCard label="Inactifs" value={fmtNum(snap?.utilisateurs?.inactifs)} />
    </div>
  );
}

function TechniquePanel({ snap }: { snap: AdvSnapshot | null }) {
  const services = Object.entries(snap?.sante_technique?.services ?? {});
  return (
    <div className="space-y-5">
      {services.length > 0 && (
        <div>
          <SectionLabel>{"Services"}</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {services.map(([name, status]) => (
              <ServiceBadge key={name} name={name} status={status} />
            ))}
          </div>
        </div>
      )}
      <div>
        <SectionLabel>{"Santé"}</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Erreurs worker 24h"
            value={fmtNum(snap?.sante_technique?.erreurs_worker_24h)}
          />
          <StatCard
            label="Dernier incident"
            value={snap?.sante_technique?.dernier_incident ?? 'Aucun'}
          />
        </div>
      </div>
      {snap?.generated_at && (
        <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {"Snapshot du "}
          {new Date(snap.generated_at).toLocaleString('fr-FR')}
          {snap._age_seconds != null && ` — il y a ${Math.round(snap._age_seconds / 60)} min`}
          {snap._stale && " · données potentiellement anciennes"}
        </p>
      )}
    </div>
  );
}

function MarketingPanel({ snap }: { snap: AdvSnapshot | null }) {
  const hasData = snap?.marketing && Object.values(snap.marketing).some((v) => v && v > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Prospects" value={fmtNum(snap?.marketing?.prospects)} />
        <StatCard label="Leads" value={fmtNum(snap?.marketing?.leads)} />
        <StatCard label="Contenus publiés" value={fmtNum(snap?.marketing?.contenus_publies)} />
      </div>
      {!hasData && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
          {"Sources non connectées — données disponibles quand CRM / analytics liés au bridge."}
        </p>
      )}
    </div>
  );
}

function LancementPanel({ snap, obsidian }: { snap: AdvSnapshot | null; obsidian: AdvObsidian | null }) {
  const blocages = snap?.lancement?.blocages_critiques ?? [];
  const taches = snap?.lancement?.taches_restantes ?? 0;
  const commit = snap?.lancement?.dernier_commit;

  // Extract "Prochain bloc critique" from _etat-actuel.md
  const blocCritique = (() => {
    if (!obsidian?.adv_state) return null;
    const match = obsidian.adv_state.match(/\*\*Prochain bloc critique\s*:?\*\*\s*(.+?)(?:\n|$)/);
    return match ? match[1].trim() : null;
  })();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Tâches restantes" value={fmtNum(taches)} />
        <StatCard label="Blocages critiques" value={fmtNum(blocages.length)} />
        <StatCard
          label="Dernier commit"
          value={commit ? commit.slice(0, 7) : '—'}
          sub={commit ? undefined : 'GitHub non configuré'}
        />
      </div>

      {blocCritique && (
        <div
          className="flex items-start gap-2.5 px-4 py-3 rounded-xl"
          style={{
            background: 'color-mix(in srgb, var(--color-warning) 8%, var(--color-bg-secondary))',
            border: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)',
          }}
        >
          <span
            className="mt-1 shrink-0 inline-block rounded-full h-1.5 w-1.5"
            style={{ background: 'var(--color-warning)' }}
          />
          <div>
            <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-warning)' }}>
              {"Prochain bloc critique"}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text)' }}>
              {blocCritique}
            </div>
          </div>
        </div>
      )}

      {blocages.length > 0 && (
        <div>
          <SectionLabel>{"Blocages"}</SectionLabel>
          <div className="space-y-2">
            {blocages.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  className="mt-1 shrink-0 inline-block rounded-full h-1.5 w-1.5"
                  style={{ background: 'var(--color-error)' }}
                />
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {b}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JuridiquePanel({ obsidian, loading }: { obsidian: AdvObsidian | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
        <Loader2 size={14} className="animate-spin" />
        <span className="text-sm">{"Chargement..."}</span>
      </div>
    );
  }
  if (!obsidian?.juridique) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        {"Note légale non trouvée dans Obsidian ADV/Décisions/legal-adv.md"}
      </p>
    );
  }
  return (
    <pre
      className="text-xs whitespace-pre-wrap leading-relaxed"
      style={{ color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}
    >
      {obsidian.juridique}
    </pre>
  );
}

function CodexPanel({ obsidian, loading }: { obsidian: AdvObsidian | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
        <Loader2 size={14} className="animate-spin" />
        <span className="text-sm">{"Chargement..."}</span>
      </div>
    );
  }
  if (!obsidian?.codex_log) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        {"Log CODEX non trouvé."}
      </p>
    );
  }
  return (
    <div>
      <SectionLabel>{"UPDATE_LOG — entrées récentes"}</SectionLabel>
      <pre
        className="text-xs whitespace-pre-wrap leading-relaxed"
        style={{ color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}
      >
        {obsidian.codex_log}
      </pre>
    </div>
  );
}

function ObsidianPanel({
  obsidian,
  loading,
}: {
  obsidian: AdvObsidian | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
        <Loader2 size={14} className="animate-spin" />
        <span className="text-sm">{"Chargement Obsidian..."}</span>
      </div>
    );
  }
  if (!obsidian || (!obsidian.adv_state && !obsidian.codex_current_state)) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        {"Aucune donnée Obsidian disponible."}
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {obsidian.adv_state && (
        <div>
          <SectionLabel>{"ADV — État actuel"}</SectionLabel>
          <pre
            className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}
          >
            {obsidian.adv_state.slice(0, 1500)}
          </pre>
        </div>
      )}
      {obsidian.codex_current_state && (
        <div>
          <SectionLabel>{"CODEX Ruth OS"}</SectionLabel>
          <pre
            className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ color: 'var(--color-text-secondary)', fontFamily: 'inherit' }}
          >
            {obsidian.codex_current_state.slice(0, 600)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const project = id ? PROJECTS[id] : null;

  const [cockpit, setCockpit] = useState<PersonalCockpitSnapshot | null>(null);
  const [cockpitLoading, setCockpitLoading] = useState(id === 'jarvis');
  const [advSnapshot, setAdvSnapshot] = useState<AdvSnapshot | null>(null);
  const [advObsidian, setAdvObsidian] = useState<AdvObsidian | null>(null);
  const [advObsidianLoading, setAdvObsidianLoading] = useState(false);
  const [advTab, setAdvTab] = useState<AdvTab>('business');

  const [actions, setActions] = useState<Array<{ id: string; text: string; done: boolean }>>(() => {
    if (!id) return [];
    try {
      const raw = localStorage.getItem(actionsKey(id));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (id !== 'jarvis') return;
    fetchPersonalCockpit()
      .then(setCockpit)
      .catch(() => {})
      .finally(() => setCockpitLoading(false));
  }, [id]);

  useEffect(() => {
    if (id !== 'adv') return;
    fetchAdvSnapshot().then(setAdvSnapshot).catch(() => {});
    setAdvObsidianLoading(true);
    fetchAdvObsidian()
      .then(setAdvObsidian)
      .catch(() => {})
      .finally(() => setAdvObsidianLoading(false));
  }, [id]);

  const kpis = useMemo(() => {
    if (id !== 'adv' || !advSnapshot || advSnapshot._empty) return project?.kpis ?? [];
    return [
      {
        label: 'MRR',
        value: fmtEur(advSnapshot.business?.mrr),
        note: advSnapshot._stale
          ? 'Données anciennes'
          : advSnapshot.business?.mrr === 0
          ? 'Stripe V2'
          : undefined,
      },
      { label: 'Abonnements', value: fmtNum(advSnapshot.abonnements?.actifs) },
      { label: 'Utilisateurs', value: fmtNum(advSnapshot.utilisateurs?.total) },
      { label: 'Churn', value: fmtPct(advSnapshot.abonnements?.churn_rate) },
    ];
  }, [id, advSnapshot, project]);

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(actionsKey(id), JSON.stringify(actions));
    } catch {}
  }, [id, actions]);

  const addAction = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setActions((prev) => [...prev, { id: crypto.randomUUID(), text, done: false }]);
    setDraft('');
  }, [draft]);

  const toggleAction = (aid: string) =>
    setActions((prev) => prev.map((a) => (a.id === aid ? { ...a, done: !a.done } : a)));

  const deleteAction = (aid: string) =>
    setActions((prev) => prev.filter((a) => a.id !== aid));

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          {"Projet introuvable."}
        </div>
      </div>
    );
  }

  // ── ADV cockpit ───────────────────────────────────────────────────────────

  if (id === 'adv') {
    const advAlerts = computeAdvAlerts(advSnapshot);
    const mrr = advSnapshot?.objectifs_ruth?.mrr_actuel ?? 0;
    const objectif = advSnapshot?.objectifs_ruth?.objectif_mrr_1 ?? 1000;

    return (
      <motion.div
        className="flex-1 overflow-y-auto px-6 py-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
      >
        <div className="max-w-5xl mx-auto space-y-4">

          {/* Header */}
          <div
            className="hud-panel p-6"
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${project.accent} 10%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
            }}
          >
            <button
              onClick={() => navigate('/jarvis-personal')}
              className="flex items-center gap-2 text-sm mb-5 cursor-pointer transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
            >
              <ArrowLeft size={14} />
              {"Retour au cockpit"}
            </button>

            <h1 className="text-3xl font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
              {project.name}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {project.tagline}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
              {kpis.map((kpi, i) => (
                <KpiCard key={kpi.label} kpi={kpi} accent={project.accent} delay={0.1 + i * 0.06} />
              ))}
            </div>

            <ProgressBar value={mrr} max={objectif} accent={project.accent} />
          </div>

          {/* Alertes */}
          {advAlerts.length > 0 && (
            <motion.div
              className="hud-panel p-5"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />
                <span
                  className="text-xs font-semibold uppercase tracking-[0.16em]"
                  style={{ color: 'var(--color-text)' }}
                >
                  {"Alertes"}
                </span>
              </div>
              <div className="space-y-2.5">
                {advAlerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span
                      className="mt-1 shrink-0 inline-block rounded-full h-1.5 w-1.5"
                      style={{
                        background:
                          a.level === 'error' ? 'var(--color-error)' : 'var(--color-warning)',
                      }}
                    />
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {a.title}
                      </div>
                      {a.detail && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                          {a.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Tabs */}
          <motion.div
            className="hud-panel overflow-hidden"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.12 }}
          >
            <div
              className="flex border-b overflow-x-auto"
              style={{ borderColor: 'var(--color-border)', scrollbarWidth: 'none' }}
            >
              {ADV_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setAdvTab(t.id)}
                  className="flex items-center gap-1.5 px-4 py-3 text-sm cursor-pointer transition-colors relative"
                  style={{
                    color: advTab === t.id ? 'var(--color-text)' : 'var(--color-text-tertiary)',
                  }}
                >
                  <t.Icon size={13} />
                  {t.label}
                  {advTab === t.id && (
                    <motion.div
                      layoutId="adv-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5"
                      style={{ background: project.accent }}
                    />
                  )}
                </button>
              ))}
            </div>

            <div className="p-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={advTab}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.14 }}
                >
                  {advTab === 'business' && (
                    <BusinessPanel
                      snap={advSnapshot}
                      decisions={project.decisions}
                      actions={actions}
                      setActions={setActions}
                      draft={draft}
                      setDraft={setDraft}
                      accent={project.accent}
                    />
                  )}
                  {advTab === 'utilisateurs' && <UtilisateursPanel snap={advSnapshot} />}
                  {advTab === 'technique' && <TechniquePanel snap={advSnapshot} />}
                  {advTab === 'marketing' && <MarketingPanel snap={advSnapshot} />}
                  {advTab === 'lancement' && (
                    <LancementPanel snap={advSnapshot} obsidian={advObsidian} />
                  )}
                  {advTab === 'juridique' && (
                    <JuridiquePanel obsidian={advObsidian} loading={advObsidianLoading} />
                  )}
                  {advTab === 'obsidian' && (
                    <ObsidianPanel obsidian={advObsidian} loading={advObsidianLoading} />
                  )}
                  {advTab === 'codex' && (
                    <CodexPanel obsidian={advObsidian} loading={advObsidianLoading} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Footer */}
          <motion.div
            className="flex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, delay: 0.28 }}
          >
            <button
              onClick={() => navigate('/jarvis-personal?mode=chat')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer"
              style={{
                background: 'color-mix(in srgb, var(--color-accent-purple) 12%, var(--color-bg-secondary))',
                border: '1px solid color-mix(in srgb, var(--color-accent-purple) 22%, transparent)',
                color: 'var(--color-accent-purple)',
              }}
            >
              <Sparkles size={14} />
              {"Demander à Hermès"}
            </button>
          </motion.div>

        </div>
      </motion.div>
    );
  }

  // ── Non-ADV layout (jarvis, abg) ──────────────────────────────────────────

  const alerts =
    id === 'jarvis' && cockpit
      ? cockpit.alerts.filter((a) => a.level !== 'ok')
      : [];

  return (
    <motion.div
      className="flex-1 overflow-y-auto px-6 py-8"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div className="max-w-5xl mx-auto space-y-4">

        {/* Header */}
        <div
          className="hud-panel p-6"
          style={{
            background: `linear-gradient(135deg, color-mix(in srgb, ${project.accent} 10%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
          }}
        >
          <button
            onClick={() => navigate('/jarvis-personal')}
            className="flex items-center gap-2 text-sm mb-5 cursor-pointer transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
          >
            <ArrowLeft size={14} />
            {"Retour au cockpit"}
          </button>

          <h1 className="text-3xl font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
            {project.name}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {project.tagline}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {project.kpis.map((kpi, i) => (
              <KpiCard key={kpi.label} kpi={kpi} accent={project.accent} delay={0.1 + i * 0.06} />
            ))}
          </div>
        </div>

        {/* Alertes + Actions */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          <div className="hud-panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />
              <span
                className="text-xs font-semibold uppercase tracking-[0.16em]"
                style={{ color: 'var(--color-text)' }}
              >
                {"Alertes"}
              </span>
            </div>
            {cockpitLoading ? (
              <div className="flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
                <Loader2 size={14} className="animate-spin" />
                <span className="text-sm">{"Chargement..."}</span>
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-success)' }}>
                <CheckCircle2 size={14} />
                {"Aucune alerte active."}
              </div>
            ) : (
              <div className="space-y-2.5">
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span
                      className="mt-1 shrink-0 inline-block rounded-full h-1.5 w-1.5"
                      style={{
                        background:
                          a.level === 'error' ? 'var(--color-error)' : 'var(--color-warning)',
                      }}
                    />
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {a.title}
                      </div>
                      {a.detail && (
                        <div className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                          {a.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hud-panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 size={14} style={{ color: project.accent }} />
              <span
                className="text-xs font-semibold uppercase tracking-[0.16em]"
                style={{ color: 'var(--color-text)' }}
              >
                {"Prochaines actions"}
              </span>
            </div>

            {actions.length === 0 && (
              <div className="text-sm mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                {"Aucune action. Ajoute ci-dessous."}
              </div>
            )}

            <AnimatePresence>
              <ul className="space-y-2 mb-3">
                {actions.map((action) => (
                  <motion.li
                    key={action.id}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-2 group"
                  >
                    <button
                      onClick={() => toggleAction(action.id)}
                      className="shrink-0 cursor-pointer"
                      style={{
                        color: action.done ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                      }}
                    >
                      {action.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                    </button>
                    <span
                      className="flex-1 text-sm"
                      style={{
                        color: action.done ? 'var(--color-text-tertiary)' : 'var(--color-text)',
                        textDecoration: action.done ? 'line-through' : 'none',
                      }}
                    >
                      {action.text}
                    </span>
                    <button
                      onClick={() => deleteAction(action.id)}
                      className="opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </motion.li>
                ))}
              </ul>
            </AnimatePresence>

            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
            >
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addAction(); }}
                placeholder={"Ajouter une action..."}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--color-text)' }}
              />
              <button
                onClick={addAction}
                disabled={!draft.trim()}
                className="p-1 rounded cursor-pointer disabled:opacity-30"
                style={{ color: project.accent }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Décisions */}
        {project.decisions.length > 0 && (
          <motion.div
            className="hud-panel p-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.18 }}
          >
            <div
              className="text-xs uppercase tracking-[0.16em] mb-4"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {"Décisions clés"}
            </div>
            <div className="space-y-2.5">
              {project.decisions.map((d, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.22 + i * 0.05 }}
                  className="flex items-start gap-3"
                >
                  <span
                    className="text-[11px] mt-0.5 shrink-0 tabular-nums"
                    style={{ color: 'var(--color-text-tertiary)' }}
                  >
                    {d.date}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                    {d.text}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Footer links */}
        <motion.div
          className="flex flex-wrap gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22, delay: 0.28 }}
        >
          {project.obsidianPath && (
            <button
              onClick={() => window.open(`obsidian://open?vault=Organisation%20Ruth&file=${encodeURIComponent(project.obsidianPath!)}`, '_blank')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <BookOpen size={14} />
              {`Obsidian — ${project.obsidianPath}`}
            </button>
          )}
          {project.graphifyPath && (
            <button
              onClick={() => window.open('/graphify/jarvis', '_blank')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <GitBranch size={14} />
              {"Graphify — dernière carte"}
            </button>
          )}
          <button
            onClick={() => navigate('/jarvis-personal?mode=chat')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm cursor-pointer"
            style={{
              background: 'color-mix(in srgb, var(--color-accent-purple) 12%, var(--color-bg-secondary))',
              border: '1px solid color-mix(in srgb, var(--color-accent-purple) 22%, transparent)',
              color: 'var(--color-accent-purple)',
            }}
          >
            <Sparkles size={14} />
            {"Demander à Hermès"}
          </button>
        </motion.div>

      </div>
    </motion.div>
  );
}
