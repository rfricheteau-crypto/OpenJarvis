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
  - **Tentative de correction 2026-08-29 (autonomie) — annulée** : essayé d'augmenter le `padding-bottom` de `.g-detail` en mobile. Vérifié par Playwright (avant/après capture identique) : ça ne change rien, car la vraie cause n'est pas "contenu inatteignable en bas de liste" mais `.ruth-switcher` en `position:fixed` qui reste dans une bande verticale fixe de l'écran (704-762px sur 844px) pendant tout le défilement — du padding en fin de liste ne déplace pas les cartes qui passent sous cette bande en cours de scroll. Modification annulée avant commit (vérifiée inefficace, donc pas gardée). Vrai correctif possible : rendre le sélecteur translucide/plus compact, ou le masquer hors contexte de comparaison — décision de design, pas un simple correctif CSS. Pas bloquant (outil de dev), laissé tel quel.

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

**CE QUI EXISTE** :
- « En attente » (Codex) : liste des décisions non terminées avec projet, contexte, priorité et action attendue.
- « Alertes » (Claude, 2026-08-29, autonomie) : même pattern (`?view=alertes`), vraie donnée (`snapshot.alerts`), testé réellement (clic, URL, contenu, 0 erreur console, pas de scroll horizontal mobile 390×844). Commit `17bf214`.

Les deux tuiles lisent le snapshot existant ; aucune nouvelle source ni action créée. `tsc --noEmit` propre.

**CE QUI EXISTE (suite)** : « Projets » (Claude, 2026-08-29) ajoutée avec le
même pattern (`?view=projets`), badge "décision requise" calculé en croisant
avec `pending_validations`. Techniquement propre (`tsc` OK, testé réellement,
0 erreur, pas de scroll horizontal). Commit `11e3892`.

**PROBLÈME DE FOND — CORRIGÉ (2026-08-29, autonomie, cf. Bloc 03 ci-dessous)** :
`model.projects` venait de `snapshot.continuity` (journal de continuité
interne de Hermès, pas les vrais projets business). En construisant le Bloc
03, trouvaille : `frontend/src/pages/ProjectDetailPage.tsx` (2026-05-19,
jamais relié à aucune UI) contenait déjà un **vrai registre de 6 projets
nommés** (ADV, Jarvis/Hermès, ABG, Obsidian, Graphify, Valéna) avec taglines
et décisions réelles datées. Registre extrait vers
`frontend/src/lib/projectsRegistry.ts` (source unique, réutilisée par
l'ancienne page ET par G) ; `model.projects` dérive maintenant de ce registre
au lieu de `snapshot.continuity`. Effet de bord positif : le croisement avec
`pending_validations` (badge "décision requise") fonctionne enfin vraiment,
puisque les titres de projets correspondent désormais aux vrais noms utilisés
par les décisions Hermès (ex. "ADV" au lieu de "Hermès — Dernière clôture de
session").

**CE QUI MANQUE** : une vraie source "liste de projets business" (probablement
à construire depuis `CORE/project-state/` que Codex développe côté
CODEX_RUTH_OS, ou depuis `AGENT_HANDOFF.md`) ; page Personnel (aucune source
du tout) ; contrôle navigateur mobile final sur le vrai téléphone de Ruth
(bloqué par le réseau, voir `A_VALIDER_PAR_RUTH.md`).

**INVESTIGATION `CORE/project-state/` (2026-08-29, autonomie)** : vérifié côté
CODEX_RUTH_OS — le contrat existe (`project-state.snapshot.schema.json`,
`README.md`, un seul exemple statique `examples/pedro-os.snapshot.json`).
Conçu comme format de snapshot en lecture seule, dérivé de sources canoniques
par projet, pas une base de données — exactement le type de donnée qu'il
faudrait pour "Projets". **Mais pas encore consommable** : un seul exemple
(Pedro), pas de deuxième projet, et aucune route HTTP exposée côté backend
`personal_cockpit.py` pour que le frontend OpenJarvis puisse le lire — le
README situe la migration à l'étape 1 ("Pedro OS pilote le format"), l'étape 2
("RuthOS consomme le snapshot en lecture seule") n'est pas commencée. Fichiers
non commités côté CODEX_RUTH_OS (travail actif de Codex).
**Décision** : ne pas bricoler de contournement frontend maintenant (donnée
inventée = contraire à la règle "aucune donnée inventée" déjà énoncée dans ce
README lui-même). "Projets" reste documenté comme bug connu, pas corrigé, en
attente que Codex expose project-state via une API ou que Ruth tranche sur une
source intermédiaire.

**QA SWEEP COMPLET (2026-08-29, Playwright, autonomie)** : les 4 vues (`home`,
`?view=attente`, `?view=alertes`, `?view=projets`) testées à desktop
(1280×900) et mobile (390×844) — 8/8 combinaisons : 0 erreur console, 0 crash,
0 scroll horizontal. Captures d'écran prises pour chacune. Note méthodo : le
premier essai comparait `body.innerText.slice(0,60)` entre vues pour vérifier
qu'elles diffèrent réellement — résultat identique sur les 8 (ça capturait le
header/sidebar, pas le contenu) donc **pas une preuve valable en soi** ;
vérifié à la place par lecture visuelle réelle des captures (`qa-projets-mobile.png`,
`qa-alertes-mobile.png`, `qa-attente-desktop.png`) — les 3 pages affichent
bien un contenu distinct et correct (Alertes montre "Hermes risk guard :
critical" / warning, En attente montre les vraies décisions ADV avec
priorités, Projets montre les entrées de continuité Hermès — confirmant
visuellement le bug déjà documenté ci-dessus).

**POINT MINEUR — RÉSOLU DE LUI-MÊME** : la carte "Hermes — Dernière clôture de
session" qui affichait en clair un extrait de log interne (tentative
d'exfiltration bloquée, sans gravité réelle mais visuellement alarmante) a
disparu avec le changement de source de données du Bloc 03 — les entrées de
continuité Hermès n'apparaissent plus comme des "projets".

**RUTH_DECISION_REQUIRED** : aucune posée pour l'instant.

**PROCHAINE ACTION** : ne pas construire Personnel tant qu'aucune source n'existe.
Pour Projets, attendre que Codex expose `CORE/project-state/` via une route
consommable (pas encore le cas au 2026-08-29) — ne pas bricoler de
contournement côté frontend entre-temps.

---

## BLOCK 03 — Niveau 3 (détail projet)

**OBJECTIF** : écran de détail par projet — risques, coûts, contexte technique, Lancer/Déléguer/Reporter réels.

**STATUT GLOBAL** : `READY_FOR_TEST` — construit et testé par Playwright ce soir (2026-08-29, sur demande directe de Ruth), pas encore testé en direct par elle.

**DÉCOUVERTE DE DÉPART** : `frontend/src/pages/ProjectDetailPage.tsx` (1265
lignes, écrit le 2026-05-19, jamais relié à aucune UI) existait déjà et
fonctionnait (vérifié en direct : 6 routes `/jarvis-personal/project/:id`,
vraies données ADV/Jarvis, 0 erreur). Mais son layout (8 onglets denses,
grille de KPI, todo-list) contredit le principe de simplicité que Ruth a
figé ce soir même (`CORE/RUTH_OS_VISION.md` Principe 1 — jamais un dashboard
Jira/Notion-style). Décision prise en autonomie, signalée à Ruth avant de
coder : garder les vraies données (registre de projets, décisions datées,
appels API existants), construire un nouvel écran dans le style G plutôt que
réutiliser la page dense telle quelle.

**CE QUI A ÉTÉ FAIT** :
- `frontend/src/lib/projectsRegistry.ts` créé — registre des 6 vrais projets
  (ADV, Jarvis/Hermès, ABG, Obsidian, Graphify, Valéna) extrait de
  `ProjectDetailPage.tsx`, devenu la source unique partagée (refactor pur,
  vérifié identique avant/après). Commit `ca07094`.
- `model.projects` dans `RuthOSPrototype.tsx` dérive maintenant de ce
  registre au lieu de `snapshot.continuity` — corrige aussi le bug de fond du
  Bloc 02 (voir plus haut).
- Nouveau composant `ProjectDetail` (style G, sombre, `.g-detail`) : titre +
  tagline, jusqu'à 3-4 KPI courts (live pour ADV via `fetchAdvSnapshot`,
  alertes réelles pour Jarvis via le snapshot déjà chargé, statiques et
  honnêtes pour les 4 autres), décisions clés datées, bouton "Demander à
  Hermès". Pas de Lancer/Déléguer/Reporter : aucune route backend réelle pour
  ces actions n'existe — ne pas fabriquer de boutons qui ne font rien.
- Cartes de la liste "Projets" rendues cliquables (`→ Voir le détail`),
  navigation par URL (`?view=projets&project=<id>`), bouton retour, touche
  Échap (retourne à la liste si un projet est ouvert, sinon ferme le détail).
- **Bug trouvé en testant** : le nouvel écran, comme `/jarvis-personal/project/:id`
  directement, était bloqué par la même modale d'opt-in que j'avais déjà
  corrigée ce soir sur `/jarvis-personal` — cause racine commune identifiée
  (`isPersonalCockpit` en égalité stricte au lieu de préfixe). Corrigé une
  fois pour toutes dans `App.tsx` (`startsWith` au lieu de `===`), ferme
  cette classe de bug pour toute future route sous `/jarvis-personal/*`.

**TESTS RÉELS (Playwright, 2026-08-29)** : `tsc --noEmit` propre. Liste
Projets → 6 cartes réelles, clic → navigation → détail ADV avec vrais
chiffres (MRR 0€, 19 abonnements, churn 0%) et vraies décisions datées ;
détail Jarvis → alertes réelles ; détail Valéna (projet sans données live) →
rendu propre ; bouton retour → liste ; ancienne route standalone
`/jarvis-personal/project/adv` → modale ne bloque plus ; mobile 390×844 → 0
scroll horizontal ; 0 erreur console sur l'ensemble. Captures dans le
scratchpad de session.

**CE QUI MANQUE** : test réel par Ruth (obligatoire avant `TESTED`) ; actions
Lancer/Déléguer/Reporter (pas de backend réel, volontairement pas
fabriquées) ; KPI live pour les projets non-ADV (Jarvis a des alertes
réelles mais pas de vrais KPI chiffrés, les autres n'ont que des faits
statiques).

**RUTH_DECISION_REQUIRED** : aucune posée pour l'instant — le choix de ne pas
réutiliser `ProjectDetailPage.tsx` dense a été signalé à Ruth en direct avant
de coder, pas juste décidé seul.

**PROCHAINE ACTION** : Ruth teste en conditions réelles → passage à `TESTED`.

---

## BLOCK 04 — Reste d'OpenJarvis (non cartographié)

**STATUT** : non applicable — périmètre volontairement exclu de ce fichier pour l'instant (`hermes_core/`, backend `personal_cockpit.py`, pages `Settings`/`Logs`/`Agents`/`DataSources`/`Chat`, `routing/*.toml`). À cartographier séparément si Ruth le demande — ne pas improviser une couverture large juste pour "faire complet".

**Note technique voix 2026-08-29** : diagnostic isolé réalisé sans élargir le
bloc Cockpit. Backend, Kokoro, STT et POC Pipecat V2 démarrent. Le raccordement
barge-in manquant dans le POC a été corrigé et compile ; le test micro WebRTC
réel reste requis. Détail : `CODEX_RUTH_OS/CORE/HANDOFFS/2026-08-29_CODEX_voice-runtime-barge-in.md`.
