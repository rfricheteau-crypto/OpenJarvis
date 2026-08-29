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
| 02 — Niveau 2 (Projets / Personnel / Alertes / En attente) | `NOT_STARTED` |
| 03 — Niveau 3 (détail projet, risques, Lancer/Déléguer/Reporter) | `NOT_STARTED` |
| 04 — Reste d'OpenJarvis (hermes_core, pages existantes) | non cartographié — hors périmètre de ce fichier pour l'instant |

---

## BLOCK 01 — Cockpit Ruth OS 360° (Home, niveau 1)

**OBJECTIF** : un seul écran d'accueil simple, palette bleu nuit/violet,
Hermès en interface conversationnelle, qui filtre l'information avant de la
montrer à Ruth (progressive disclosure).

**STATUT GLOBAL** : `NEEDS_REVIEW`

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
- [ ] **Testé en direct par Ruth avec les vraies actions** (chat, approbation) — jamais fait, seule la version visuelle non câblée a été vue
- [ ] Câblage micro/voix (le champ reste texte seul, `useSpeech`/vocal de l'ancien écran non repris)

**DÉPENDANCES** : aucune côté code. Dépend de la disponibilité réelle du backend `personal_cockpit.py` (port 8000) pour que le chat/l'approbation fonctionnent hors environnement de dev.

**CE QUI EXISTE** : voir tâches cochées ci-dessus. `tsc --noEmit` propre à chaque étape. Routes `/jarvis-personal` (défaut, variante G) et `/jarvis-personal?classic=1` (ancien écran) vérifiées répondre 200.

**CE QUI MANQUE** : test réel par Ruth du câblage ; vocal ; les 4 tuiles ne mènent nulle part (Bloc 02) ; tuile "Personnel" sans vraie source de données (seul `obsidian_action_inbox_count` en proxy partiel).

**BUGS CONNUS** : aucun détecté à ce stade — pas de test end-to-end automatisé écrit non plus (uniquement `tsc` + vérification manuelle des routes en HTTP).

**TESTS** : `tsc --noEmit` propre (0 erreur) à chaque incrément. Aucun test automatisé (unitaire/E2E) écrit pour ce bloc — gap.

**CRITÈRES DE FIN** : Ruth teste le chat et l'approbation en conditions réelles et confirme que ça fonctionne comme attendu → passage à `TESTED`, puis `DONE` si aucune correction demandée.

**DERNIÈRE REVUE CLAUDE** : 2026-08-29, construit et vérifié par compilation + routes HTTP, jamais testé en usage réel. Ruth a reconfirmé G ("OK pour G") après verrouillage de `RUTH_OS_VISION.md`/`PROJECT_A_TO_Z.md` — reconfirme la direction, ne remplace pas le test réel du câblage (case toujours non cochée ci-dessus).
**DERNIÈRE REVUE CODEX** : Codex a construit en parallèle le routage propre (`App.tsx` → `RuthOSPrototypeRoute`, lazy-loaded, fetch du snapshot) — non consigné ici avant maintenant, à confirmer avec Codex à sa prochaine session.

**RUTH_DECISION_REQUIRED** : aucune nouvelle — palette, structure et variante déjà tranchées.

**PROCHAINE ACTION** : Ruth teste le chat réel et l'approbation de validation sur `/jarvis-personal` en conditions réelles.

---

## BLOCK 02 — Niveau 2 (Projets / Personnel / Alertes / En attente)

**OBJECTIF** : les 4 tuiles du Home mènent vers une vraie liste (format court, un item = une ligne), pas nulle part.

**STATUT GLOBAL** : `NOT_STARTED`

**CE QUI EXISTE** : rien — les tuiles sont désactivées avec un titre honnête ("Pas encore de page de détail").

**CE QUI MANQUE** : les 4 pages/vues elles-mêmes, la navigation depuis les tuiles, une vraie source de données pour "Personnel".

**RUTH_DECISION_REQUIRED** : aucune posée pour l'instant — dépend de si/quand Ruth veut avancer ce bloc.

**PROCHAINE ACTION** : proposer une structure (comme fait pour le Bloc 01) avant de coder, si Ruth donne le feu vert.

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
