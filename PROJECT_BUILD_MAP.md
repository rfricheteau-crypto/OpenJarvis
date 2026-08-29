# PROJECT_BUILD_MAP.md — OpenJarvis / Ruth OS 360°

Source de vérité du **pilotage de construction**, méthode
`CODEX_RUTH_OS/METHODE_PILOTAGE_PAR_BLOCS.md`. Ne remplace ni le code, ni les
handoffs (`docs/bridges/`), ni `AGENTS.md`/`docs/ai-governance.md` (autorité
gouvernance de ce projet).

**Créé le 2026-08-29**, après plusieurs heures de travail réel sans suivi par
blocs (constat de Ruth : "as-tu fait les blocs de travail" → non, jusqu'à
maintenant). Ce fichier ne couvre **que** le chantier Ruth OS 360° / Cockpit —
pas l'intégralité d'OpenJarvis (`hermes_core`, backend `personal_cockpit.py`
3115 lignes, pages existantes Settings/Logs/Agents/DataSources). Le reste du
projet n'est pas encore cartographié par blocs — gap assumé, pas caché.

**Statuts utilisés** : `NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` ·
`READY_FOR_TEST` · `TESTED` · `NEEDS_REVIEW` · `CODEX_REVIEW_PENDING` ·
`RUTH_DECISION_REQUIRED` · `DONE`

---

## Vue d'ensemble

| Bloc | Statut global |
|---|---|
| 01 — Cockpit Ruth OS 360° (Home, niveau 1) | `NEEDS_REVIEW` (câblage réel fait ce soir, jamais testé en direct par Ruth) |
| 02 — Niveau 2 (Projets / Personnel / Alertes / En attente) | `IN_PROGRESS` |
| 03 — Niveau 3 (détail projet, risques, Lancer/Déléguer/Reporter) | `NOT_STARTED` |
| 04 — Reste d'OpenJarvis (hermes_core, pages existantes) | non cartographié — hors périmètre de ce fichier pour l'instant |

---

## BLOCK 01 — Cockpit Ruth OS 360° (Home, niveau 1)

**OBJECTIF** : un seul écran d'accueil simple, palette bleu nuit/violet,
Hermès en interface conversationnelle, qui filtre l'information avant de la
montrer à Ruth (progressive disclosure).

**STATUT GLOBAL** : `TESTED` (texte/chat/approbation) — voix non intégrée, voir tâche ci-dessous

**TÂCHES**
- [x] Exploration visuelle (variantes A → G, `frontend/src/prototypes/ruthos/RuthOSPrototype.tsx`)
- [x] Palette D validée par Ruth
- [x] Structure simplifiée (une priorité, 4 tuiles, rien de technique par défaut) validée par Ruth
- [x] Variante G ("Conversation Hermès") choisie par Ruth comme direction finale
- [x] Chat réel câblé (`sendPersonalCockpitChat`)
- [x] Approbation de validation réelle câblée (`submitHermesValidation`), seulement si une validation est réellement active
- [x] Bouton Actualiser réel (`fetchPersonalCockpit` via `onRefresh`)
- [x] Design system extrait (`prototypes/ruthos/designSystem.ts`) — `STATUS_COLORS`, `priorityToStatus`
- [x] G promue écran par défaut de `/jarvis-personal` (échappatoire `?classic=1` conservée, rien supprimé)
- [x] **Testé en direct par Ruth avec les vraies actions** (2026-08-29, ~2h après le câblage) — chat réel, bouton d'approbation, Actualiser, tuile "En attente" : Ruth confirme *"ça marche tout est ok"*, aucune correction demandée
- [ ] Câblage micro/voix (le champ reste texte seul) — **volontairement pas intégré maintenant** : audit du 2026-08-29 (`CORE/AUDITS/2026-08-29_voice_conversation_audit.md`) a trouvé un vocal fonctionnel mais pas encore agréable ("un peu lent et perdu par moment", verdict Ruth réel) — 3 corrections nécessaires avant d'intégrer (garde anti-écho silencieuse, erreurs STT sur noms propres, latence ~2-4s). Ne pas câbler tant que ces 3 points ne sont pas traités.

**DÉPENDANCES** : aucune côté code. Dépend de la disponibilité réelle du backend `personal_cockpit.py` (port 8000) pour que le chat/l'approbation fonctionnent hors environnement de dev.

**CE QUI EXISTE** : voir tâches cochées ci-dessus. `tsc --noEmit` propre à chaque étape. Routes `/jarvis-personal` (défaut, variante G) et `/jarvis-personal?classic=1` (ancien écran) vérifiées répondre 200.

**CE QUI MANQUE** : vocal (voir tâche ci-dessus, 3 corrections avant intégration) ; tuile "Personnel" sans vraie source de données (seul `obsidian_action_inbox_count` en proxy partiel). Les tuiles Projets/Personnel/Alertes ne mènent pas encore vers une page complète (Bloc 02, "En attente" a une première tranche).

**BUGS CONNUS** :
- Corrigé (2026-08-29) : la modale d'opt-in "Share Your Savings" bloquait tout l'écran sur `/jarvis-personal` — sa condition de saut vérifiait encore l'ancien `?prototype=ruthos`, plus utilisé depuis que G est le défaut. Trouvé et corrigé via test Playwright viewport 390×844 (`frontend/src/App.tsx`, commit `0fc4c3b`).
- Ouvert, mineur : le sélecteur de variante (A→G, outil de dev pour comparer, pas destiné à la production) chevauche/masque du contenu réel sur mobile étroit (390px) — visible derrière la pastille flottante en bas.

Test mobile réel (Playwright, viewport iPhone 390×844, 2026-08-29) : aucun scroll horizontal, sidebar réduite en barre compacte, bulle Hermès/input/boutons bien dimensionnés. Test sur le vrai téléphone de Ruth toujours bloqué par le réseau (voir `A_VALIDER_PAR_RUTH.md`), Playwright utilisé comme substitut fiable en attendant.

**TESTS** : `tsc --noEmit` propre (0 erreur) à chaque incrément. Aucun test automatisé (unitaire/E2E) écrit pour ce bloc — gap.

**CRITÈRES DE FIN** : Ruth teste le chat et l'approbation en conditions réelles et confirme que ça fonctionne comme attendu → passage à `TESTED` (fait, 2026-08-29). `DONE` global du bloc reste en attente de la tâche vocale (volontairement différée, pas oubliée).

**DERNIÈRE REVUE CLAUDE** : 2026-08-29, testé en direct par Ruth (chat, approbation, Actualiser, tuile En attente) — confirmé fonctionnel, aucune correction demandée.
**DERNIÈRE REVUE CODEX** : Codex a construit en parallèle le routage propre (`App.tsx` → `RuthOSPrototypeRoute`, lazy-loaded, fetch du snapshot) et la première tranche de la tuile "En attente" (Bloc 02) — non consigné ici avant maintenant, à confirmer avec Codex à sa prochaine session.

**RUTH_DECISION_REQUIRED** : aucune — palette, structure, variante et câblage texte tous validés en conditions réelles par Ruth.

**PROCHAINE ACTION** : corriger les 3 points vocaux identifiés (garde anti-écho silencieuse, erreurs STT noms propres, latence) avant tout câblage micro dans G — travail autonome possible sans Ruth, retest par Ruth obligatoire avant intégration finale.

---

## BLOCK 02 — Niveau 2 (Projets / Personnel / Alertes / En attente)

**OBJECTIF** : les 4 tuiles du Home mènent vers une vraie liste (format court, un item = une ligne), pas nulle part.

**STATUT GLOBAL** : `IN_PROGRESS`

**CE QUI EXISTE** : première tranche locale « En attente » reliée au snapshot
Hermès : clic depuis G, liste des décisions non terminées avec projet, contexte,
priorité et action attendue, puis retour vers Hermès. Les données sont lues du
snapshot existant ; aucune nouvelle source ni action n'est créée. Build TypeScript
et build Vite réussis après ce changement.

**CE QUI MANQUE** : contrôle navigateur mobile final de « En attente » ; pages
Projets, Personnel et Alertes ; une vraie source de données pour « Personnel ».
Les trois tuiles restantes demeurent volontairement inactives.

**RUTH_DECISION_REQUIRED** : aucune posée pour l'instant — dépend de si/quand Ruth veut avancer ce bloc.

**PROCHAINE ACTION** : terminer le contrôle mobile de « En attente », puis
préparer la liste Projets à partir du contrat Project State, sans afficher de
détails techniques au niveau 2.

---

## BLOCK 03 — Niveau 3 (détail projet)

**OBJECTIF** : écran de détail par projet — risques, coûts, contexte technique, Lancer/Déléguer/Reporter réels.

**STATUT GLOBAL** : `NOT_STARTED`

**CE QUI EXISTE** : le contenu de la fusion C+D (variante E) préfigure ce que cet écran pourrait contenir, mais rien n'est scopé à un seul projet ni construit comme page dédiée.

**RUTH_DECISION_REQUIRED** : aucune posée.

**PROCHAINE ACTION** : après le Bloc 02, pas avant.

---

## BLOCK 04 — Reste d'OpenJarvis (non cartographié)

**STATUT** : non applicable — périmètre volontairement exclu de ce fichier pour l'instant (`hermes_core/`, backend `personal_cockpit.py`, pages `Settings`/`Logs`/`Agents`/`DataSources`/`Chat`, `routing/*.toml`). À cartographier séparément si Ruth le demande — ne pas improviser une couverture large juste pour "faire complet".

**Note technique voix 2026-08-29** : diagnostic isolé réalisé sans élargir le
bloc Cockpit. Backend, Kokoro, STT et POC Pipecat V2 démarrent. Le raccordement
barge-in manquant dans le POC a été corrigé et compile ; le test micro WebRTC
réel reste requis. Détail : `CODEX_RUTH_OS/CORE/HANDOFFS/2026-08-29_CODEX_voice-runtime-barge-in.md`.
