// Design system partagé "Ruth OS 360°" — palette D validée par Ruth (2026-08-29).
// Objectif : un seul jeu de couleurs de statut et de primitives réutilisables,
// pour que chaque futur écran de ce cockpit (Projets, Personnel, Alertes, En
// attente, détail projet...) n'invente pas son propre style. Ne pas copier ces
// valeurs ailleurs — importer depuis ce fichier.

export const STATUS_COLORS = {
  active: { bg: 'rgba(34,197,94,.14)', fg: '#4ade80', border: 'rgba(34,197,94,.35)' },
  info: { bg: 'rgba(59,130,246,.14)', fg: '#60a5fa', border: 'rgba(59,130,246,.35)' },
  validation: { bg: 'rgba(167,139,250,.16)', fg: '#c4b5fd', border: 'rgba(167,139,250,.4)' },
  attention: { bg: 'rgba(251,146,60,.16)', fg: '#fb923c', border: 'rgba(251,146,60,.4)' },
  urgent: { bg: 'rgba(248,113,113,.16)', fg: '#f87171', border: 'rgba(248,113,113,.4)' },
  paused: { bg: 'rgba(148,163,184,.14)', fg: '#94a3b8', border: 'rgba(148,163,184,.32)' },
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

export function priorityToStatus(priority: string): StatusKey {
  const value = priority.toLowerCase();
  if (value === 'urgent' || value === 'critical') return 'urgent';
  if (value === 'high') return 'attention';
  return 'info';
}

// Variables CSS communes à tout écran "Ruth OS 360°" (fond bleu nuit, cartes,
// bordures). À poser sur le conteneur racine de l'écran :
// <div className="ruthos-theme"> ... </div>
export const RUTHOS_THEME_CSS = `
.ruthos-theme{--d-bg:#0a0e1c;--d-bg2:#0d1226;--d-card:#111834;--d-card-border:#1f2947;--d-text:#eef1ff;--d-muted:#8891b8;--d-sidebar:#f5f7fb;--d-sidebar-text:#1a2036;--d-blue:#3b82f6;--d-violet:#8b5cf6;background:var(--d-bg);color:var(--d-text);font-family:Inter,ui-sans-serif,system-ui,sans-serif}
`;
