// Registre des vrais projets de Ruth — source unique partagée entre
// ProjectDetailPage.tsx (écran classique) et RuthOSPrototype.tsx (variante G).
// Extrait de ProjectDetailPage.tsx (écrit 2026-05-19) le 2026-08-29 pour
// remplacer la liste "Projets" de G, qui affichait par erreur le journal de
// continuité interne de Hermès au lieu de ces vrais projets nommés.

export interface ProjectKpi {
  label: string;
  value: string;
  note?: string;
}

export interface ProjectDecision {
  text: string;
  date: string;
}

export interface ProjectData {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  kpis: ProjectKpi[];
  decisions: ProjectDecision[];
  obsidianPath?: string;
  graphifyPath?: string;
}

export const PROJECTS: Record<string, ProjectData> = {
  edupilot: {
    id: 'edupilot',
    name: 'EduPilot',
    tagline: "SaaS éducatif premium",
    accent: '#a78bfa',
    kpis: [],
    decisions: [
      { text: "B4-01 (Atelier des Nombres) validé par Ruth, conditionnellement", date: "2026-08-28" },
    ],
  },
  pedro: {
    id: 'pedro',
    name: 'Pedro',
    tagline: "Débarras, brocante et valorisation de patrimoine mobilier",
    accent: '#fb923c',
    kpis: [],
    decisions: [],
  },
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
  obsidian: {
    id: 'obsidian',
    name: 'Obsidian / Vault',
    tagline: "Mémoire vivante de Ruth OS — notes, projets, décisions",
    accent: 'var(--color-accent-purple)',
    kpis: [
      { label: "Rôle", value: "Source de vérité" },
      { label: "Vault", value: "Organisation Ruth" },
      { label: "Accès MCP", value: "QMD actif" },
    ],
    decisions: [
      { text: "Obsidian reste la mémoire source, cockpit = interface", date: "2026-05-12" },
      { text: "Claude écrit uniquement dans CODEX_RUTH_OS et JARVIS", date: "2026-05-12" },
    ],
    obsidianPath: "JARVIS",
  },
  graphify: {
    id: 'graphify',
    name: 'Graphify',
    tagline: "Cartographie des dépendances et connaissances",
    accent: 'var(--color-accent)',
    kpis: [
      { label: "Statut", value: "Actif", note: "HTML natif" },
      { label: "Vault scanné", value: "Organisation Ruth" },
    ],
    decisions: [
      { text: "Graphify utilisé avant toute refacto ou changement d'architecture", date: "2026-04-16" },
    ],
    graphifyPath: "/graphify/jarvis",
  },
  valena: {
    id: 'valena',
    name: 'Valéna',
    tagline: "Assistante vocale IA personnelle — en conception",
    accent: '#F87171',
    kpis: [
      { label: "Phase", value: "Conception" },
      { label: "Priorité", value: "Post-ADV V1" },
    ],
    decisions: [],
  },
};
