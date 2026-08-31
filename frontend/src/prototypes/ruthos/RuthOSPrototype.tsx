import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Cpu,
  FolderKanban,
  Gauge,
  Home,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sparkles,
  Volume2,
} from 'lucide-react';

import type { PersonalCockpitSnapshot } from '../../types';
import {
  fetchPersonalCockpit,
  fetchAdvSnapshot,
  fetchAgentsStatus,
  fetchProjectBlocks,
  fetchProposedMission,
  fetchSessionLog,
  prepareExecution,
  sendPersonalCockpitChat,
  submitHermesValidation,
  type AdvSnapshot,
  type AgentsStatusResponse,
  type LastExecutionInfo,
  type MissionHistoryEntry,
  type ProjectBlock,
} from '../../lib/api';
import { useAppStore } from '../../lib/store';
import { useHermesVoiceSession, type HermesVoiceMessage } from '../../hooks/useHermesVoiceSession';
import { STATUS_COLORS, priorityToStatus, blockStatusMeta, type StatusKey } from './designSystem';
import { PROJECTS, type ProjectData } from '../../lib/projectsRegistry';

type VariantKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
type DetailKey = 'attente' | 'alertes' | 'projets' | 'systeme';

type RuthOSPrototypeProps = {
  snapshot: PersonalCockpitSnapshot | null;
  onRefresh?: () => Promise<void>;
  connectionError?: boolean;
  lastUpdatedAt?: string | null;
};

type ViewModel = {
  nextAction: string;
  nextActionDetail: string;
  decisions: Array<{ project: string; title: string; detail: string }>;
  projects: Array<{ id: string; title: string; summary: string }>;
  risks: Array<{ title: string; detail: string; level: string }>;
  hermesSummary: string;
  healthyServices: number;
  servicesToWatch: number;
  generatedAt: string;
};

const VARIANTS: Array<{ key: VariantKey; label: string; description: string }> = [
  { key: 'A', label: 'Le fil guidé', description: 'Une journée racontée par Hermès' },
  { key: 'B', label: 'Poste de pilotage', description: 'Tout le cockpit en un regard' },
  { key: 'C', label: 'Bureau focus', description: 'Une priorité, puis le reste' },
  { key: 'D', label: 'RuthOS 360°', description: 'Proposition design de Claude' },
  { key: 'E', label: 'RuthOS 360° — fusion', description: 'Palette D + structure C, retenue par Ruth' },
  { key: 'F', label: 'Carte centrale', description: 'Home minimale, une priorité, colonne unique' },
  { key: 'G', label: 'Conversation Hermès', description: 'Hermès porte la priorité, tuiles en second plan' },
];

function currentVariant(): VariantKey {
  const value = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  // G (Conversation Hermès) est la direction validée par Ruth le 2026-08-29 — défaut.
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'E' || value === 'F' ? value : 'G';
}

function currentDetail(): DetailKey | null {
  const value = new URLSearchParams(window.location.search).get('view');
  return value === 'attente' || value === 'alertes' || value === 'projets' || value === 'systeme' ? value : null;
}

function currentProjectId(): string | null {
  const value = new URLSearchParams(window.location.search).get('project');
  return value && PROJECTS[value] ? value : null;
}

function currentBlockNum(): string | null {
  return new URLSearchParams(window.location.search).get('block');
}

function cleanText(value: string | undefined | null, fallback: string): string {
  const text = value?.trim();
  return text || fallback;
}

// Les champs de bloc viennent tels quels de PROJECT_BUILD_MAP.md (markdown
// écrit par des humains/agents) — `` `code` `` et `**gras**` doivent être
// stylés, pas affichés en texte brut avec les astérisques/backticks visibles.
function renderInlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) parts.push(<strong key={key++}>{match[1]}</strong>);
    else if (match[2] !== undefined) parts.push(<code key={key++} className="g-inline-code">{match[2]}</code>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function buildViewModel(snapshot: PersonalCockpitSnapshot | null): ViewModel {
  const decisions = (snapshot?.pending_validations ?? []).slice(0, 3).map((item) => ({
    project: cleanText(item.project, 'RuthOS'),
    title: cleanText(item.title, 'Décision à examiner'),
    detail: cleanText(item.why_pending || item.expected_action, 'Validation de Ruth attendue.'),
  }));

  const projects = Object.values(PROJECTS).map((project) => ({
    id: project.id,
    title: project.name,
    summary: project.tagline,
  }));

  return {
    nextAction: cleanText(
      snapshot?.priority_lane?.headline || snapshot?.general_state.last_recommended_action,
      'Choisir la direction visuelle du cockpit RuthOS',
    ),
    nextActionDetail: cleanText(
      snapshot?.priority_lane?.detail,
      'Comparer les trois structures avant toute intégration durable.',
    ),
    decisions: decisions.length
      ? decisions
      : [{ project: 'RuthOS', title: 'Aucune décision urgente détectée', detail: 'Le prototype reste en lecture seule.' }],
    projects,
    risks: (snapshot?.alerts ?? []).slice(0, 3).map((alert) => ({
      title: cleanText(alert.title, 'Point de vigilance'),
      detail: cleanText(alert.detail, 'À contrôler.'),
      level: cleanText(alert.level, 'attention'),
    })),
    hermesSummary: cleanText(
      snapshot?.hermes?.last_summary || snapshot?.latest_response,
      'Je rassemble les priorités, les décisions et les risques. Rien ne sera exécuté depuis ce prototype.',
    ),
    healthyServices: snapshot?.connectors_overview?.healthy.length ?? 0,
    servicesToWatch:
      (snapshot?.connectors_overview?.attention.length ?? 0) +
      (snapshot?.connectors_overview?.offline.length ?? 0),
    generatedAt: snapshot?.meta.generated_at
      ? new Date(snapshot.meta.generated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
      : 'données de démonstration',
  };
}

function Card({
  children,
  className = '',
  eyebrow,
  icon,
}: {
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  icon?: ReactNode;
}) {
  return (
    <section className={`ruth-card ${className}`}>
      {eyebrow ? (
        <div className="ruth-eyebrow">
          {icon}
          <span>{eyebrow}</span>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function NextAction({ model, compact = false }: { model: ViewModel; compact?: boolean }) {
  return (
    <Card className={`ruth-next ${compact ? 'is-compact' : ''}`} eyebrow="Prochaine action" icon={<Sparkles size={15} />}>
      <h2>{model.nextAction}</h2>
      <p>{model.nextActionDetail}</p>
      <button type="button" className="ruth-primary" disabled title="Prototype en lecture seule">
        Continuer avec Hermès <ChevronRight size={17} />
      </button>
    </Card>
  );
}

function Decisions({ model }: { model: ViewModel }) {
  return (
    <Card eyebrow="À décider" icon={<CheckCircle2 size={15} />}>
      <div className="ruth-stack">
        {model.decisions.map((decision, index) => (
          <article className="ruth-list-row" key={`${decision.project}-${decision.title}-${index}`}>
            <span className="ruth-project-tag">{decision.project}</span>
            <div>
              <strong>{decision.title}</strong>
              <p>{decision.detail}</p>
            </div>
            <ChevronRight aria-hidden="true" size={18} />
          </article>
        ))}
      </div>
    </Card>
  );
}

function Projects({ model, horizontal = false }: { model: ViewModel; horizontal?: boolean }) {
  return (
    <Card className={horizontal ? 'ruth-project-strip' : ''} eyebrow="Projets" icon={<FolderKanban size={15} />}>
      <div className={horizontal ? 'ruth-projects-horizontal' : 'ruth-stack'}>
        {model.projects.map((project, index) => (
          <article className="ruth-project" key={`${project.title}-${index}`}>
            <div className="ruth-project-index">{String(index + 1).padStart(2, '0')}</div>
            <div>
              <strong>{project.title}</strong>
              <p>{project.summary}</p>
            </div>
          </article>
        ))}
      </div>
    </Card>
  );
}

function Business({ model }: { model: ViewModel }) {
  return (
    <Card eyebrow="Business & activité" icon={<BarChart3 size={15} />}>
      <div className="ruth-kpis">
        <div><span>Chiffre d’affaires</span><strong>—</strong><small>source non connectée</small></div>
        <div><span>À encaisser</span><strong>—</strong><small>source non connectée</small></div>
        <div><span>Services opérationnels</span><strong>{model.healthyServices || '—'}</strong><small>snapshot local</small></div>
      </div>
    </Card>
  );
}

function Risks({ model }: { model: ViewModel }) {
  const risks = model.risks.length
    ? model.risks
    : [{ title: 'Aucun risque urgent détecté', detail: `${model.servicesToWatch} service(s) à surveiller.`, level: 'stable' }];

  return (
    <Card eyebrow="Risques & coûts" icon={<ShieldAlert size={15} />}>
      <div className="ruth-stack">
        {risks.map((risk, index) => (
          <article className="ruth-risk" key={`${risk.title}-${index}`}>
            <AlertTriangle aria-hidden="true" size={18} />
            <div><strong>{risk.title}</strong><p>{risk.detail}</p></div>
            <span>{risk.level}</span>
          </article>
        ))}
      </div>
    </Card>
  );
}

function HermesPanel({ model, compact = false }: { model: ViewModel; compact?: boolean }) {
  return (
    <aside className={`ruth-hermes ${compact ? 'is-compact' : ''}`} aria-label="Aperçu Hermès">
      <div className="ruth-hermes-head">
        <div className="ruth-orb"><Sparkles size={20} /></div>
        <div><span>Hermès</span><small>Présence RuthOS · lecture seule</small></div>
        <span className="ruth-live">présent</span>
      </div>
      <div className="ruth-message">
        <p>Bonjour Ruth.</p>
        <p>{model.hermesSummary}</p>
      </div>
      <div className="ruth-plan">
        <span>Plan proposé</span>
        <strong>Comparer → choisir → intégrer</strong>
        <small>Jarvis orchestrera les agents après validation explicite.</small>
      </div>
      <label className="ruth-chat-label" htmlFor={`ruth-chat-${compact ? 'compact' : 'full'}`}>Parler à RuthOS</label>
      <div className="ruth-chatbox">
        <input
          id={`ruth-chat-${compact ? 'compact' : 'full'}`}
          type="text"
          placeholder="Prototype : conversation désactivée"
          disabled
        />
        <button type="button" disabled aria-label="Micro désactivé dans le prototype"><Mic size={18} /></button>
      </div>
      <small className="ruth-safety">Aucune action, dépense ou publication ne peut partir de cet écran.</small>
    </aside>
  );
}

function Header({ variant, model }: { variant: VariantKey; model: ViewModel }) {
  return (
    <header className="ruth-header">
      <div>
        <span className="ruth-kicker">RuthOS · prototype {variant}</span>
        <h1>Bonjour Ruth, voici l’essentiel.</h1>
        <p>Mis à jour : {model.generatedAt}</p>
      </div>
      <div className="ruth-readonly"><Clock3 size={14} /> Prototype local · lecture seule</div>
    </header>
  );
}

function VariantA({ model }: { model: ViewModel }) {
  return (
    <div className="ruth-shell ruth-variant-a">
      <main id="ruth-main" className="ruth-main">
        <Header variant="A" model={model} />
        <div className="ruth-narrative">
          <div className="ruth-time-line" aria-hidden="true"><span /><span /><span /></div>
          <div className="ruth-story">
            <NextAction model={model} />
            <Decisions model={model} />
            <Projects model={model} />
            <div className="ruth-two"><Business model={model} /><Risks model={model} /></div>
          </div>
        </div>
      </main>
      <HermesPanel model={model} />
    </div>
  );
}

function VariantB({ model }: { model: ViewModel }) {
  return (
    <div className="ruth-shell ruth-variant-b">
      <main id="ruth-main" className="ruth-main">
        <Header variant="B" model={model} />
        <div className="ruth-grid">
          <NextAction model={model} compact />
          <Decisions model={model} />
          <Projects model={model} horizontal />
          <Business model={model} />
          <Risks model={model} />
        </div>
      </main>
      <HermesPanel model={model} />
    </div>
  );
}

function VariantC({ model }: { model: ViewModel }) {
  return (
    <div className="ruth-focus-shell">
      <main id="ruth-main" className="ruth-main">
        <Header variant="C" model={model} />
        <div className="ruth-focus">
          <NextAction model={model} />
          <div className="ruth-focus-row"><Decisions model={model} /><Risks model={model} /></div>
          <Projects model={model} horizontal />
          <Business model={model} />
        </div>
      </main>
      <HermesPanel model={model} compact />
    </div>
  );
}

// STATUS_COLORS / StatusKey / priorityToStatus vivent maintenant dans
// designSystem.ts (partagé, réutilisable par les futurs écrans du cockpit).

function StatusPill({ status, label }: { status: StatusKey; label: string }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      className="d-pill"
      style={{ background: c.bg, color: c.fg, borderColor: c.border }}
    >
      {label}
    </span>
  );
}

function DStatCard({
  icon,
  title,
  status,
  statusLabel,
  value,
  detail,
  footer,
}: {
  icon: ReactNode;
  title: string;
  status: StatusKey;
  statusLabel: string;
  value: string;
  detail: string;
  footer?: ReactNode;
}) {
  const c = STATUS_COLORS[status];
  return (
    <article className="d-stat" style={{ borderColor: c.border }}>
      <div className="d-stat-head">
        <span className="d-stat-icon" style={{ color: c.fg }}>{icon}</span>
        <span className="d-stat-title">{title}</span>
        <StatusPill status={status} label={statusLabel} />
      </div>
      <strong className="d-stat-value">{value}</strong>
      <p className="d-stat-detail">{detail}</p>
      {footer}
    </article>
  );
}

function VariantD({ model, snapshot }: { model: ViewModel; snapshot: PersonalCockpitSnapshot | null }) {
  const rawValidations = snapshot?.pending_validations ?? [];
  const validationsCount = snapshot?.pending_validations_count ?? rawValidations.length;
  const alertsCount = model.risks.length;
  const turnCount = snapshot?.general_state?.turn_count ?? 0;
  const generalStatus = snapshot?.general_state?.status || snapshot?.general_state?.live_status || '';
  const hermesStatus: StatusKey = alertsCount > 0 || generalStatus.toLowerCase().includes('warn') ? 'attention' : 'active';
  const alertStatus: StatusKey = alertsCount > 0 ? 'attention' : 'active';

  return (
    <div className="ruth-variant-d">
      <aside className="d-sidebar">
        <div className="d-brand">
          <div className="d-orb-small" />
          <div>
            <strong>Ruth OS 360°</strong>
            <span>Control Center</span>
          </div>
        </div>
        <nav className="d-nav">
          <a className="d-nav-item" href="#"><MessagesSquare size={17} /> Discussion avec Hermès</a>
          <a className="d-nav-item is-active" href="#"><Gauge size={17} /> Ruth OS 360°</a>
          <a className="d-nav-item" href="#"><BarChart3 size={17} /> Tableau de bord</a>
          <a className="d-nav-item" href="#"><FolderKanban size={17} /> Journaux</a>
          <a className="d-nav-item" href="#"><Settings size={17} /> Paramètres</a>
        </nav>
        <div className="d-profile">
          <div className="d-avatar" />
          <div>
            <strong>Ruth</strong>
            <span><i className="d-dot d-dot-active" /> Profil actif</span>
          </div>
        </div>
      </aside>

      <main className="d-main">
        <div className="d-topbar">
          <span className="d-status-line"><i className="d-dot d-dot-active" /> Système opérationnel</span>
          <button type="button" className="d-ghost-btn" disabled title="Prototype en lecture seule">
            <RefreshCw size={15} /> Actualiser
          </button>
        </div>

        <section className="d-hero">
          <div className="d-orb-big" aria-hidden="true" />
          <h1>Bonjour Ruth,<br />qu’est-ce qu’on fait aujourd’hui&nbsp;?</h1>
          <p>Ruth parle à Hermès. Jarvis orchestre ensuite les bons agents et ouvre le cockpit sur demande.</p>
          <div className="d-hero-actions">
            <button type="button" className="d-btn-primary" disabled title="Prototype en lecture seule">
              <Mic size={16} /> Parler à Hermès
            </button>
            <button type="button" className="d-btn-outline" disabled title="Prototype en lecture seule">
              Ouvrir le cockpit
            </button>
          </div>
          <div className="d-chips">
            <span className="d-chip">{model.hermesSummary ? 'Hermès actif' : 'En attente'}</span>
            <span className="d-chip">{model.servicesToWatch > 0 ? `${model.servicesToWatch} service(s) à surveiller` : 'Voix : en attente'}</span>
          </div>
        </section>

        <section className="d-stats">
          <DStatCard
            icon={<Sparkles size={18} />}
            title="HERMÈS"
            status={hermesStatus}
            statusLabel={hermesStatus === 'attention' ? 'attention' : 'actif'}
            value={hermesStatus === 'attention' ? 'attention' : 'actif'}
            detail={model.hermesSummary}
          />
          <DStatCard
            icon={<Bell size={18} />}
            title="ALERTES"
            status={alertStatus}
            statusLabel={alertsCount > 0 ? 'attention' : 'ok'}
            value={String(alertsCount)}
            detail={alertsCount > 0 ? model.risks[0]?.title ?? '' : 'Aucune alerte active'}
          />
          <DStatCard
            icon={<CheckCircle2 size={18} />}
            title="VALIDATIONS"
            status="validation"
            statusLabel={String(validationsCount)}
            value={`${validationsCount} en attente`}
            detail={rawValidations.length ? `Priorité : ${rawValidations[0]?.priority || '—'}` : 'Aucune validation en attente'}
          />
          <DStatCard
            icon={<Clock3 size={18} />}
            title="ACTIVITÉ"
            status="info"
            statusLabel="normal"
            value={`${turnCount} tour(s)`}
            detail="en mémoire de session"
          />
        </section>

        <section className="d-projects">
          <div className="d-section-head">
            <h2>PROJETS &amp; MODULES</h2>
            <a href="#">Voir tous les projets →</a>
          </div>
          <div className="d-projects-grid">
            {model.projects.map((project, index) => (
              <article className="d-project-card" key={`${project.title}-${index}`}>
                <div className="d-project-head">
                  <strong>{project.title}</strong>
                  <StatusPill status="active" label="Actif" />
                </div>
                <p>{project.summary}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="d-telemetry">
          <div className="d-section-head">
            <h3>TÉLÉMÉTRIE SYSTÈME (VUE SECONDAIRE)</h3>
            <a href="#">Vue détaillée →</a>
          </div>
          <div className="d-telemetry-row">
            <div><span>Services sains</span><strong>{model.healthyServices}</strong></div>
            <div><span>Services à surveiller</span><strong>{model.servicesToWatch}</strong></div>
            <div><span>Dernière mise à jour</span><strong>{model.generatedAt}</strong></div>
          </div>
        </section>
      </main>

      <aside className="d-commands">
        <div className="d-commands-head">
          <h2>VOS COMMANDES</h2>
          <button type="button" className="d-ghost-btn" disabled title="Prototype en lecture seule"><Plus size={14} /> Nouvelle</button>
        </div>
        <div className="d-commands-list">
          {rawValidations.length ? (
            rawValidations.map((item) => {
              const status = priorityToStatus(item.priority || '');
              return (
                <article className="d-command-card" style={{ borderColor: STATUS_COLORS[status].border }} key={item.id}>
                  <div className="d-command-head">
                    <strong>{item.title}</strong>
                    <StatusPill status={status} label={item.priority || 'normal'} />
                  </div>
                  <span className="d-command-tag">{item.source} · {item.project} · {item.status}</span>
                  <p>{item.why_pending || item.expected_action}</p>
                  <div className="d-command-actions">
                    <button type="button" className="d-btn-primary d-btn-sm" disabled title="Branché plus tard sur /api/hermes/validate">Lancer</button>
                    <button type="button" className="d-btn-outline d-btn-sm" disabled title="Pas encore de délégation par item">Déléguer</button>
                    <button type="button" className="d-btn-outline d-btn-sm" disabled title="Pas encore d'action de report">Reporter</button>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="d-empty">Aucune commande en attente.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function EFocusHero({ model }: { model: ViewModel }) {
  return (
    <section className="e-hero">
      <div className="e-hero-orb" aria-hidden="true" />
      <div className="e-hero-text">
        <span className="e-eyebrow"><Sparkles size={13} /> Prochaine action</span>
        <h2>{model.nextAction}</h2>
        <p>{model.nextActionDetail}</p>
        <button type="button" className="d-btn-primary" disabled title="Prototype en lecture seule">
          Continuer avec Hermès <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

function EDecisions({ snapshot }: { snapshot: PersonalCockpitSnapshot | null }) {
  const rawValidations = snapshot?.pending_validations ?? [];
  return (
    <article className="e-card">
      <div className="e-card-head"><CheckCircle2 size={15} /> <span>À décider</span></div>
      <div className="e-stack">
        {rawValidations.length ? (
          rawValidations.map((item) => {
            const status = priorityToStatus(item.priority || '');
            return (
              <div className="e-row" key={item.id}>
                <StatusPill status={status} label={item.priority || 'normal'} />
                <div className="e-row-body">
                  <strong>{item.title}</strong>
                  <p>{item.why_pending || item.expected_action}</p>
                </div>
                <div className="e-row-actions">
                  <button type="button" className="d-btn-outline d-btn-sm" disabled title="Branché plus tard sur /api/hermes/validate">Lancer</button>
                  <button type="button" className="d-btn-outline d-btn-sm" disabled title="Pas encore de délégation par item">Déléguer</button>
                </div>
              </div>
            );
          })
        ) : (
          <p className="d-empty">Aucune décision en attente.</p>
        )}
      </div>
    </article>
  );
}

function ERisks({ model }: { model: ViewModel }) {
  const risks = model.risks.length
    ? model.risks
    : [{ title: 'Aucun risque urgent détecté', detail: `${model.servicesToWatch} service(s) à surveiller.`, level: 'stable' }];
  return (
    <article className="e-card">
      <div className="e-card-head"><ShieldAlert size={15} /> <span>Risques &amp; coûts</span></div>
      <div className="e-stack">
        {risks.map((risk, index) => {
          const status: StatusKey = risk.level === 'stable' ? 'active' : risk.level === 'urgent' ? 'urgent' : 'attention';
          return (
            <div className="e-row" key={`${risk.title}-${index}`}>
              <StatusPill status={status} label={risk.level} />
              <div className="e-row-body">
                <strong>{risk.title}</strong>
                <p>{risk.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function VariantE({ model, snapshot }: { model: ViewModel; snapshot: PersonalCockpitSnapshot | null }) {
  return (
    <div className="ruth-variant-e">
      <aside className="d-sidebar">
        <div className="d-brand">
          <div className="d-orb-small" />
          <div>
            <strong>Ruth OS 360°</strong>
            <span>Control Center</span>
          </div>
        </div>
        <nav className="d-nav">
          <a className="d-nav-item" href="#"><MessagesSquare size={17} /> Discussion avec Hermès</a>
          <a className="d-nav-item is-active" href="#"><Gauge size={17} /> Ruth OS 360°</a>
          <a className="d-nav-item" href="#"><BarChart3 size={17} /> Tableau de bord</a>
          <a className="d-nav-item" href="#"><FolderKanban size={17} /> Journaux</a>
          <a className="d-nav-item" href="#"><Settings size={17} /> Paramètres</a>
        </nav>
        <div className="d-profile">
          <div className="d-avatar" />
          <div>
            <strong>Ruth</strong>
            <span><i className="d-dot d-dot-active" /> Profil actif</span>
          </div>
        </div>
      </aside>

      <main className="e-main">
        <div className="d-topbar">
          <span className="d-status-line"><i className="d-dot d-dot-active" /> Système opérationnel</span>
          <button type="button" className="d-ghost-btn" disabled title="Prototype en lecture seule">
            <RefreshCw size={15} /> Actualiser
          </button>
        </div>

        <EFocusHero model={model} />

        <div className="e-row-two">
          <EDecisions snapshot={snapshot} />
          <ERisks model={model} />
        </div>

        <section className="e-projects">
          <div className="d-section-head">
            <h2>PROJETS &amp; MODULES</h2>
            <a href="#">Voir tous les projets →</a>
          </div>
          <div className="e-projects-strip">
            {model.projects.map((project, index) => (
              <article className="d-project-card e-project-card" key={`${project.title}-${index}`}>
                <div className="d-project-head">
                  <strong>{project.title}</strong>
                  <StatusPill status="active" label="Actif" />
                </div>
                <p>{project.summary}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="e-secondary">
          <div className="d-section-head"><h3>BUSINESS &amp; TÉLÉMÉTRIE (VUE SECONDAIRE)</h3></div>
          <div className="d-telemetry-row">
            <div><span>Services sains</span><strong>{model.healthyServices}</strong></div>
            <div><span>Services à surveiller</span><strong>{model.servicesToWatch}</strong></div>
            <div><span>Chiffre d’affaires</span><strong>—</strong></div>
            <div><span>Dernière mise à jour</span><strong>{model.generatedAt}</strong></div>
          </div>
        </section>
      </main>

      <div className="e-hermes-dock">
        <div className="e-hermes-orb" />
        <input type="text" placeholder="Parler à Hermès — prototype, désactivé" disabled />
        <button type="button" disabled aria-label="Micro désactivé dans le prototype"><Mic size={17} /></button>
      </div>
    </div>
  );
}

type HomeTile = {
  key: 'projets' | 'personnel' | 'alertes' | 'attente';
  label: string;
  icon: ReactNode;
  count: number;
  teaser: string;
  status: StatusKey;
  sourced: boolean;
};

type PendingValidation = NonNullable<PersonalCockpitSnapshot['pending_validations']>[number];

function buildHomeTiles(model: ViewModel, snapshot: PersonalCockpitSnapshot | null): HomeTile[] {
  const rawValidations = snapshot?.pending_validations ?? [];
  const pendingCount = snapshot?.pending_validations_count ?? rawValidations.length;
  const projectWithDecision = rawValidations[0]?.project;
  const personnelCount = snapshot?.obsidian_action_inbox_count ?? 0;

  return [
    {
      key: 'projets',
      label: 'Projets',
      icon: <FolderKanban size={18} />,
      count: model.projects.length,
      teaser: projectWithDecision
        ? `${projectWithDecision} attend une décision`
        : `${model.projects.length} actif(s), rien de bloquant`,
      status: projectWithDecision ? 'attention' : 'active',
      sourced: true,
    },
    {
      key: 'personnel',
      label: 'Personnel',
      icon: <BriefcaseBusiness size={18} />,
      count: personnelCount,
      teaser: personnelCount > 0 ? `${personnelCount} idée(s)/tâche(s) à traiter` : 'Rien en attente (Obsidian)',
      status: 'info',
      sourced: false,
    },
    {
      key: 'alertes',
      label: 'Alertes',
      icon: <Bell size={18} />,
      count: model.risks.length,
      teaser: model.risks.length ? model.risks[0]?.title ?? '' : 'Aucune alerte active',
      status: model.risks.length ? 'attention' : 'active',
      sourced: true,
    },
    {
      key: 'attente',
      label: 'En attente',
      icon: <CheckCircle2 size={18} />,
      count: pendingCount,
      teaser: pendingCount ? `${pendingCount} décision(s) à donner` : 'Rien à valider',
      status: pendingCount ? 'validation' : 'active',
      sourced: true,
    },
  ];
}

function HomeSidebar() {
  return (
    <aside className="d-sidebar">
      <div className="d-brand">
        <div className="d-orb-small" />
        <div>
          <strong>Ruth OS 360°</strong>
          <span>Control Center</span>
        </div>
      </div>
      <nav className="d-nav">
        <a className="d-nav-item" href="#"><MessagesSquare size={17} /> Discussion avec Hermès</a>
        <a className="d-nav-item is-active" href="#"><Gauge size={17} /> Ruth OS 360°</a>
        <a className="d-nav-item" href="#"><BarChart3 size={17} /> Tableau de bord</a>
        <a className="d-nav-item" href="#"><FolderKanban size={17} /> Journaux</a>
        <a className="d-nav-item" href="#"><Settings size={17} /> Paramètres</a>
      </nav>
      <div className="d-profile">
        <div className="d-avatar" />
        <div>
          <strong>Ruth</strong>
          <span><i className="d-dot d-dot-active" /> Profil actif</span>
        </div>
      </div>
    </aside>
  );
}

function VariantF({ model, snapshot }: { model: ViewModel; snapshot: PersonalCockpitSnapshot | null }) {
  const tiles = useMemo(() => buildHomeTiles(model, snapshot), [model, snapshot]);
  const pendingCount = tiles.find((t) => t.key === 'attente')?.count ?? 0;

  return (
    <div className="ruth-variant-f">
      <HomeSidebar />
      <main className="f-main">
        <div className="d-topbar">
          <span className="d-status-line"><i className="d-dot d-dot-active" /> Système opérationnel</span>
          <button type="button" className="d-ghost-btn" disabled title="Prototype en lecture seule">
            <RefreshCw size={15} /> Actualiser
          </button>
        </div>

        <div className="f-column">
          <div className="f-hermes-line"><Sparkles size={14} /> Hermès</div>
          <h1 className="f-title">Voici ce qui compte maintenant.</h1>

          <article className="f-hero-card">
            <span className="f-hero-eyebrow">Priorité</span>
            <h2>{model.nextAction}</h2>
            <p>{model.nextActionDetail}</p>
            <button type="button" className="d-btn-primary" disabled title="Prototype en lecture seule">
              Continuer <ChevronRight size={16} />
            </button>
          </article>

          {pendingCount > 0 ? (
            <button type="button" className="f-pending-banner" disabled title="Prototype en lecture seule">
              <StatusPill status="validation" label={String(pendingCount)} />
              <span>{pendingCount} décision{pendingCount > 1 ? 's' : ''} t&apos;attend{pendingCount > 1 ? 'ent' : ''}</span>
              <ChevronRight size={16} />
            </button>
          ) : null}

          <div className="f-tiles">
            {tiles.map((tile) => (
              <button type="button" key={tile.key} className="f-tile" disabled title="Prototype en lecture seule">
                <span className="f-tile-icon" style={{ color: STATUS_COLORS[tile.status].fg }}>{tile.icon}</span>
                <span className="f-tile-label">{tile.label}</span>
                <span className="f-tile-teaser">{tile.teaser}{!tile.sourced ? ' · source à connecter' : ''}</span>
              </button>
            ))}
          </div>
        </div>
      </main>

      <div className="e-hermes-dock">
        <div className="e-hermes-orb" />
        <input type="text" placeholder="Parler à Hermès — prototype, désactivé" disabled />
        <button type="button" disabled aria-label="Micro désactivé dans le prototype"><Mic size={17} /></button>
      </div>
    </div>
  );
}

function PendingValidationsDetail({
  snapshot,
  onBack,
}: {
  snapshot: PersonalCockpitSnapshot | null;
  onBack: () => void;
}) {
  const items = (snapshot?.pending_validations ?? []).filter((item) => item.status !== 'done');

  return (
    <div className="ruth-variant-g">
      <HomeSidebar />
      <main className="g-main" id="ruth-main">
        <div className="d-topbar">
          <button type="button" className="d-ghost-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Retour à Hermès
          </button>
          <span className="d-status-line"><i className="d-dot d-dot-active" /> Données Hermès</span>
        </div>

        <section className="g-detail" aria-labelledby="pending-title">
          <div className="g-detail-heading">
            <span>Décisions de Ruth</span>
            <h1 id="pending-title">En attente</h1>
            <p>Voici les décisions qui demandent réellement ton regard. Rien n’est validé depuis cette liste.</p>
          </div>

          {items.length ? (
            <div className="g-pending-list">
              {items.map((item: PendingValidation) => (
                <article className="g-pending-item" key={item.id}>
                  <div className="g-pending-item-head">
                    <div>
                      <span className="g-pending-project">{cleanText(item.project, 'Projet à préciser')}</span>
                      <h2>{cleanText(item.title, 'Décision à examiner')}</h2>
                    </div>
                    <StatusPill status={priorityToStatus(item.priority)} label={cleanText(item.priority, 'à examiner')} />
                  </div>
                  <p>{cleanText(item.why_pending, 'Hermès attend ta décision sur ce point.')}</p>
                  <div className="g-pending-action">
                    <span>Action attendue</span>
                    <strong>{cleanText(item.expected_action, 'À examiner avec Hermès.')}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="g-empty-state">
              <CheckCircle2 size={21} />
              <div><strong>Rien à valider maintenant</strong><p>Hermès ne signale aucune décision en attente.</p></div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AlertesDetail({
  snapshot,
  onBack,
}: {
  snapshot: PersonalCockpitSnapshot | null;
  onBack: () => void;
}) {
  const items = snapshot?.alerts ?? [];

  return (
    <div className="ruth-variant-g">
      <HomeSidebar />
      <main className="g-main" id="ruth-main">
        <div className="d-topbar">
          <button type="button" className="d-ghost-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Retour à Hermès
          </button>
          <span className="d-status-line"><i className="d-dot d-dot-active" /> Données Hermès</span>
        </div>

        <section className="g-detail" aria-labelledby="alertes-title">
          <div className="g-detail-heading">
            <span>Points de vigilance</span>
            <h1 id="alertes-title">Alertes</h1>
            <p>Ce qui mérite ton attention maintenant — rien n’est corrigé automatiquement depuis cette liste.</p>
          </div>

          {items.length ? (
            <div className="g-pending-list">
              {items.map((item, index) => {
                const status: StatusKey = item.level === 'urgent' || item.level === 'critical'
                  ? 'urgent'
                  : item.level === 'stable'
                    ? 'active'
                    : 'attention';
                return (
                  <article className="g-pending-item" key={`${item.title}-${index}`}>
                    <div className="g-pending-item-head">
                      <div>
                        <span className="g-pending-project">Alerte</span>
                        <h2>{cleanText(item.title, 'Point de vigilance')}</h2>
                      </div>
                      <StatusPill status={status} label={cleanText(item.level, 'attention')} />
                    </div>
                    <p>{cleanText(item.detail, 'Aucun détail supplémentaire fourni.')}</p>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="g-empty-state">
              <CheckCircle2 size={21} />
              <div><strong>Aucune alerte active</strong><p>Hermès ne signale aucun point de vigilance pour l’instant.</p></div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// Panneau "Agents / Système" — demande Ruth 2026-08-31 (fusion Jarvis G +
// ancien Jarvis) : petit espace de contrôle secondaire, accessible depuis
// une tuile, jamais sur la Home. Lecture seule, données réelles.
// Phase 3 — Ruth (2026-08-31) : "vérifier facilement que la mission a bien
// été envoyée dans la vraie session/terminal de l'agent concerné." Overlay
// simple, lecture seule, transcript brut complet.
function SessionLogModal({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessionLog()
      .then((result) => {
        setContent(result.available ? result.content : 'Aucune session enregistrée pour l\'instant.');
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Impossible de lire la session'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="g-session-overlay" role="dialog" aria-modal="true" aria-labelledby="session-log-title">
      <div className="g-session-modal">
        <div className="g-session-modal-head">
          <h2 id="session-log-title">Session réelle — dernière exécution</h2>
          <button type="button" className="d-ghost-btn d-ghost-btn-icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {loading ? (
          <p className="g-system-note">Lecture…</p>
        ) : error ? (
          <p className="g-system-down">{error}</p>
        ) : (
          <pre className="g-session-log-text">{content}</pre>
        )}
      </div>
    </div>
  );
}

function SystemeDetail({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<AgentsStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSessionLog, setShowSessionLog] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchAgentsStatus()
      .then((result) => {
        setStatus(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Impossible de vérifier les agents'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="ruth-variant-g">
      <HomeSidebar />
      <main className="g-main" id="ruth-main">
        <div className="d-topbar">
          <button type="button" className="d-ghost-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Retour à Hermès
          </button>
          <button type="button" className="d-ghost-btn" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'd-spin' : undefined} /> Vérifier maintenant
          </button>
        </div>

        <section className="g-detail" aria-labelledby="systeme-title">
          <div className="g-detail-heading">
            <span>Contrôle</span>
            <h1 id="systeme-title">Agents / Système</h1>
            <p>Ce qu'Hermès a réellement sous la main en ce moment — vérifié à l'instant, pas une estimation.</p>
          </div>

          {error ? (
            <div className="g-empty-state">
              <ShieldAlert size={21} />
              <div><strong>Vérification impossible</strong><p>{error}</p></div>
            </div>
          ) : (
            <div className="g-system-grid">
              {status?.agents.map((agent) => (
                <article className="g-system-card" key={agent.agent}>
                  <div className="g-system-card-head">
                    <Cpu size={16} />
                    <strong>{agent.agent === 'claude' ? 'Claude' : agent.agent === 'codex' ? 'Codex' : agent.agent}</strong>
                  </div>
                  <p className={agent.available ? 'g-system-ok' : 'g-system-down'}>
                    {agent.available ? '● Installé et joignable' : '● Non joignable'}
                  </p>
                  <p className="g-system-note">Fournisseur : {agent.provider}. Ne détecte pas un quota épuisé — seulement si l'outil est présent.</p>
                </article>
              ))}
              <article className="g-system-card">
                <div className="g-system-card-head">
                  <Gauge size={16} />
                  <strong>Dernière exécution</strong>
                </div>
                {status?.current_agent.executed_by ? (
                  <>
                    <p className={status.current_agent.fallback_used ? 'g-system-warn' : 'g-system-ok'}>
                      {status.current_agent.fallback_used
                        ? `⚠️ ${status.current_agent.requested_agent} indisponible → ${status.current_agent.executed_by}`
                        : `● Traité par ${status.current_agent.executed_by}`}
                    </p>
                    {status.current_agent.session_log_available ? (
                      <button type="button" className="g-session-link" onClick={() => setShowSessionLog(true)}>
                        Voir la session/terminal
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="g-system-note">Aucune exécution réelle enregistrée pour l'instant.</p>
                )}
              </article>
              <article className="g-system-card">
                <div className="g-system-card-head">
                  <Clock3 size={16} />
                  <strong>Mission en cours</strong>
                </div>
                {status?.mission_in_progress.active ? (
                  <p className="g-system-note">
                    <strong>{status.mission_in_progress.project_id}</strong> — {cleanText(status.mission_in_progress.request_summary, 'Demande en cours')}
                  </p>
                ) : (
                  <p className="g-system-note">Aucune mission en attente d'action.</p>
                )}
              </article>
            </div>
          )}
        </section>
      </main>
      {showSessionLog ? <SessionLogModal onClose={() => setShowSessionLog(false)} /> : null}
    </div>
  );
}

function ProjetsDetail({
  model,
  snapshot,
  onBack,
  onOpenProject,
}: {
  model: ViewModel;
  snapshot: PersonalCockpitSnapshot | null;
  onBack: () => void;
  onOpenProject: (id: string) => void;
}) {
  const rawValidations = snapshot?.pending_validations ?? [];

  return (
    <div className="ruth-variant-g">
      <HomeSidebar />
      <main className="g-main" id="ruth-main">
        <div className="d-topbar">
          <button type="button" className="d-ghost-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Retour à Hermès
          </button>
          <span className="d-status-line"><i className="d-dot d-dot-active" /> Données Hermès</span>
        </div>

        <section className="g-detail" aria-labelledby="projets-title">
          <div className="g-detail-heading">
            <span>Vue d’ensemble</span>
            <h1 id="projets-title">Projets</h1>
            <p>Résumé très court par projet — le détail complet reste au niveau 3, pas ici.</p>
          </div>

          {model.projects.length ? (
            <div className="g-pending-list">
              {model.projects.map((project, index) => {
                const decision = rawValidations.find(
                  (item) => (item.project || '').toLowerCase() === project.title.toLowerCase(),
                );
                return (
                  <button
                    type="button"
                    className="g-pending-item g-pending-item-clickable"
                    key={`${project.title}-${index}`}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <div className="g-pending-item-head">
                      <div>
                        <span className="g-pending-project">Projet</span>
                        <h2>{project.title}</h2>
                      </div>
                      {decision ? (
                        <StatusPill status={priorityToStatus(decision.priority)} label="décision requise" />
                      ) : (
                        <StatusPill status="active" label="rien de bloquant" />
                      )}
                    </div>
                    <p>{cleanText(project.summary, 'État à actualiser.')}</p>
                    {decision ? (
                      <div className="g-pending-action">
                        <span>Prochaine étape</span>
                        <strong>{cleanText(decision.expected_action, decision.title)}</strong>
                      </div>
                    ) : null}
                    <span className="g-pending-item-more">Voir le détail <ChevronRight size={14} /></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="g-empty-state">
              <CheckCircle2 size={21} />
              <div><strong>Aucun projet suivi pour l’instant</strong><p>Rien à afficher depuis le snapshot Hermès.</p></div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ProjectDetail({
  project,
  snapshot,
  onBack,
  onOpenHermes,
  onOpenBlock,
}: {
  project: ProjectData;
  snapshot: PersonalCockpitSnapshot | null;
  onBack: () => void;
  onOpenHermes: (message: string) => void;
  onOpenBlock: (num: string) => void;
}) {
  const [advSnapshot, setAdvSnapshot] = useState<AdvSnapshot | null>(null);
  const [blocks, setBlocks] = useState<ProjectBlock[] | null>(null);
  const [blocksTracked, setBlocksTracked] = useState(true);

  useEffect(() => {
    if (project.id !== 'adv') return;
    let cancelled = false;
    fetchAdvSnapshot()
      .then((data) => { if (!cancelled) setAdvSnapshot(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setBlocks(null);
    fetchProjectBlocks(project.id)
      .then((data) => {
        if (cancelled) return;
        setBlocksTracked(data.tracked);
        setBlocks(data.blocks);
      })
      .catch(() => { if (!cancelled) { setBlocksTracked(false); setBlocks([]); } });
    return () => { cancelled = true; };
  }, [project.id]);

  const liveKpis =
    project.id === 'adv' && advSnapshot && !advSnapshot._empty
      ? [
          {
            label: 'MRR',
            value: advSnapshot.business?.mrr != null ? `${advSnapshot.business.mrr.toLocaleString('fr-FR')} €` : '—',
            note: undefined as string | undefined,
          },
          {
            label: 'Abonnements actifs',
            value: advSnapshot.abonnements?.actifs != null ? String(advSnapshot.abonnements.actifs) : '—',
            note: undefined as string | undefined,
          },
          {
            label: 'Churn',
            value: advSnapshot.abonnements?.churn_rate != null ? `${(advSnapshot.abonnements.churn_rate * 100).toFixed(1)} %` : '—',
            note: undefined as string | undefined,
          },
        ]
      : null;

  const kpis = liveKpis ?? project.kpis;

  const alerts = project.id === 'jarvis' ? (snapshot?.alerts ?? []).filter((a) => a.level !== 'ok') : [];

  return (
    <div className="ruth-variant-g">
      <HomeSidebar />
      <main className="g-main" id="ruth-main">
        <div className="d-topbar">
          <button type="button" className="d-ghost-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Retour à Projets
          </button>
          <span className="d-status-line">
            <i className={`d-dot ${project.id === 'adv' ? 'd-dot-active' : ''}`} />
            {project.id === 'adv' ? 'Données live' : 'Données statiques'}
          </span>
        </div>

        <section className="g-detail" aria-labelledby="project-detail-title">
          <div className="g-detail-heading">
            <span>Projet</span>
            <h1 id="project-detail-title">{project.name}</h1>
            <p>{project.tagline}</p>
          </div>

          <div>
            <div className="g-detail-subheading">Construction A→Z</div>
            {blocks === null ? (
              <p className="g-blocks-loading">Chargement des blocs…</p>
            ) : !blocksTracked || blocks.length === 0 ? (
              <div className="g-empty-state">
                <CheckCircle2 size={21} />
                <div>
                  <strong>Pas encore suivi par blocs</strong>
                  <p>Ce projet n'a pas de PROJECT_BUILD_MAP.md pour l'instant — rien à afficher plutôt que d'inventer un découpage.</p>
                </div>
              </div>
            ) : (
              <div className="g-block-list">
                {blocks.map((block) => {
                  const meta = blockStatusMeta(block.status, block.pct);
                  const c = STATUS_COLORS[meta.status];
                  return (
                    <button
                      type="button"
                      className="g-block-row"
                      key={block.num}
                      onClick={() => onOpenBlock(block.num)}
                    >
                      <span className="g-block-num">{block.num}</span>
                      <span className="g-block-name">{block.name}</span>
                      <span className="g-block-bar-wrap">
                        <span className="g-block-bar-track">
                          {meta.pct !== null ? (
                            <span className="g-block-bar-fill" style={{ width: `${meta.pct}%`, background: c.fg }} />
                          ) : null}
                        </span>
                      </span>
                      <span className="g-block-pct">{meta.pct !== null ? `${meta.pct}%` : '—'}</span>
                      <StatusPill status={meta.status} label={block.status ?? cleanText(block.status_note, 'à consulter')} />
                      <ChevronRight size={14} className="g-block-chev" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {kpis.length > 0 && (
            <div className="g-stat-grid">
              {kpis.map((kpi) => (
                <div className="g-stat" key={kpi.label}>
                  <span>{kpi.label}</span>
                  <strong>{kpi.value}</strong>
                  {kpi.note ? <em>{kpi.note}</em> : null}
                </div>
              ))}
            </div>
          )}

          {alerts.length > 0 && (
            <div>
              <div className="g-detail-subheading">Alertes</div>
              <div className="g-pending-list">
                {alerts.map((alert, i) => (
                  <article className="g-pending-item" key={i}>
                    <div className="g-pending-item-head">
                      <h2>{cleanText(alert.title, 'Point de vigilance')}</h2>
                      <StatusPill status={alert.level === 'critical' ? 'urgent' : 'attention'} label={alert.level} />
                    </div>
                    {alert.detail ? <p>{alert.detail}</p> : null}
                  </article>
                ))}
              </div>
            </div>
          )}

          {project.decisions.length > 0 && (
            <div>
              <div className="g-detail-subheading">Décisions clés</div>
              <div className="g-decision-list">
                {project.decisions.map((d, i) => (
                  <div className="g-decision-item" key={i}>
                    <span>{d.date}</span>
                    <strong>{d.text}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="g-hermes-cta"
            onClick={() =>
              onOpenHermes(
                // L'id littéral (ex. "caisse-alliance-dreux") est inclus exprès :
                // hermes_core._project_context résout le projet par sous-chaîne
                // exacte de cet id, pas par le nom affiché — trouvé en corrigeant
                // ce bouton (2026-08-31), voir PROJECT_BUILD_MAP.md Bloc 03.
                `Hermès, il faut regarder le projet ${project.name} (${project.id}). ${cleanText(project.tagline, '')}`.trim(),
              )
            }
          >
            <Sparkles size={14} /> Demander à Hermès
          </button>
        </section>
      </main>
    </div>
  );
}

function BlockDetail({
  project,
  blockNum,
  onBack,
  onOpenHermes,
}: {
  project: ProjectData;
  blockNum: string;
  onBack: () => void;
  onOpenHermes: (message: string) => void;
}) {
  const [block, setBlock] = useState<ProjectBlock | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setBlock(undefined);
    fetchProjectBlocks(project.id)
      .then((data) => {
        if (cancelled) return;
        setBlock(data.blocks.find((b) => b.num === blockNum) ?? null);
      })
      .catch(() => { if (!cancelled) setBlock(null); });
    return () => { cancelled = true; };
  }, [project.id, blockNum]);

  if (block === undefined) {
    return (
      <div className="ruth-variant-g">
        <HomeSidebar />
        <main className="g-main" id="ruth-main">
          <div className="d-topbar">
            <button type="button" className="d-ghost-btn" onClick={onBack}>
              <ArrowLeft size={15} /> Retour aux blocs {project.name}
            </button>
          </div>
          <p className="g-blocks-loading">Chargement du bloc…</p>
        </main>
      </div>
    );
  }

  if (block === null) {
    return (
      <div className="ruth-variant-g">
        <HomeSidebar />
        <main className="g-main" id="ruth-main">
          <div className="d-topbar">
            <button type="button" className="d-ghost-btn" onClick={onBack}>
              <ArrowLeft size={15} /> Retour aux blocs {project.name}
            </button>
          </div>
          <div className="g-empty-state">
            <CheckCircle2 size={21} />
            <div><strong>Bloc introuvable</strong><p>Ce bloc n'existe plus dans le PROJECT_BUILD_MAP.md de {project.name}.</p></div>
          </div>
        </main>
      </div>
    );
  }

  const meta = blockStatusMeta(block.status, block.pct);
  const rows: Array<{ label: string; value: string; muted?: boolean }> = [
    { label: 'Existe', value: cleanText(block.existe, 'Rien de renseigné.') },
    { label: 'Manque', value: cleanText(block.manque, 'Rien de renseigné.'), muted: true },
    { label: 'Décision', value: cleanText(block.decision, 'Aucune.') },
  ];

  return (
    <div className="ruth-variant-g">
      <HomeSidebar />
      <main className="g-main" id="ruth-main">
        <div className="d-topbar">
          <button type="button" className="d-ghost-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Retour aux blocs {project.name}
          </button>
          <span className="d-status-line"><i className="d-dot" /> {block.status ?? cleanText(block.status_note, 'statut non précisé')}</span>
        </div>

        <section className="g-detail" aria-labelledby="block-detail-title">
          <div className="g-detail-heading">
            <span>Bloc {block.num} · {project.name}</span>
            <h1 id="block-detail-title">{block.name}</h1>
            {block.objectif ? <p>{renderInlineMarkdown(block.objectif)}</p> : null}
          </div>

          <div className="g-stat-grid">
            <div className="g-stat">
              <span>Avancement</span>
              <strong>{meta.pct !== null ? `${meta.pct}%` : '—'}</strong>
              {block.status_note ? <em>{renderInlineMarkdown(block.status_note)}</em> : null}
            </div>
            <div className="g-stat">
              <span>Statut</span>
              <strong><StatusPill status={meta.status} label={block.status ?? cleanText(block.status_note, 'à consulter')} /></strong>
            </div>
          </div>

          <div className="g-decision-list" style={{ marginTop: 24 }}>
            {rows.map((row) => (
              <div className="g-decision-item" key={row.label} style={{ display: 'block' }}>
                <span style={{ display: 'block', marginBottom: 4 }}>{row.label}</span>
                <strong style={{ color: row.muted ? 'var(--d-muted)' : undefined, fontWeight: 400 }}>{renderInlineMarkdown(row.value)}</strong>
              </div>
            ))}
          </div>

          {block.next_action ? (
            <div className="g-pending-action" style={{ marginTop: 20 }}>
              <span>Prochaine action de ce bloc</span>
              <strong>{renderInlineMarkdown(block.next_action)}</strong>
            </div>
          ) : null}

          <button
            type="button"
            className="g-hermes-cta"
            onClick={() => {
              const objectif = cleanText(block.objectif, '');
              const nextAction = cleanText(block.next_action, '');
              const message = [
                // Id littéral inclus (voir note ProjectDetail plus haut) —
                // nécessaire pour que hermes_core résolve le bon project_root.
                `Hermès, il faut travailler le projet ${project.name} (${project.id}), bloc ${block.num} — ${block.name}.`,
                objectif ? `Objectif : ${objectif}.` : '',
                nextAction ? `Prochaine action : ${nextAction}.` : '',
              ]
                .filter(Boolean)
                .join(' ');
              onOpenHermes(message);
            }}
          >
            <Sparkles size={14} /> Travailler ce bloc avec Hermès
          </button>
        </section>
      </main>
    </div>
  );
}

function VariantG({
  model,
  snapshot,
  onRefresh,
  connectionError,
  lastUpdatedAt,
  detail,
  projectId,
  blockNum,
  onOpenPending,
  onOpenAlertes,
  onOpenProjets,
  onOpenSysteme,
  onCloseDetail,
  onOpenProject,
  onBackToProjects,
  onOpenBlock,
  onBackToBlocks,
}: {
  model: ViewModel;
  snapshot: PersonalCockpitSnapshot | null;
  onRefresh?: () => Promise<void>;
  connectionError?: boolean;
  lastUpdatedAt?: string | null;
  detail: DetailKey | null;
  projectId: string | null;
  blockNum: string | null;
  onOpenPending: () => void;
  onOpenAlertes: () => void;
  onOpenProjets: () => void;
  onOpenSysteme: () => void;
  onCloseDetail: () => void;
  onOpenProject: (id: string) => void;
  onBackToProjects: () => void;
  onOpenBlock: (num: string) => void;
  onBackToBlocks: () => void;
}) {
  const tiles = useMemo(() => buildHomeTiles(model, snapshot), [model, snapshot]);
  const pendingCount = tiles.find((t) => t.key === 'attente')?.count ?? 0;
  const actionableValidation = snapshot?.general_state?.pending_validation ?? null;

  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [proposedMission, setProposedMission] = useState<Record<string, any> | null>(null);
  const [proposedRoute, setProposedRoute] = useState<Record<string, any> | null>(null);
  const [proposedMissionAt, setProposedMissionAt] = useState<string | null>(null);
  const [preparingExecution, setPreparingExecution] = useState(false);
  const [lastAgentInfo, setLastAgentInfo] = useState<{ requested_agent: string; executed_by: string; fallback_used: boolean; session_log_available?: boolean } | null>(null);
  const [showSessionLog, setShowSessionLog] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [previewAgent, setPreviewAgent] = useState<string | null>(null);
  // 3 états distincts (Codex, 2026-08-31) : bloc réel / consultation en
  // cours / dernière exécution prouvée — ne jamais laisser l'un écraser
  // visuellement les autres.
  const [missionHistory, setMissionHistory] = useState<MissionHistoryEntry[]>([]);
  const [lastExecution, setLastExecution] = useState<LastExecutionInfo | null>(null);

  const refreshProposedMission = useCallback(async () => {
    try {
      const result = await fetchProposedMission();
      setProposedMission(result.has_mission ? result.mission : null);
      setProposedRoute(result.has_mission ? result.route : null);
      setProposedMissionAt(result.has_mission ? result.generated_at ?? null : null);
      setMissionHistory(result.mission_history ?? []);
      setLastExecution(result.last_execution ?? null);
    } catch {
      // Lecture seule, best-effort — ne bloque jamais la conversation.
    }
  }, []);

  useEffect(() => {
    void refreshProposedMission();
  }, [refreshProposedMission]);

  // Identifiant de conversation stable — le contrat WebRTC (Codex, 2026-08-31)
  // exige que G envoie le même session_id que sa conversation texte, sinon le
  // runtime en crée un nouveau et la session vocale devient une mémoire
  // distincte de G.
  const [hermesSessionId] = useState<string>(() => {
    try {
      const existing = window.localStorage.getItem('ruthos-hermes-session-id');
      if (existing) return existing;
      const created = crypto.randomUUID();
      window.localStorage.setItem('ruthos-hermes-session-id', created);
      return created;
    } catch {
      return `session-${Date.now()}`;
    }
  });

  const handleVoiceMessage = useCallback((message: HermesVoiceMessage) => {
    if (message.role === 'user') return; // affichage : seule la réponse d'Hermès occupe la bulle
    setChatReply(message.text);
    // Le runtime V2 appelle déjà /api/hermes/chat côté serveur (contrat,
    // section "Flux reçu par G") — l'observateur Hermès tourne donc déjà en
    // tâche de fond ; on relit juste la mission qu'il prépare, comme après un
    // envoi texte classique.
    setTimeout(() => void refreshProposedMission(), 900);
  }, [refreshProposedMission]);

  const voiceSession = useHermesVoiceSession({ onMessage: handleVoiceMessage });

  const handleSend = useCallback(async (messageOverride?: string) => {
    const message = (messageOverride ?? chatInput).trim();
    if (!message || sending) return;
    setSending(true);
    try {
      const result = await sendPersonalCockpitChat(message, [], 'auto', hermesSessionId);
      setChatReply(result.reply);
      setChatInput('');
      if (result.warning) toast.warning(result.warning);
      // L'observateur Hermès tourne en tâche de fond côté serveur — laisser
      // un court délai avant de relire la mission proposée qu'il prépare.
      setTimeout(() => void refreshProposedMission(), 900);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Envoi à Hermès impossible');
    } finally {
      setSending(false);
    }
  }, [chatInput, sending, refreshProposedMission, hermesSessionId]);

  // "Travailler ce bloc avec Hermès" / "Demander à Hermès" — envoie le vrai
  // contexte du bloc/projet cliqué au même chat déjà câblé (handleSend), puis
  // revient à l'accueil où la carte "Mission proposée" apparaît. Avant ce
  // correctif (2026-08-31), ces boutons étaient câblés sur `onCloseDetail`
  // seul : ils fermaient l'écran sans rien envoyer à Hermès.
  const handleOpenHermesWithContext = useCallback(
    (message: string) => {
      void handleSend(message);
      onCloseDetail();
    },
    [handleSend, onCloseDetail],
  );

  // Bouton unique = démarrer/quitter la session complète (contrat, section
  // "Interruption / barge-in") — plus de clic par tour de parole, plus de
  // clic pour arrêter avant transcription. Le runtime pilote seul la fin de
  // parole, la réponse orale et l'interruption (VAD continu, pas de
  // POST /interrupt).
  const handleVoiceToggle = useCallback(async () => {
    if (voiceSession.isActive || voiceSession.runtimeState === 'connecting') {
      voiceSession.endSession();
      return;
    }
    try {
      await voiceSession.startSession(hermesSessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('denied')) {
        toast.error('Micro refusé par le navigateur, utilise le texte.');
      } else {
        toast.error(message || 'Session vocale indisponible, utilise le texte.');
      }
    }
  }, [voiceSession, hermesSessionId]);

  const voiceStateLabels: Record<string, string> = {
    connecting: 'Connexion…',
    LISTENING_ARMED: 'À l’écoute — parle quand tu veux',
    RECORDING: 'Ruth parle…',
    TRANSCRIBING: 'Transcription…',
    THINKING: 'Hermès réfléchit…',
    SPEAKING: 'Hermès parle — reparle pour l’interrompre',
    COOLDOWN: 'Hermès parle — reparle pour l’interrompre',
    LISTENING_AGAIN: 'À l’écoute — parle quand tu veux',
  };
  const micLabel = voiceSession.isActive || voiceSession.runtimeState === 'connecting'
    ? voiceStateLabels[voiceSession.runtimeState] ?? 'Session vocale active — clique pour quitter'
    : 'Activer la conversation vocale';

  const handlePrepareExecution = useCallback(async () => {
    if (preparingExecution) return;
    setPreparingExecution(true);
    try {
      const result = await prepareExecution();
      toast.success('Prêt — relis le prompt ci-dessous puis "Approuver et envoyer"');
      // La mission et son contexte restent visibles — Ruth (2026-08-31) :
      // "me montrer ce prompt avant envoi". Seule l'approbation efface tout.
      setPreviewPrompt(result.preview_prompt ?? null);
      setPreviewAgent(result.preview_agent ?? null);
      await onRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de préparer l'exécution");
    } finally {
      setPreparingExecution(false);
    }
  }, [preparingExecution, onRefresh]);

  const handleApprove = useCallback(async () => {
    if (approving) return;
    setApproving(true);
    try {
      const result = await submitHermesValidation('approve');
      toast.success(result.message || 'Validation Hermès enregistrée');
      if (result.warning) toast.warning(result.warning);
      // Persistant, pas juste le toast qui disparaît — Ruth (2026-08-31) :
      // "je veux toujours savoir quel agent travaille réellement".
      if (result.agent?.executed_by) setLastAgentInfo(result.agent);
      setProposedMission(null);
      setProposedRoute(null);
      setPreviewPrompt(null);
      setPreviewAgent(null);
      await onRefresh?.();
      // Recharge last_execution/mission_history — sinon le résultat qu'on
      // vient d'obtenir n'apparaît nulle part avant le prochain cycle de
      // polling (jusqu'à 45s).
      await refreshProposedMission();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation Hermès impossible');
    } finally {
      setApproving(false);
    }
  }, [approving, onRefresh, refreshProposedMission]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, onRefresh]);

  if (detail === 'attente') return <PendingValidationsDetail snapshot={snapshot} onBack={onCloseDetail} />;
  if (detail === 'alertes') return <AlertesDetail snapshot={snapshot} onBack={onCloseDetail} />;
  if (detail === 'systeme') return <SystemeDetail onBack={onCloseDetail} />;
  if (detail === 'projets' && projectId && PROJECTS[projectId] && blockNum) {
    return (
      <BlockDetail
        project={PROJECTS[projectId]}
        blockNum={blockNum}
        onBack={onBackToBlocks}
        onOpenHermes={handleOpenHermesWithContext}
      />
    );
  }
  if (detail === 'projets' && projectId && PROJECTS[projectId]) {
    return (
      <ProjectDetail
        project={PROJECTS[projectId]}
        snapshot={snapshot}
        onBack={onBackToProjects}
        onOpenHermes={handleOpenHermesWithContext}
        onOpenBlock={onOpenBlock}
      />
    );
  }
  if (detail === 'projets') return <ProjetsDetail model={model} snapshot={snapshot} onBack={onCloseDetail} onOpenProject={onOpenProject} />;

  return (
    <div className="ruth-variant-g">
      <HomeSidebar />
      <main className="g-main">
        <div className="d-topbar">
          {connectionError ? (
            <span className="d-status-line" title="La dernière tentative de synchronisation a échoué — les informations affichées peuvent être anciennes.">
              <i className="d-dot d-dot-error" /> Connexion à Hermès indisponible
              {lastUpdatedAt ? ` — dernière donnée connue à ${new Date(lastUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          ) : (
            <span className="d-status-line">
              <i className="d-dot d-dot-active" /> Système opérationnel
              {lastUpdatedAt ? ` — à jour à ${new Date(lastUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          )}
          <div className="d-topbar-actions">
            <button type="button" className="d-ghost-btn d-ghost-btn-icon" onClick={onOpenSysteme} title="Agents / Système — contrôle secondaire">
              <Cpu size={15} />
            </button>
            <button type="button" className="d-ghost-btn" onClick={handleRefresh} disabled={refreshing || !onRefresh}>
              <RefreshCw size={15} className={refreshing ? 'd-spin' : undefined} /> Actualiser
            </button>
          </div>
        </div>

        <section className="g-conversation">
          <div className="g-orb" aria-hidden="true" />
          <div className="g-bubble">
            <p className="g-bubble-lead">Bonjour Ruth.</p>
            <p className="g-bubble-main">{chatReply || model.nextAction}</p>
            {!chatReply ? <p className="g-bubble-detail">{model.nextActionDetail}</p> : null}
            <button
              type="button"
              className="d-btn-primary g-bubble-cta"
              onClick={handleApprove}
              disabled={!actionableValidation || approving}
              title={actionableValidation ? 'Approuve la validation Hermès active (réel)' : "Aucune validation active à approuver pour l'instant"}
            >
              {approving ? 'Envoi…' : actionableValidation ? 'Approuver et envoyer' : 'Rien à approuver maintenant'}
              {!approving ? <ChevronRight size={15} /> : null}
            </button>
            {lastAgentInfo ? (
              <>
                <p className={`g-agent-result${lastAgentInfo.fallback_used ? ' g-agent-result-fallback' : ''}`}>
                  {lastAgentInfo.fallback_used ? (
                    <>⚠️ <strong>{lastAgentInfo.requested_agent}</strong> indisponible → bascule vers <strong>{lastAgentInfo.executed_by}</strong></>
                  ) : (
                    <>✅ Envoyé à <strong>{lastAgentInfo.executed_by}</strong></>
                  )}
                </p>
                {lastAgentInfo.session_log_available ? (
                  <button type="button" className="g-session-link" onClick={() => setShowSessionLog(true)}>
                    Voir la session/terminal
                  </button>
                ) : null}
              </>
            ) : null}
            {pendingCount > 0 ? (
              <p className="g-bubble-note">
                <StatusPill status="validation" label={String(pendingCount)} /> Il y a aussi {pendingCount} décision{pendingCount > 1 ? 's' : ''} qui attend{pendingCount > 1 ? 'ent' : ''} ton avis.
              </p>
            ) : null}
            {proposedMission ? (
              <div className="g-mission-card">
                <span className="g-mission-eyebrow">Mission proposée — rien n'est lancé</span>
                <p className="g-mission-summary">{cleanText(proposedMission.request_summary, 'Demande en cours')}</p>
                {proposedMission.project_context?.status === 'resolved' ? (
                  <p className="g-mission-context">
                    Projet <strong>{proposedMission.project_context.project_id}</strong>
                    {proposedMission.project_context.block ? (
                      <> · bloc <strong>{proposedMission.project_context.block.num} — {proposedMission.project_context.block.name}</strong></>
                    ) : null}
                  </p>
                ) : null}
                {proposedMission.project_context?.block?.status ? (
                  // Ruth (2026-08-31) : le bloc peut déjà être TESTED pendant
                  // qu'une nouvelle consultation est juste proposée — ne
                  // jamais laisser croire que "rien n'est lancé" = "rien n'a
                  // jamais marché".
                  <p className="g-mission-context">
                    État réel du bloc : <strong>{proposedMission.project_context.block.status}</strong>
                    {proposedMission.project_context.block.status !== 'TESTED' &&
                    proposedMission.project_context.block.status !== 'DONE' ? (
                      <> — cette consultation ne l'a pas encore changé</>
                    ) : null}
                  </p>
                ) : null}
                <p className="g-mission-agent">
                  Agent recommandé : <strong>{proposedRoute?.route?.lead?.agent ?? proposedMission.recommended_agent ?? 'à déterminer'}</strong>
                  {proposedRoute?.route?.task_reason ? <> — {proposedRoute.route.task_reason}</> : null}
                </p>
                {previewPrompt ? (
                  <div className="g-mission-preview">
                    <span className="g-mission-eyebrow">Prompt exact — destiné à {previewAgent}</span>
                    <pre className="g-mission-preview-text">{previewPrompt}</pre>
                    <p className="g-mission-preview-note">C'est exactement ce que reçoit l'agent, rien de plus.</p>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="g-mission-cta"
                  onClick={() => void handlePrepareExecution()}
                  disabled={preparingExecution}
                >
                  {preparingExecution ? 'Préparation…' : previewPrompt ? 'Régénérer le prompt' : 'Préparer avec Hermès'}
                </button>
              </div>
            ) : null}
            {lastExecution ? (
              // 3e état demandé par Codex (2026-08-31, audit orchestration) :
              // distinct de "mission proposée" ci-dessus — s'affiche même sans
              // consultation active, pour ne jamais laisser croire que rien
              // n'a jamais été exécuté (bug Pedro d'origine).
              (() => {
                const historyEntry = missionHistory.find(
                  (entry) => entry.request_id === lastExecution.mission_request_id,
                );
                const agent = lastExecution.executed_by || lastExecution.requested_agent || 'agent inconnu';
                const when = lastExecution.resolved_at || lastExecution.executed_at;
                return (
                  <div className="g-mission-card g-last-execution-card">
                    <span className="g-mission-eyebrow g-mission-eyebrow-done">Dernière exécution réelle — preuve obtenue</span>
                    {historyEntry ? (
                      <p className="g-mission-context">
                        Projet <strong>{historyEntry.project_id || '—'}</strong>
                        {historyEntry.block_num ? (
                          <> · bloc <strong>{historyEntry.block_num} — {historyEntry.block_name}</strong></>
                        ) : null}
                        {historyEntry.block_status ? <> · état réel : <strong>{historyEntry.block_status}</strong></> : null}
                      </p>
                    ) : null}
                    <p className="g-mission-summary">
                      {cleanText(lastExecution.result_summary, 'Résultat enregistré, sans résumé détaillé.')}
                    </p>
                    <p className="g-mission-agent">
                      Exécuté par <strong>{agent}</strong>
                      {lastExecution.fallback_used ? ' (repli automatique)' : ''}
                      {when
                        ? ` · ${new Date(when).toLocaleString('fr-FR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`
                        : ''}
                    </p>
                  </div>
                );
              })()
            ) : null}
            <div className="g-bubble-input">
              <input
                type="text"
                placeholder="Dis à Hermès ce que tu veux faire"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSend();
                }}
                disabled={sending}
              />
              <button
                type="button"
                className={`g-mic-btn${
                  voiceSession.runtimeState === 'SPEAKING' || voiceSession.runtimeState === 'COOLDOWN'
                    ? ' g-mic-btn-speaking'
                    : voiceSession.isActive || voiceSession.runtimeState === 'connecting'
                      ? ' g-mic-btn-recording'
                      : ''
                }`}
                onClick={() => void handleVoiceToggle()}
                disabled={sending}
                aria-label={micLabel}
                title={micLabel}
              >
                {voiceSession.runtimeState === 'connecting' ||
                voiceSession.runtimeState === 'TRANSCRIBING' ||
                voiceSession.runtimeState === 'THINKING' ? (
                  <Loader2 size={16} className="d-spin" />
                ) : voiceSession.runtimeState === 'SPEAKING' || voiceSession.runtimeState === 'COOLDOWN' ? (
                  <Volume2 size={16} />
                ) : voiceSession.isActive ? (
                  <MicOff size={16} />
                ) : (
                  <Mic size={16} />
                )}
              </button>
              <button
                type="button"
                className="g-send-btn"
                onClick={() => void handleSend()}
                disabled={sending || !chatInput.trim()}
                aria-label="Envoyer à Hermès"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {voiceSession.isActive || voiceSession.runtimeState === 'connecting' ? (
              <p className="g-mic-status">{micLabel}</p>
            ) : null}
            {voiceSession.error ? <p className="g-mic-status g-mic-status-error">{voiceSession.error}</p> : null}
            {/* Session vocale WebRTC continue (contrat Codex, 2026-08-31) —
                l'audio distant arrive via pc.ontrack, jamais visible. */}
            <audio ref={voiceSession.audioElRef} autoPlay style={{ display: 'none' }} />
          </div>
        </section>

        <div className="g-tiles">
          {tiles.map((tile) => (
            <button
              type="button"
              key={tile.key}
              className="g-tile"
              onClick={
                tile.key === 'attente'
                  ? onOpenPending
                  : tile.key === 'alertes'
                    ? onOpenAlertes
                    : tile.key === 'projets'
                      ? onOpenProjets
                      : undefined
              }
              disabled={tile.key !== 'attente' && tile.key !== 'alertes' && tile.key !== 'projets'}
              title={
                tile.key === 'attente'
                  ? 'Voir les décisions en attente'
                  : tile.key === 'alertes'
                    ? 'Voir les alertes'
                    : tile.key === 'projets'
                      ? 'Voir les projets'
                      : 'Pas encore de page de détail — niveau 2 à construire'
              }
            >
              <div className="g-tile-top">
                <span style={{ color: STATUS_COLORS[tile.status].fg }}>{tile.icon}</span>
                <StatusPill status={tile.status} label={String(tile.count)} />
              </div>
              <strong>{tile.label}</strong>
              <span>{tile.teaser}{!tile.sourced ? ' · source à connecter' : ''}</span>
            </button>
          ))}
        </div>
      </main>
      {showSessionLog ? <SessionLogModal onClose={() => setShowSessionLog(false)} /> : null}
    </div>
  );
}

function MobileNavigation() {
  const items = [
    ['Accueil', Home], ['Projets', FolderKanban], ['Hermès', MessageCircle],
    ['Business', BriefcaseBusiness], ['Plus', MoreHorizontal],
  ] as const;

  return (
    <nav className="ruth-mobile-nav" aria-label="Navigation mobile prototype">
      {items.map(([label, Icon], index) => (
        <button key={label} type="button" className={index === 0 ? 'is-active' : ''} disabled={index !== 0}>
          <Icon size={20} /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function VariantSwitcher({ value, onChange }: { value: VariantKey; onChange: (value: VariantKey) => void }) {
  const index = VARIANTS.findIndex((variant) => variant.key === value);
  const move = (delta: number) => onChange(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
  const active = VARIANTS[index];

  return (
    <div className="ruth-switcher" aria-label="Sélecteur de variante">
      <button type="button" onClick={() => move(-1)} aria-label="Variante précédente"><ArrowLeft size={18} /></button>
      <div><strong>{active.key} · {active.label}</strong><span>{active.description}</span></div>
      <button type="button" onClick={() => move(1)} aria-label="Variante suivante"><ArrowRight size={18} /></button>
    </div>
  );
}

export function RuthOSPrototype({ snapshot, onRefresh, connectionError, lastUpdatedAt }: RuthOSPrototypeProps) {
  const [variant, setVariant] = useState<VariantKey>(currentVariant);
  const [detail, setDetail] = useState<DetailKey | null>(currentDetail);
  const [projectId, setProjectId] = useState<string | null>(currentProjectId);
  const [blockNum, setBlockNum] = useState<string | null>(currentBlockNum);
  const [sidebarInitiallyOpen] = useState(() => useAppStore.getState().sidebarOpen);
  const model = useMemo(() => buildViewModel(snapshot), [snapshot]);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);

  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 767px)').matches;
    const isDarkVariant = variant === 'D' || variant === 'E' || variant === 'F' || variant === 'G';
    setSidebarOpen(compactViewport || isDarkVariant ? false : sidebarInitiallyOpen);
  }, [setSidebarOpen, sidebarInitiallyOpen, variant]);

  useEffect(() => () => setSidebarOpen(sidebarInitiallyOpen), [setSidebarOpen, sidebarInitiallyOpen]);

  const selectDetail = useCallback((next: DetailKey | null) => {
    setDetail(next);
    setProjectId(null);
    setBlockNum(null);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('view', next);
    else url.searchParams.delete('view');
    url.searchParams.delete('project');
    url.searchParams.delete('block');
    window.history.pushState({}, '', url);
  }, []);

  const selectProject = useCallback((id: string) => {
    setDetail('projets');
    setProjectId(id);
    setBlockNum(null);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'projets');
    url.searchParams.set('project', id);
    url.searchParams.delete('block');
    window.history.pushState({}, '', url);
  }, []);

  const backToProjects = useCallback(() => {
    setProjectId(null);
    setBlockNum(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    url.searchParams.delete('block');
    window.history.pushState({}, '', url);
  }, []);

  const selectBlock = useCallback((num: string) => {
    setBlockNum(num);
    const url = new URL(window.location.href);
    url.searchParams.set('block', num);
    window.history.pushState({}, '', url);
  }, []);

  const backToBlocks = useCallback(() => {
    setBlockNum(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('block');
    window.history.pushState({}, '', url);
  }, []);

  const selectVariant = (next: VariantKey) => {
    setVariant(next);
    setDetail(null);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    url.searchParams.delete('view');
    window.history.replaceState({}, '', url);
  };

  useEffect(() => {
    const onPopState = () => {
      setVariant(currentVariant());
      setDetail(currentDetail());
      setProjectId(currentProjectId());
      setBlockNum(currentBlockNum());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (detail) {
        if (event.key === 'Escape') {
          if (blockNum) backToBlocks();
          else if (projectId) backToProjects();
          else selectDetail(null);
        }
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const index = VARIANTS.findIndex((item) => item.key === variant);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      selectVariant(VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length].key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail, projectId, blockNum, selectDetail, backToProjects, backToBlocks, variant]);

  return (
    <div className="ruth-prototype">
      <a className="ruth-skip" href="#ruth-main">Aller au contenu principal</a>
      {variant === 'A' ? <VariantA model={model} /> : null}
      {variant === 'B' ? <VariantB model={model} /> : null}
      {variant === 'C' ? <VariantC model={model} /> : null}
      {variant === 'D' ? <VariantD model={model} snapshot={snapshot} /> : null}
      {variant === 'E' ? <VariantE model={model} snapshot={snapshot} /> : null}
      {variant === 'F' ? <VariantF model={model} snapshot={snapshot} /> : null}
      {variant === 'G' ? (
        <VariantG
          model={model}
          snapshot={snapshot}
          onRefresh={onRefresh}
          connectionError={connectionError}
          lastUpdatedAt={lastUpdatedAt}
          detail={detail}
          projectId={projectId}
          blockNum={blockNum}
          onOpenPending={() => selectDetail('attente')}
          onOpenAlertes={() => selectDetail('alertes')}
          onOpenProjets={() => selectDetail('projets')}
          onOpenSysteme={() => selectDetail('systeme')}
          onCloseDetail={() => selectDetail(null)}
          onOpenProject={selectProject}
          onBackToProjects={backToProjects}
          onOpenBlock={selectBlock}
          onBackToBlocks={backToBlocks}
        />
      ) : null}
      <VariantSwitcher value={variant} onChange={selectVariant} />
      {variant !== 'D' && variant !== 'E' && variant !== 'F' && variant !== 'G' ? <MobileNavigation /> : null}
      <style>{RUTH_OS_STYLES}</style>
      <style>{RUTH_OS_VARIANT_D_STYLES}</style>
      <style>{RUTH_OS_VARIANT_E_STYLES}</style>
      <style>{RUTH_OS_VARIANT_FG_STYLES}</style>
    </div>
  );
}

// Rafraîchissement automatique tant que la page reste ouverte, sans clic
// manuel (demande Ruth 2026-08-31 : "je ne veux pas devoir cliquer sur un
// bouton pour rafraîchir"). Un échec ne doit jamais afficher silencieusement
// une donnée périmée comme si elle était à jour — connectionError le signale
// explicitement, snapshot précédent conservé à l'écran plutôt que vidé.
const AUTO_REFRESH_INTERVAL_MS = 45_000;

export function RuthOSPrototypeRoute() {
  const [snapshot, setSnapshot] = useState<PersonalCockpitSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const refresh = useCallback(() => {
    return fetchPersonalCockpit()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setConnectionError(false);
        setLastUpdatedAt(new Date().toISOString());
      })
      .catch(() => {
        // La donnée précédente reste affichée (mieux qu'un écran vide),
        // mais l'échec est signalé explicitement — jamais silencieux.
        setConnectionError(true);
      });
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return (
    <RuthOSPrototype
      snapshot={snapshot}
      onRefresh={refresh}
      connectionError={connectionError}
      lastUpdatedAt={lastUpdatedAt}
    />
  );
}

const RUTH_OS_STYLES = `
.ruth-prototype{--cream:#f6f1e7;--paper:#fffdf8;--ink:#173229;--muted:#6d776f;--green:#173e32;--green2:#285b49;--gold:#b78748;--terracotta:#a75e45;--line:#ded5c7;position:relative;flex:1;min-width:0;height:100%;overflow:auto;background:var(--cream);color:var(--ink);font-family:Geist,ui-sans-serif,system-ui,sans-serif;scrollbar-color:#b9ad9c transparent;padding-bottom:96px}
.ruth-prototype *{box-sizing:border-box}.ruth-prototype button,.ruth-prototype input{font:inherit}.ruth-prototype button:focus-visible,.ruth-prototype input:focus-visible,.ruth-prototype a:focus-visible{outline:3px solid #d79545;outline-offset:3px}.ruth-skip{position:fixed;top:10px;left:10px;z-index:80;transform:translateY(-160%);background:#fff;color:#173e32;padding:10px 14px;border-radius:10px}.ruth-skip:focus{transform:none}
.ruth-shell{display:grid;grid-template-columns:minmax(0,1fr) 390px;max-width:1600px;margin:0 auto;min-height:100%}.ruth-focus-shell{max-width:1480px;margin:0 auto;padding:0 28px}.ruth-main{min-width:0;padding:34px clamp(22px,3vw,48px) 120px}.ruth-focus-shell>.ruth-main{padding-left:0;padding-right:0}.ruth-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:28px}.ruth-kicker,.ruth-eyebrow{font-size:12px;font-weight:750;letter-spacing:.095em;text-transform:uppercase;color:var(--gold)}.ruth-header h1{font-family:Georgia,serif;font-size:clamp(30px,3.4vw,51px);font-weight:500;line-height:1.05;margin:8px 0 9px;letter-spacing:-.03em}.ruth-header p{margin:0;color:var(--muted);font-size:13px}.ruth-readonly{display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:9px 12px;background:rgba(255,253,248,.65);font-size:11px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
.ruth-card{background:rgba(255,253,248,.88);border:1px solid var(--line);border-radius:22px;padding:22px;box-shadow:0 16px 45px rgba(45,57,48,.06)}.ruth-eyebrow{display:flex;align-items:center;gap:7px;margin-bottom:15px}.ruth-card h2{font-family:Georgia,serif;font-size:clamp(25px,3vw,41px);line-height:1.08;font-weight:500;margin:0 0 12px}.ruth-card p{color:var(--muted);line-height:1.45;margin:0;font-size:14px}.ruth-next{background:linear-gradient(145deg,#1a4436,#123127);color:#fff;border-color:transparent;min-height:235px;display:flex;flex-direction:column;justify-content:center}.ruth-next .ruth-eyebrow{color:#e6c28f}.ruth-next p{color:#d9e2dc;max-width:620px}.ruth-primary{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;min-height:44px;margin-top:21px;border:0;border-radius:999px;background:#ecd4ad;color:#173229;font-weight:700;padding:10px 17px;cursor:not-allowed;opacity:.92}
.ruth-stack{display:grid;gap:10px}.ruth-list-row,.ruth-project,.ruth-risk{display:grid;align-items:center;gap:12px;border-top:1px solid #ebe4d8;padding:13px 0}.ruth-list-row{grid-template-columns:auto 1fr auto}.ruth-list-row:first-child,.ruth-project:first-child,.ruth-risk:first-child{border-top:0;padding-top:2px}.ruth-list-row strong,.ruth-project strong,.ruth-risk strong{display:block;font-size:14px;margin-bottom:3px}.ruth-list-row p,.ruth-project p,.ruth-risk p{font-size:12px}.ruth-project-tag{background:#e7efe7;color:#2b5848;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:750;white-space:nowrap}.ruth-project{grid-template-columns:36px 1fr}.ruth-project-index{font-family:Georgia,serif;font-size:18px;color:var(--gold)}.ruth-risk{grid-template-columns:auto 1fr auto}.ruth-risk>svg{color:var(--terracotta)}.ruth-risk>span{font-size:10px;text-transform:uppercase;border:1px solid #e4cabf;color:#874832;padding:5px 7px;border-radius:999px}.ruth-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}.ruth-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.ruth-kpis>div{background:#f3eee4;border-radius:14px;padding:13px;min-width:0}.ruth-kpis span,.ruth-kpis small{display:block;font-size:10px;color:var(--muted)}.ruth-kpis strong{display:block;font-family:Georgia,serif;font-size:25px;margin:7px 0}
.ruth-hermes{position:sticky;top:0;height:100vh;align-self:start;background:#14352b;color:#f7f1e7;padding:28px 25px;display:flex;flex-direction:column;gap:17px;border-left:1px solid rgba(255,255,255,.12)}.ruth-hermes-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px}.ruth-orb{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#f2d7a9,#b88547 55%,#70482b);box-shadow:0 0 28px rgba(231,189,126,.28)}.ruth-hermes-head span{font-family:Georgia,serif;font-size:21px}.ruth-hermes-head small{display:block;color:#b9c9c1;font-size:10px;margin-top:3px}.ruth-live{font-family:inherit!important;font-size:10px!important;text-transform:uppercase;color:#b8deb9!important;border:1px solid rgba(184,222,185,.4);padding:5px 7px;border-radius:999px}.ruth-message{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.11);padding:18px;border-radius:16px;line-height:1.5}.ruth-message p{margin:0 0 9px;color:#d9e5de;font-size:13px}.ruth-message p:first-child{font-family:Georgia,serif;font-size:20px;color:#fff}.ruth-message p:last-child{margin-bottom:0}.ruth-plan{border-left:2px solid #d1a361;padding:5px 0 5px 13px}.ruth-plan span,.ruth-plan small{display:block;color:#aabeb4;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.ruth-plan strong{display:block;margin:7px 0;font-size:13px}.ruth-chat-label{margin-top:auto;font-size:11px;color:#c3d0c9}.ruth-chatbox{display:grid;grid-template-columns:1fr 44px;gap:8px}.ruth-chatbox input{width:100%;height:46px;border-radius:13px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.15);color:#fff;padding:0 12px}.ruth-chatbox button{width:44px;height:44px;border:0;border-radius:13px;background:#d1a361;color:#173229}.ruth-safety{color:#9eb1a7;font-size:10px;line-height:1.4}
.ruth-narrative{display:grid;grid-template-columns:28px minmax(0,1fr);gap:14px}.ruth-story{display:grid;gap:18px}.ruth-time-line{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:space-around;padding:50px 0}.ruth-time-line:before{content:'';position:absolute;top:50px;bottom:50px;width:1px;background:#cbbb9f}.ruth-time-line span{width:9px;height:9px;border-radius:50%;background:var(--gold);border:3px solid var(--cream);box-shadow:0 0 0 1px var(--gold);z-index:1}
.ruth-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:18px}.ruth-grid>.ruth-next{grid-column:span 7}.ruth-grid>.ruth-card:nth-child(2){grid-column:span 5}.ruth-grid>.ruth-project-strip{grid-column:1/-1}.ruth-grid>.ruth-card:nth-child(4){grid-column:span 6}.ruth-grid>.ruth-card:nth-child(5){grid-column:span 6}.ruth-projects-horizontal{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px;overflow-x:auto}.ruth-projects-horizontal .ruth-project{border:1px solid #ebe4d8!important;padding:14px!important;border-radius:14px;min-width:180px}
.ruth-focus{display:grid;gap:18px}.ruth-focus>.ruth-next{min-height:360px;padding:clamp(28px,5vw,72px)}.ruth-focus>.ruth-next h2{max-width:900px;font-size:clamp(36px,5vw,67px)}.ruth-focus-row{display:grid;grid-template-columns:1fr 1fr;gap:18px}.ruth-focus-shell>.ruth-hermes{position:fixed;z-index:20;left:50%;bottom:100px;top:auto;transform:translateX(-50%);width:min(760px,calc(100vw - 48px));height:auto;border:1px solid rgba(255,255,255,.14);border-radius:21px;padding:16px 19px;box-shadow:0 24px 70px rgba(18,49,39,.28)}.ruth-focus-shell>.ruth-hermes .ruth-message,.ruth-focus-shell>.ruth-hermes .ruth-plan,.ruth-focus-shell>.ruth-hermes .ruth-chat-label,.ruth-focus-shell>.ruth-hermes .ruth-chatbox,.ruth-focus-shell>.ruth-hermes .ruth-safety{display:none}
.ruth-switcher{position:fixed;z-index:60;left:50%;bottom:22px;transform:translateX(-50%);display:grid;grid-template-columns:44px minmax(170px,260px) 44px;align-items:center;background:#fffdf9;border:1px solid #cfc3b2;border-radius:18px;padding:6px;box-shadow:0 18px 50px rgba(36,48,39,.22);color:var(--ink);max-width:calc(100vw - 24px)}.ruth-switcher button{width:44px;height:44px;border:0;border-radius:12px;background:#efe7da;color:var(--green);display:grid;place-items:center;cursor:pointer}.ruth-switcher>div{text-align:center;padding:0 10px}.ruth-switcher strong,.ruth-switcher span{display:block}.ruth-switcher strong{font-size:12px}.ruth-switcher span{font-size:10px;color:var(--muted);margin-top:2px}.ruth-mobile-nav{display:none}
.ruth-prototype:has(.ruth-variant-d) .ruth-switcher,.ruth-prototype:has(.ruth-variant-e) .ruth-switcher,.ruth-prototype:has(.ruth-variant-f) .ruth-switcher,.ruth-prototype:has(.ruth-variant-g) .ruth-switcher{background:#131a2c;border-color:#2a3555;color:#e8ecff;box-shadow:0 18px 50px rgba(5,8,20,.5)}.ruth-prototype:has(.ruth-variant-d) .ruth-switcher button,.ruth-prototype:has(.ruth-variant-e) .ruth-switcher button,.ruth-prototype:has(.ruth-variant-f) .ruth-switcher button,.ruth-prototype:has(.ruth-variant-g) .ruth-switcher button{background:#1c2440;color:#c7d2fe}.ruth-prototype:has(.ruth-variant-d) .ruth-switcher span,.ruth-prototype:has(.ruth-variant-e) .ruth-switcher span,.ruth-prototype:has(.ruth-variant-f) .ruth-switcher span,.ruth-prototype:has(.ruth-variant-g) .ruth-switcher span{color:#8891b8}
@media(max-width:1320px){.ruth-shell{grid-template-columns:1fr}.ruth-hermes{position:relative;height:auto;margin:0 22px 120px;border:0;border-radius:22px}.ruth-grid>.ruth-next,.ruth-grid>.ruth-card:nth-child(2),.ruth-grid>.ruth-card:nth-child(4),.ruth-grid>.ruth-card:nth-child(5){grid-column:1/-1}}
@media(max-width:700px){.ruth-prototype{padding-bottom:150px}.ruth-main,.ruth-focus-shell>.ruth-main{padding:20px 14px 190px}.ruth-focus-shell{padding:0}.ruth-header{display:block;margin-bottom:20px}.ruth-header h1{font-size:32px}.ruth-readonly{display:inline-flex;margin-top:14px}.ruth-card{padding:17px;border-radius:18px}.ruth-next{min-height:220px}.ruth-two,.ruth-focus-row{grid-template-columns:1fr}.ruth-narrative{grid-template-columns:1fr}.ruth-time-line{display:none}.ruth-kpis{grid-template-columns:1fr 1fr}.ruth-kpis>div:last-child{grid-column:1/-1}.ruth-hermes{margin:0 14px 190px;padding:19px 16px}.ruth-focus-shell>.ruth-hermes{position:relative;left:auto;bottom:auto;transform:none;width:auto;margin:0 14px 190px}.ruth-projects-horizontal{display:flex}.ruth-projects-horizontal .ruth-project{min-width:235px}.ruth-focus>.ruth-next{min-height:310px;padding:28px 20px}.ruth-focus>.ruth-next h2{font-size:37px}.ruth-switcher{bottom:82px;width:calc(100vw - 24px);grid-template-columns:44px minmax(0,1fr) 44px}.ruth-mobile-nav{position:fixed;z-index:55;left:0;right:0;bottom:0;height:70px;display:grid;grid-template-columns:repeat(5,1fr);background:#fffdf9;border-top:1px solid #d8cebf;padding:6px 5px max(6px,env(safe-area-inset-bottom))}.ruth-mobile-nav button{min-width:0;min-height:52px;border:0;background:transparent;color:#788078;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:9px}.ruth-mobile-nav button.is-active{color:var(--green)}.ruth-mobile-nav button:disabled{opacity:1}.ruth-mobile-nav button:nth-child(3){color:#fff;background:var(--green);border-radius:16px;margin-top:-14px;box-shadow:0 9px 24px rgba(23,62,50,.28)}}
`;

const RUTH_OS_VARIANT_D_STYLES = `
.ruth-variant-d{--d-bg:#0a0e1c;--d-bg2:#0d1226;--d-card:#111834;--d-card-border:#1f2947;--d-text:#eef1ff;--d-muted:#8891b8;--d-sidebar:#f5f7fb;--d-sidebar-text:#1a2036;--d-blue:#3b82f6;--d-violet:#8b5cf6;display:grid;grid-template-columns:220px minmax(0,1fr) 320px;min-height:100%;background:var(--d-bg);color:var(--d-text);font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.ruth-variant-d *{box-sizing:border-box}
.ruth-variant-d button{font:inherit;cursor:pointer}
.ruth-variant-d button:disabled{cursor:not-allowed;opacity:.85}
.ruth-variant-d button:focus-visible,.ruth-variant-d a:focus-visible{outline:2px solid var(--d-blue);outline-offset:2px}
.d-sidebar{background:var(--d-sidebar);color:var(--d-sidebar-text);padding:22px 16px;display:flex;flex-direction:column;gap:26px}
.d-brand{display:flex;align-items:center;gap:10px}
.d-orb-small{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#8fb4ff,#5b6ff0 45%,#7b3fe4 85%);box-shadow:0 0 16px rgba(99,102,241,.5);flex-shrink:0}
.d-brand strong{display:block;font-size:14px}
.d-brand span{display:block;font-size:10px;color:#6b7290;text-transform:uppercase;letter-spacing:.06em}
.d-nav{display:flex;flex-direction:column;gap:3px;flex:1}
.d-nav-item{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:10px;color:#4b5170;font-size:13px;text-decoration:none}
.d-nav-item:hover{background:#eceffa}
.d-nav-item.is-active{background:#e6ecff;color:#2a3ce0;font-weight:600}
.d-profile{display:flex;align-items:center;gap:10px;border-top:1px solid #e4e7f2;padding-top:16px}
.d-avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#6d8cff,#8b5cf6);flex-shrink:0}
.d-profile strong{display:block;font-size:13px}
.d-profile span{display:flex;align-items:center;gap:5px;font-size:11px;color:#6b7290}
.d-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.d-dot-active{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.7)}
.d-dot-error{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,.7)}
.d-main{padding:22px 26px 60px;min-width:0;overflow-y:auto}
.d-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.d-status-line{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--d-muted);text-transform:uppercase;letter-spacing:.05em}
.d-ghost-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;background:transparent;border:1px solid var(--d-card-border);color:var(--d-text);border-radius:10px;padding:8px 12px;font-size:12px}
.d-topbar-actions{display:flex;gap:8px;align-items:center}
.d-ghost-btn-icon{min-width:44px;padding:8px}
.d-hero{position:relative;background:radial-gradient(120% 160% at 18% 0%,#141c3c 0%,var(--d-bg2) 55%,var(--d-bg) 100%);border:1px solid var(--d-card-border);border-radius:22px;padding:40px 36px;margin-bottom:20px;overflow:hidden}
.d-orb-big{width:150px;height:150px;border-radius:50%;margin:0 auto 22px;background:radial-gradient(circle at 32% 28%,#a9c3ff,#5b6ff0 45%,#7b3fe4 85%);box-shadow:0 0 60px rgba(99,102,241,.55),0 0 140px rgba(139,92,246,.25)}
.d-hero h1{text-align:center;font-size:clamp(24px,3vw,34px);font-weight:600;line-height:1.25;margin:0 0 12px}
.d-hero>p{text-align:center;color:var(--d-muted);max-width:560px;margin:0 auto 22px;font-size:13.5px}
.d-hero-actions{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.d-chips{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
.d-chip{font-size:11px;color:var(--d-muted);border:1px solid var(--d-card-border);border-radius:999px;padding:6px 12px}
.d-btn-primary{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#3b82f6,#6d5bf0);color:#fff;border:0;border-radius:12px;padding:11px 18px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(59,90,246,.35)}
.d-btn-outline{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.03);color:var(--d-text);border:1px solid var(--d-card-border);border-radius:12px;padding:11px 18px;font-size:13px}
.d-btn-sm{padding:7px 12px;font-size:12px;border-radius:9px}
.d-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:26px}
.d-stat{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:16px;padding:16px}
.d-stat-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.d-stat-icon{display:inline-flex}
.d-stat-title{font-size:11px;letter-spacing:.07em;color:var(--d-muted);flex:1}
.d-pill{font-size:10px;font-weight:700;letter-spacing:.03em;border:1px solid;border-radius:999px;padding:3px 9px;text-transform:lowercase;white-space:nowrap}
.d-stat-value{display:block;font-size:19px;font-weight:700;margin-bottom:4px}
.d-stat-detail{margin:0;font-size:12px;color:var(--d-muted);line-height:1.4}
.d-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.d-section-head h2{font-size:12px;letter-spacing:.09em;color:var(--d-muted);margin:0}
.d-section-head h3{font-size:11px;letter-spacing:.08em;color:#5b6284;margin:0;text-transform:uppercase}
.d-section-head a{font-size:12px;color:#8fa6ff;text-decoration:none}
.d-projects{margin-bottom:24px}
.d-projects-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.d-project-card{background:var(--d-card);border:1px solid var(--d-card-border);border-left:3px solid #22c55e;border-radius:14px;padding:16px}
.d-project-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.d-project-head strong{font-size:14px}
.d-project-card p{margin:0;font-size:12px;color:var(--d-muted);line-height:1.45}
.d-telemetry{opacity:.75}
.d-telemetry-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.d-telemetry-row>div{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:12px;padding:12px}
.d-telemetry-row span{display:block;font-size:10px;color:var(--d-muted);margin-bottom:5px}
.d-telemetry-row strong{font-size:14px}
.d-commands{background:var(--d-bg2);border-left:1px solid var(--d-card-border);padding:22px 18px;overflow-y:auto}
.d-commands-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.d-commands-head h2{font-size:12px;letter-spacing:.08em;color:var(--d-muted);margin:0}
.d-commands-list{display:flex;flex-direction:column;gap:12px}
.d-command-card{background:var(--d-card);border:1px solid var(--d-card-border);border-left:3px solid;border-radius:14px;padding:14px}
.d-command-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px}
.d-command-head strong{font-size:13px;line-height:1.3}
.d-command-tag{display:block;font-size:10.5px;color:var(--d-muted);margin-bottom:8px}
.d-command-card>p{margin:0 0 12px;font-size:12px;color:#c3c9e6;line-height:1.4}
.d-command-actions{display:flex;gap:8px;flex-wrap:wrap}
.d-empty{color:var(--d-muted);font-size:12px}
@media(max-width:1200px){.ruth-variant-d{grid-template-columns:200px minmax(0,1fr) 280px}}
@media(max-width:980px){.ruth-variant-d{grid-template-columns:1fr}.d-sidebar{flex-direction:row;align-items:center;justify-content:space-between;padding:14px 16px}.d-nav{display:none}.d-commands{border-left:0;border-top:1px solid var(--d-card-border)}.d-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.d-hero{padding:28px 18px}.d-orb-big{width:100px;height:100px}.d-hero-actions{flex-direction:column;align-items:stretch}.d-stats{grid-template-columns:1fr}.d-projects-grid{grid-template-columns:1fr}.d-telemetry-row{grid-template-columns:1fr}}
`;

const RUTH_OS_VARIANT_E_STYLES = `
.ruth-variant-e{--d-bg:#0a0e1c;--d-bg2:#0d1226;--d-card:#111834;--d-card-border:#1f2947;--d-text:#eef1ff;--d-muted:#8891b8;--d-sidebar:#f5f7fb;--d-sidebar-text:#1a2036;--d-blue:#3b82f6;--d-violet:#8b5cf6;display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100%;background:var(--d-bg);color:var(--d-text);font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.ruth-variant-e *{box-sizing:border-box}
.ruth-variant-e button{font:inherit;cursor:pointer}
.ruth-variant-e button:disabled{cursor:not-allowed;opacity:.85}
.ruth-variant-e button:focus-visible,.ruth-variant-e a:focus-visible,.ruth-variant-e input:focus-visible{outline:2px solid var(--d-blue);outline-offset:2px}
.e-main{padding:26px clamp(20px,3vw,40px) 140px;min-width:0;overflow-y:auto;max-width:1180px;margin:0 auto;width:100%}
.e-hero{position:relative;display:flex;align-items:center;gap:26px;background:radial-gradient(120% 200% at 12% 0%,#141c3c 0%,var(--d-bg2) 55%,var(--d-bg) 100%);border:1px solid var(--d-card-border);border-radius:24px;padding:clamp(26px,4vw,42px);margin-bottom:20px}
.e-hero-orb{width:96px;height:96px;flex-shrink:0;border-radius:50%;background:radial-gradient(circle at 32% 28%,#a9c3ff,#5b6ff0 45%,#7b3fe4 85%);box-shadow:0 0 44px rgba(99,102,241,.5),0 0 110px rgba(139,92,246,.22)}
.e-eyebrow{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a9b6ff;margin-bottom:8px}
.e-hero-text h2{font-size:clamp(21px,2.4vw,28px);font-weight:600;line-height:1.25;margin:0 0 8px;max-width:640px}
.e-hero-text p{margin:0 0 16px;color:var(--d-muted);font-size:13.5px;max-width:600px}
.e-row-two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:22px}
.e-card{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:18px;padding:18px}
.e-card-head{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.04em;color:var(--d-muted);text-transform:uppercase;margin-bottom:12px}
.e-stack{display:grid;gap:10px}
.e-row{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;border-top:1px solid var(--d-card-border);padding-top:10px}
.e-row:first-child{border-top:0;padding-top:0}
.e-row-body strong{display:block;font-size:13px;margin-bottom:3px}
.e-row-body p{margin:0 0 8px;font-size:12px;color:var(--d-muted);line-height:1.4}
.e-row-actions{grid-column:2/-1;display:flex;gap:8px}
.e-projects{margin-bottom:22px}
.e-projects-strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(210px,1fr);gap:14px;overflow-x:auto;padding-bottom:6px}
.e-project-card{min-width:210px}
.e-secondary{opacity:.7}
.e-hermes-dock{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:grid;grid-template-columns:38px minmax(240px,480px) 44px;align-items:center;gap:10px;background:#111834;border:1px solid #2a3555;border-radius:18px;padding:8px 10px;box-shadow:0 20px 60px rgba(5,8,20,.55);z-index:50}
.e-hermes-orb{width:38px;height:38px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#a9c3ff,#5b6ff0 45%,#7b3fe4 85%);box-shadow:0 0 18px rgba(99,102,241,.5)}
.e-hermes-dock input{height:40px;border-radius:11px;border:1px solid #2a3555;background:#0a0e1c;color:#eef1ff;padding:0 12px;font-size:13px}
.e-hermes-dock button{width:40px;height:40px;border:0;border-radius:11px;background:linear-gradient(135deg,#3b82f6,#6d5bf0);color:#fff;display:grid;place-items:center}
@media(max-width:980px){.ruth-variant-e{grid-template-columns:1fr}.d-sidebar{flex-direction:row;align-items:center;justify-content:space-between;padding:14px 16px}.d-nav{display:none}.e-row-two{grid-template-columns:1fr}}
@media(max-width:600px){.e-hero{flex-direction:column;text-align:center;padding:26px 18px}.e-hero-orb{width:76px;height:76px}.e-row-actions{flex-direction:column}.e-hermes-dock{width:calc(100vw - 24px);grid-template-columns:34px 1fr 40px}.e-main{padding-bottom:170px}}
`;

const RUTH_OS_VARIANT_FG_STYLES = `
.ruth-variant-f,.ruth-variant-g{--d-bg:#0a0e1c;--d-bg2:#0d1226;--d-card:#111834;--d-card-border:#1f2947;--d-text:#eef1ff;--d-muted:#8891b8;--d-sidebar:#f5f7fb;--d-sidebar-text:#1a2036;--d-blue:#3b82f6;--d-violet:#8b5cf6;display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100%;background:var(--d-bg);color:var(--d-text);font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.ruth-variant-f *,.ruth-variant-g *{box-sizing:border-box}
.ruth-variant-f button,.ruth-variant-g button{font:inherit;cursor:pointer}
.ruth-variant-f button:disabled,.ruth-variant-g button:disabled{cursor:not-allowed;opacity:.9}
.ruth-variant-f button:focus-visible,.ruth-variant-g button:focus-visible,.ruth-variant-f a:focus-visible,.ruth-variant-g a:focus-visible,.ruth-variant-f input:focus-visible,.ruth-variant-g input:focus-visible{outline:2px solid var(--d-blue);outline-offset:2px}

.f-main{padding:40px clamp(20px,4vw,40px) 160px;min-width:0;overflow-y:auto;display:flex;justify-content:center}
.f-column{width:100%;max-width:560px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:18px;margin-top:clamp(20px,6vh,72px)}
.f-hermes-line{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#a9b6ff}
.f-title{margin:0;font-size:clamp(20px,2.4vw,26px);font-weight:600;color:var(--d-muted)}
.f-hero-card{width:100%;background:radial-gradient(120% 200% at 20% 0%,#1a2350,#141c3c 55%,var(--d-bg) 100%);border:1px solid var(--d-card-border);border-radius:22px;padding:clamp(28px,4vw,40px);display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:0 20px 60px rgba(5,8,20,.35)}
.f-hero-eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a9b6ff}
.f-hero-card h2{margin:0;font-size:clamp(20px,2.6vw,27px);font-weight:600;line-height:1.3;max-width:440px}
.f-hero-card p{margin:0 0 6px;color:var(--d-muted);font-size:13.5px;max-width:440px}
.f-pending-banner{width:100%;display:flex;align-items:center;gap:10px;background:var(--d-card);border:1px solid rgba(196,181,253,.35);border-radius:14px;padding:12px 16px;color:var(--d-text);font-size:13px;text-align:left}
.f-pending-banner span{flex:1}
.f-tiles{width:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:8px}
.f-tile{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:16px;padding:16px 14px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;color:var(--d-text)}
.f-tile-label{font-size:13px;font-weight:600}
.f-tile-teaser{font-size:11px;color:var(--d-muted);line-height:1.35}

.g-main{padding:30px clamp(20px,4vw,40px) 110px;min-width:0;overflow-y:auto;max-width:900px;margin:0 auto;width:100%}
.g-conversation{display:flex;align-items:flex-start;gap:20px;margin-bottom:26px}
.g-orb{width:64px;height:64px;flex-shrink:0;border-radius:50%;background:radial-gradient(circle at 32% 28%,#a9c3ff,#5b6ff0 45%,#7b3fe4 85%);box-shadow:0 0 34px rgba(99,102,241,.5)}
.g-bubble{flex:1;background:var(--d-card);border:1px solid var(--d-card-border);border-radius:20px;border-top-left-radius:6px;padding:22px 24px}
.g-bubble-lead{margin:0 0 6px;font-size:13px;color:var(--d-muted)}
.g-bubble-main{margin:0 0 8px;font-size:clamp(18px,2.2vw,23px);font-weight:600;line-height:1.35}
.g-bubble-detail{margin:0 0 14px;font-size:13px;color:var(--d-muted);line-height:1.5}
.g-bubble-note{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#c3c9e6;background:rgba(139,92,246,.08);border:1px solid rgba(196,181,253,.25);border-radius:11px;padding:9px 12px;margin:0 0 16px}
.g-bubble-cta{margin:2px 0 14px}
.g-agent-result{margin:10px 0 0;font-size:12px;color:var(--d-muted);text-align:left}
.g-agent-result strong{color:var(--d-text);font-weight:600}
.g-agent-result-fallback{color:#fbbf24}
.g-session-link{margin-top:4px;background:none;border:none;padding:0;color:#93c5fd;font-size:11px;text-decoration:underline;cursor:pointer}
.g-session-overlay{position:fixed;inset:0;background:rgba(5,8,20,.72);display:flex;align-items:center;justify-content:center;z-index:80;padding:24px}
.g-session-modal{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:16px;max-width:720px;width:100%;max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
.g-session-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--d-card-border)}
.g-session-modal-head h2{margin:0;font-size:15px;color:var(--d-text)}
.g-session-log-text{margin:0;padding:16px 18px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.6;color:var(--d-text)}
.g-mission-card{margin-top:14px;padding:14px 16px;border-radius:14px;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.25);text-align:left}
.g-mission-eyebrow{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#c4b5fd;margin-bottom:6px}
.g-mission-summary{margin:0 0 6px;font-size:13.5px;color:var(--d-text)}
.g-mission-context,.g-mission-agent{margin:0 0 4px;font-size:12px;color:var(--d-muted)}
.g-mission-context strong,.g-mission-agent strong{color:var(--d-text);font-weight:500}
.g-mission-preview{margin-top:10px;padding-top:10px;border-top:1px solid rgba(167,139,250,.2)}
.g-mission-preview-text{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.5;color:var(--d-text);font-family:inherit;margin:6px 0 4px;max-height:220px;overflow-y:auto}
.g-mission-preview-note{margin:0;font-size:11px;color:var(--d-muted)}
.g-mission-cta{margin-top:8px;padding:8px 14px;border-radius:10px;border:1px solid rgba(167,139,250,.4);background:rgba(167,139,250,.16);color:#c4b5fd;font-size:12.5px;cursor:pointer}
.g-mission-cta:hover{background:rgba(167,139,250,.26)}
.g-mission-cta:disabled{opacity:.6;cursor:not-allowed}
.g-last-execution-card{margin-top:10px;background:rgba(34,197,94,.07);border-color:rgba(34,197,94,.25)}
.g-mission-eyebrow-done{color:#4ade80}
.g-bubble-input{display:grid;grid-template-columns:1fr auto auto;gap:10px;margin-top:4px;padding-top:14px;border-top:1px solid var(--d-card-border)}
.g-bubble-input input{height:44px;border-radius:11px;border:1px solid var(--d-card-border);background:var(--d-bg);color:var(--d-text);padding:0 12px;font-size:13px}
.g-send-btn,.g-mic-btn{width:44px;height:44px;border:1px solid var(--d-card-border);border-radius:11px;background:transparent;color:var(--d-muted);display:grid;place-items:center}
.g-send-btn:not(:disabled){color:#fff;background:linear-gradient(135deg,#3b82f6,#6d5bf0);border-color:transparent}
.g-mic-btn:not(:disabled):hover{color:var(--d-text);border-color:#324066}
.g-mic-btn-recording{color:#fff;background:linear-gradient(135deg,#ef4444,#f97316);border-color:transparent;animation:g-mic-pulse 1.4s ease-in-out infinite}
.g-mic-btn-speaking{color:#fff;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border-color:transparent}
@keyframes g-mic-pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.35)}50%{box-shadow:0 0 0 6px rgba(239,68,68,0)}}
.g-mic-status{margin:8px 0 0;font-size:12px;color:var(--d-muted);text-align:right}
.g-mic-status-error{color:#f87171}
@keyframes d-spin{to{transform:rotate(360deg)}}
.d-spin{animation:d-spin .8s linear infinite}
.g-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.g-tile{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px;text-align:left;color:var(--d-text)}
.g-tile:not(:disabled){cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease}.g-tile:not(:disabled):hover{transform:translateY(-2px);border-color:#5965a6;background:#151d3e}.g-tile:not(:disabled):focus-visible{outline:2px solid var(--d-blue);outline-offset:3px}
.g-tile-top{display:flex;align-items:center;justify-content:space-between}
.g-tile strong{font-size:14px}
.g-tile span:last-child{font-size:11.5px;color:var(--d-muted);line-height:1.35}
.g-detail{max-width:880px;margin:0 auto;padding:18px 0 56px}.g-detail-heading{padding:22px 0 26px}.g-detail-heading>span,.g-pending-action>span{display:block;color:#aeb9e8;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}.g-detail-heading h1{font-size:clamp(30px,4vw,46px);line-height:1.05;margin:8px 0 10px}.g-detail-heading p{margin:0;color:var(--d-muted);font-size:14px;line-height:1.5;max-width:580px}.g-pending-list{display:grid;gap:12px}.g-pending-item{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:16px;padding:18px}.g-pending-item-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.g-pending-project{display:block;color:#aeb9e8;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:6px}.g-pending-item h2{font-size:17px;line-height:1.25;margin:0}.g-pending-item>p{margin:13px 0;color:var(--d-muted);font-size:13px;line-height:1.5}.g-pending-action{border-top:1px solid var(--d-card-border);padding-top:12px}.g-pending-action strong{display:block;margin-top:5px;font-size:13px;line-height:1.4}.g-empty-state{display:flex;gap:12px;align-items:flex-start;background:var(--d-card);border:1px solid var(--d-card-border);border-radius:16px;padding:20px;color:#86efac}.g-empty-state strong{display:block;color:var(--d-text);margin-bottom:4px}.g-empty-state p{margin:0;color:var(--d-muted);font-size:13px}
.g-system-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.g-system-card{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:16px;padding:16px}.g-system-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;color:var(--d-text)}.g-system-card-head strong{font-size:14px}.g-system-ok{color:#86efac;font-size:13px;margin:0 0 6px}.g-system-down{color:#fca5a5;font-size:13px;margin:0 0 6px}.g-system-warn{color:#fbbf24;font-size:13px;margin:0 0 6px}.g-system-note{color:var(--d-muted);font-size:12px;margin:0;line-height:1.5}
.g-pending-item-clickable{width:100%;text-align:left;cursor:pointer;font:inherit;transition:transform .16s ease,border-color .16s ease}.g-pending-item-clickable:hover{transform:translateY(-2px);border-color:#5965a6}.g-pending-item-clickable:focus-visible{outline:2px solid var(--d-blue);outline-offset:3px}.g-pending-item-more{display:inline-flex;align-items:center;gap:4px;margin-top:10px;font-size:12px;color:#aeb9e8}
.g-detail-subheading{margin:26px 0 12px;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#aeb9e8}
.g-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.g-stat{background:var(--d-card);border:1px solid var(--d-card-border);border-radius:14px;padding:14px}.g-stat span{display:block;font-size:11px;color:var(--d-muted);text-transform:uppercase;letter-spacing:.06em}.g-stat strong{display:block;margin-top:4px;font-size:19px;color:var(--d-text)}.g-stat em{display:block;margin-top:2px;font-size:11px;font-style:normal;color:var(--d-muted)}
.g-decision-list{display:grid;gap:10px}.g-decision-item{display:flex;gap:12px;align-items:baseline}.g-decision-item span{flex-shrink:0;font-size:11px;color:var(--d-muted);font-variant-numeric:tabular-nums}.g-decision-item strong{font-weight:500;font-size:13.5px;color:var(--d-text)}
.g-inline-code{background:rgba(148,163,184,.14);border:1px solid rgba(148,163,184,.22);border-radius:5px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;color:#c7d2fe}
.g-hermes-cta{display:inline-flex;align-items:center;gap:8px;margin-top:28px;padding:11px 18px;border-radius:12px;border:1px solid rgba(167,139,250,.35);background:rgba(167,139,250,.14);color:#c4b5fd;font-size:13px;cursor:pointer}.g-hermes-cta:hover{background:rgba(167,139,250,.22)}
.g-blocks-loading{color:var(--d-muted);font-size:13px;margin:0}
.g-block-list{display:grid;gap:8px}
.g-block-row{width:100%;text-align:left;font:inherit;cursor:pointer;color:var(--d-text);background:var(--d-card);border:1px solid var(--d-card-border);border-radius:12px;padding:11px 14px;display:flex;align-items:center;gap:12px;transition:border-color .15s ease,background .15s ease}
.g-block-row:hover{border-color:#3b4570;background:#131b3c}
.g-block-num{font-size:11px;color:#5c6693;width:20px;flex-shrink:0}
.g-block-name{font-size:13.5px;font-weight:500;flex:1;min-width:0}
.g-block-bar-wrap{width:90px;flex-shrink:0}
.g-block-bar-track{height:5px;border-radius:3px;background:#1c2547;overflow:hidden}
.g-block-bar-fill{display:block;height:100%;border-radius:3px}
.g-block-pct{font-size:11px;color:var(--d-muted);width:32px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}
.g-block-chev{color:#5c6693;flex-shrink:0}
@media(max-width:640px){.g-block-name{font-size:12.5px}.g-block-bar-wrap{width:56px}.g-block-row{flex-wrap:wrap}}

@media(max-width:980px){.ruth-variant-f,.ruth-variant-g{grid-template-columns:1fr}.d-sidebar{flex-direction:row;align-items:center;justify-content:space-between;padding:14px 16px}.d-nav{display:none}}
@media(max-width:640px){.f-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.g-tiles{grid-template-columns:1fr}.g-conversation{flex-direction:column;align-items:center;text-align:center}.g-bubble{border-top-left-radius:20px}.g-bubble-input{grid-template-columns:1fr}.g-detail{padding-top:6px}.g-detail-heading{padding:15px 0 21px}.g-pending-item{padding:16px}.g-pending-item-head{flex-direction:column;gap:10px}.g-pending-item-head>.d-pill{align-self:flex-start}}
`;
