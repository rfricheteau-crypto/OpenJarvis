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
- [x] Câblage micro/voix (2026-08-30, extraction `useHermesSpeaker` + bouton micro G) — testé Playwright réel (cycle idle→recording→idle, 44px, aucune régression texte). Test humain réel (vraie voix, transcription, écoute Kokoro) toujours requis avant validation finale, non fait — voir Bloc 04.
- [x] Rafraîchissement automatique sans clic + panne backend signalée clairement (2026-08-31, demande Ruth explicite) — polling 45s tant que la page reste ouverte, bannière rouge si la synchronisation échoue au lieu de laisser une vieille donnée affichée comme actuelle. Testé réellement : panne backend simulée (route bloquée), bannière `"Connexion à Hermès indisponible — dernière donnée connue à HH:MM"` confirmée à l'écran.
- [x] Carte "Mission proposée" ne reste plus affichée indéfiniment après une tentative ancienne (2026-08-31, trouvaille Codex) — expire après 6h sans action, `generated_at` renvoyé par l'API.

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

**DERNIÈRE REVUE CLAUDE** : 2026-08-31 — micro G câblé, rafraîchissement auto + bannière panne ajoutés et testés réellement (Playwright, panne simulée). Codex indisponible (quota) au moment de la demande de Ruth — travail repris seul, aucune coordination possible sur ce point précis.
**REVUE CLAUDE PRÉCÉDENTE** : 2026-08-29, testé en direct par Ruth (chat, approbation, Actualiser, tuile En attente) — confirmé fonctionnel, aucune correction demandée.
**DERNIÈRE REVUE CODEX** : Codex a construit en parallèle le routage propre (`App.tsx` → `RuthOSPrototypeRoute`, lazy-loaded, fetch du snapshot) et la première tranche de la tuile "En attente" (Bloc 02) — non consigné ici avant maintenant, à confirmer avec Codex à sa prochaine session.

**RUTH_DECISION_REQUIRED** : aucune — palette, structure, variante et câblage texte tous validés en conditions réelles par Ruth.

**PROCHAINE ACTION** : test humain réel du micro (vraie voix, transcription, écoute Kokoro) avec Ruth sur navigateur — c'est le seul point encore ouvert de ce bloc.

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

**MISE À JOUR CODEX (2026-08-31)** : `GET /v1/personal-cockpit/project-state`
expose maintenant les snapshots explicitement publiés sous
`CODEX_RUTH_OS/CORE/project-state/snapshots/`, en lecture seule. La projection
retire les chemins locaux et la provenance interne ; un fichier invalide ou
incomplet est ignoré avec un avertissement, jamais interprété. Test API ciblé
vert. Il n'y a pour l'instant qu'un snapshot Pedro publié : l'UI ne doit donc
pas prétendre couvrir les autres projets avant leur propre publication.

**PROCHAINE ACTION** : ne pas construire Personnel tant qu'aucune source n'existe.
Claude peut désormais consommer Project State dans « Projets » lorsque son
chantier UI vocal/mission prioritaire est terminé — sans contournement ni
donnée inventée.

---

## BLOCK 03 — Niveau 3 (détail projet)

**OBJECTIF** : écran de détail par projet — risques, coûts, contexte technique, Lancer/Déléguer/Reporter réels.

**STATUT GLOBAL** : `TESTED` — construit et testé par Playwright le 2026-08-29, **testé en direct par Ruth le 2026-08-30** (Projets → Pedro/ADV → clic sur un bloc → détail) : **"NON TOUT EST OK"**, aucune correction demandée. **Confirmé une seconde fois le 2026-08-30** après ajout d'EduPilot, Caisse Alliance de Dreux et Ma Buvette Mobile au registre + leurs `PROJECT_BUILD_MAP.md` audités et branchés — Ruth : **"TOUT EST OK"**.

**AJOUT — Blocs A→Z réels (2026-08-29)** : Ruth a demandé la visibilité des
blocs de construction A→Z à l'intérieur de chaque projet (pas une nouvelle
idée — déjà anticipé dans `CORE/PROJECT_A_TO_Z.md` §"Mise en œuvre
progressive"). Maquette visuelle proposée (2 options), Ruth a choisi Option B
(écran plein écran par bloc), conversion statut→% simple, garder les noms de
blocs déjà réels par projet. Construit et testé réellement : nouvel endpoint
`GET /v1/personal-cockpit/project-blocks/{project_id}` qui parse en direct le
`PROJECT_BUILD_MAP.md` du projet (testé sur les 25 blocs réels de Pedro et les
4 d'OpenJarvis) ; Pedro ajouté au registre de projets (absent jusque-là) ;
écran `BlockDetail` dédié par bloc. ADV/ABG/Obsidian/Graphify/Valéna n'ont pas
encore de `PROJECT_BUILD_MAP.md` → état honnête "pas encore suivi par blocs",
rien d'inventé. Commit `8bf190b`. **Interrompu ici** : Ruth a demandé de passer
à un audit plus large (orchestration Hermès) avant de continuer sur
l'interface — reprendre le fil Bloc 03 après.

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

**PROCHAINE ACTION** : aucune urgente — Bloc 03 `TESTED`. Reste ouvert si Ruth le souhaite : traduire le détail des items de checklist ADV (actuellement laissé en anglais, décision explicite 2026-08-30) ; enrichir le Bloc 8 (aucune correspondance checklist trouvée).

**BUG BLOQUANT GO LIVE — TROUVÉ ET CORRIGÉ (2026-08-31)** : Ruth a signalé
que "Travailler ce bloc avec Hermès" (bouton `BlockDetail`) et "Demander à
Hermès" (bouton `ProjectDetail`) ne faisaient rien de visible. Cause
confirmée : les deux étaient câblés `onOpenHermes={onCloseDetail}` — un
simple retour à l'accueil, sans aucun message envoyé à Hermès. Corrigé
(`frontend/src/prototypes/ruthos/RuthOSPrototype.tsx`, commit `5076db2`) :
le clic construit maintenant un message avec le vrai contexte (projet,
numéro de bloc, nom, objectif, prochaine action) et l'envoie via le chat
déjà câblé (`handleSend`), qui retombe sur la chaîne déjà prouvée
(observateur → mission proposée → Préparer avec Hermès → approbation).
**Testé réellement** (Playwright, clic navigateur, pas juste écrit) sur
Jarvis bloc 05 : `current_mission.json` confirme
`project_domain=JARVIS`, `project_context.project_id=jarvis`,
`block.num=05` — résolution exacte du bloc cliqué. 0 erreur console sur
les deux boutons.
**Limite corrigée (2026-08-31, Ruth : "limite honnete regle les")** :
`DOMAIN_RULES` (`decision_engine.py`) n'avait aucun mot-clé pour EduPilot,
Caisse Alliance de Dreux, Ma Buvette Mobile (retombaient sur `JARVIS` par
défaut) ; `_project_context` (`hermes_core/api.py`) avait sa propre liste de
racines projet locale et incomplète (ADV absent) au lieu de lire
`project_blocks.PROJECT_BUILD_MAP_PATHS` — la source unique que ce module
documente lui-même. Corrigé : mots-clés ajoutés, `_PROJECT_ROOTS` dérivé de
la source unique + racine ADV ajoutée à part (format de suivi différent,
absent de `PROJECT_BUILD_MAP_PATHS`). Le message envoyé par le bouton inclut
maintenant aussi l'id littéral du projet (`project.id`), pas seulement son
nom affiché — `_project_context` résout par sous-chaîne exacte de l'id, pas
par nom lisible. **Testé réellement** (Playwright) sur EduPilot, Caisse
Alliance de Dreux, Ma Buvette Mobile et ADV : les 4 résolvent maintenant le
bon `project_domain` + `project_id` (avant : tout tombait sur `JARVIS`, ADV
n'avait même pas de racine projet du tout). 30/30 tests `hermes_core`
toujours verts. Aucune régression sur Jarvis bloc 05 (revérifié).
**Reste non couvert, honnêtement** : ABG, Obsidian, Graphify, Valéna n'ont
toujours pas de `PROJECT_BUILD_MAP.md` — ce n'est pas un bug de
classification, il n'y a simplement aucune donnée de bloc à résoudre pour
ces 4 projets (le bouton "Travailler ce bloc avec Hermès" n'est d'ailleurs
même pas atteignable pour eux, faute de blocs listés).

---

## BLOCK 04 — Cockpit voix (Kokoro/STT/Pipecat)

**OBJECTIF** : permettre à Ruth de parler à Hermès depuis les écrans OpenJarvis (ancien écran + Home G).

**STATUT GLOBAL** : `TESTED` — branchement WebRTC continu, testé en headless
puis validé au micro humain réel par Ruth (2026-09-01) : connexion,
interruption et reprise après coupure toutes confirmées.

**CE QUI EXISTE** : backend voix (Kokoro TTS, STT faster-whisper) opérationnel ; ancien écran `JarvisPersonalPage.tsx` avec micro manuel complet (inchangé, `?classic=1`) ; G raccordé au runtime WebRTC/Pipecat V2 continu (voir plus bas, 2026-08-31) — session persistante, barge-in piloté serveur, plus de dictée par tour.

**CE QUI MANQUE** : G emploie aujourd'hui une dictée `MediaRecorder` arrêtée
manuellement, pas le runtime conversationnel WebRTC/Pipecat : une session
vocale persistante (VAD fin de parole, réponse orale, barge-in, reprise) reste
à intégrer. Le test humain réel navigateur (voix, transcription, écoute
Kokoro, interruption) reste requis; le POC V2 seul ne le valide pas.

**DERNIÈRE REVUE CLAUDE** : 2026-08-30, micro G ajouté et vérifié Playwright réel (voir `CORE/HANDOFFS/2026-08-30_CODEX_voice-home-g-coordination.md`).
**DERNIÈRE REVUE CODEX** : 2026-08-31 — diagnostic prouvé : le micro G appelle
`startRecording()`/`stopRecording()`/transcription, tandis que le POC V2
possède VAD + barge-in. POC relancé, smoke WebRTC et compilation OK; aucune
preuve micro/voix/barge-in en headless. Détail :
`HANDOFFS/2026-08-31_Codex_voice-mission-audit-needs-claude-ui.md`.

**TEST HUMAIN RÉEL FAIT (Ruth, 2026-08-31 ~22h40)** : confirmé sur G (Hermès),
pas une confusion d'écran. Les deux lacunes déjà diagnostiquées sont bien
réelles en usage réel, pas seulement en théorie : **impossible d'interrompre
Hermès pendant qu'il parle**, et **le micro doit être arrêté manuellement
(reclic) pour déclencher la transcription** — confirme qu'il s'agit encore
d'une dictée `MediaRecorder` (clic → parle → clic pour arrêter → transcrit),
pas d'une session vocale continue avec détection de fin de parole.

**BRANCHEMENT FAIT (Claude, 2026-08-31 ~23h05, commit `41d980b`)** : Codex a
publié le contrat exact
(`prototypes/hermes-webrtc-poc-v2/INTEGRATION_CONTRACT.md`). Nouveau hook
`useHermesVoiceSession` (`frontend/src/hooks/`) : `getUserMedia` →
`RTCPeerConnection` + data channel `hermes-events` → `POST /api/offer` avec
un `session_id` stable (nouveau, partagé aussi avec le chat texte) →
`client-ready` → messages `state`/`message`/`event` reçus en continu, audio
distant via `pc.ontrack`. Pas de `POST /interrupt` (n'existe pas côté
runtime) : le barge-in reste piloté par le flux micro continu + VAD
server-side, G coupe seulement son rendu audio local sur
`user_speaking`/`barge_in_start`. Bouton micro : un clic démarre la session
complète, un clic la ferme — plus de clic par tour de parole. Ancienne
dictée `MediaRecorder` (`useSpeech`/`useHermesSpeaker`) retirée de G
uniquement, toujours utilisée par l'écran classique (`?classic=1`).

**Bug trouvé et corrigé en testant** : le serveur POC V2 tournait depuis
avant le correctif CORS de Codex (`allowed_origins` figé au démarrage du
process) — `127.0.0.1:5173` bloqué en préflight malgré une config déjà
correcte dans le code. Redémarré.

**Testé réellement (Playwright, `--use-fake-device-for-media-stream`, pas
un vrai micro)** : ouverture de session confirmée côté serveur POC
(`active_sessions` 0→1), accueil Hermès reçu et affiché dans la bulle G via
le data channel (pas via `/api/hermes/chat`, conforme au contrat), état
`SPEAKING` reflété sur le bouton micro et son libellé, fermeture propre
(`active_sessions` 1→0), 0 erreur console, mobile 390×844 sans régression,
`tsc --noEmit` propre. **Limite trouvée et documentée, pas corrigée**
(hors périmètre Claude — comportement du runtime Codex) : une fermeture
brutale d'onglet laisse la session orpheline côté serveur au-delà de 8s ;
le serveur l'auto-nettoie au prochain `/api/offer`
(`_sessions.clear()` avant chaque nouvelle session) donc sans conséquence
en usage normal (bouton unique, un seul utilisateur).

**Non prouvé par ce test** (nécessite un vrai micro humain, comme convenu
avec Codex dès le départ) : VAD réel sur vraie parole, TTS Kokoro à
l'oreille, interruption réelle en reparlant.

**TEST HUMAIN RÉEL #2 (Ruth, 2026-08-31 ~23h15)** : "c'est lent, c'est mou,
ça comprend pas". Bug trouvé en comparant au client de référence de Codex
déjà validé (`prototypes/hermes-webrtc-poc-v2/web/app.js`, commit `8b86527`) :
G coupait l'audio sur `user_speaking`/`barge_in_start` mais ne le réarmait
**jamais** sur `audio_play_start` — une seule coupure rendait Hermès muet
pour le reste de la conversation. Corrigé (`cutRemoteAudio`/
`resumeRemoteAudio` symétriques), + résilience `onconnectionstatechange`
(grâce 2s) + keepalive ping, les deux absents de ma première version et
présents dans le client déjà prouvé. Testé réellement (Playwright, faux
micro) : ouverture/accueil/fermeture toujours propres, 0 régression. Le
cycle réel coupure→reprise n'est pas revérifié par Ruth après ce correctif.
Honnête : "lent" peut aussi venir de la latence du pipeline STT→LLM→TTS
lui-même (terrain Codex) — ce correctif règle précisément "devient muet
après une interruption", pas nécessairement toute lenteur perçue.

**TEST HUMAIN RÉEL #3 (Ruth, 2026-09-01) — VALIDÉ** : "ça marche il s'arrête" ;
après interruption "il devient muet pas longtemps mais il reparle vite"
(comportement attendu : pause le temps qu'il réfléchisse, puis reprise —
plus jamais de mutisme permanent). Les 3 critères qui bloquaient
initialement sont confirmés en usage réel : connexion de base, interruption
réelle en reparlant, reprise après coupure.

**Piste "toujours mou" trouvée avant ce test réussi, non un bug** : Ruth
utilisait les haut-parleurs de l'ordinateur, pas un casque. Reproduit en
injectant un vrai fichier audio dans un faux micro (Playwright,
`--use-file-for-fake-audio-capture`) : boucle réelle
`Ruth parle → Transcription (8+s) → Hermès réfléchit → Ruth parle → ...`
sans jamais atteindre `SPEAKING` — cohérent avec le micro captant la propre
voix d'Hermès sortie des haut-parleurs et la VAD la reprenant pour une
nouvelle interruption, malgré `echoCancellation:true` côté navigateur et la
détection d'écho déjà présente côté runtime (`_detect_barge_in_echo`).
**Confirmé par le test : au casque, plus de boucle.** Contrainte matérielle
connue de ce type de système (mêmes recommandations chez Zoom/Teams), pas
un défaut de code à corriger dans l'immédiat — noté pour Codex si un
renforcement de la détection d'écho est voulu plus tard pour l'usage
haut-parleurs.

**STATUT GLOBAL** → `TESTED`.

**RUTH_DECISION_REQUIRED** : aucune.
**PROCHAINE ACTION** : aucune bloquante. Reste ouvert si Ruth le souhaite :
un indice visuel dans G recommandant un casque pour la voix (UX mineure,
pas demandée pour l'instant).

---

## BLOCK 05 — Orchestration Hermès (hermes_core)

**OBJECTIF** : que la conversation Hermès du quotidien passe réellement par un raisonnement structuré (intention → outils → décision → validation), pas seulement par un appel LLM direct.

**STATUT GLOBAL** : `RUTH_DECISION_REQUIRED`.

**CE QUI EXISTE** : `hermes_core/orchestrator/` (decision_engine.py, mission.py, agent_bridge.py, engine.py) — classifieur d'intention réel, construction de mission structurée réelle, `policy/engine.py` + `policies/action_classes.toml`/`risk_matrix.toml` (paliers de risque réels, défaut prudent). Le pont d'exécution (`agent_bridge.py` → `CORE/bridge/route_agent.py`) est **prouvé de bout en bout à deux reprises** : chat → mission → approbation → exécution réelle → preuve écrite dans le projet, avec repli automatique Codex→Claude si quota épuisé (2026-08-30, non encore relu par Codex).

**CE QUI MANQUE** : le chat du quotidien (`personal_cockpit.py`) appelle un LLM directement, sans passer par `decision_engine.py`/`mission.py` — l'orchestrateur tourne en observation asynchrone seule (jamais de validation créée par ce chemin, par sécurité), pas encore branché à la réponse réelle. 3 systèmes de routage distincts coexistent sans être unifiés : `hermes_core/orchestrator` (plan seul), `CORE/bridge/route_agent.py` (exécution réelle Claude/Codex), et un ancien `~/.openjarvis/jarvis-personal/routing/*.toml` (config orpheline, jamais lue par aucun code) — **archivé le 2026-08-31** vers `_ARCHIVE_unused/routing_archived-2026-08-31/`, décision Ruth, réversible.

**BUGS CONNUS** : l'affichage de mission confond la demande courante (singleton
`current_mission.json`) et le dernier cycle exécuté
(`validation_state.last_resolved`). Ainsi une nouvelle consultation Pedro peut
afficher « rien n'est lancé » alors que le Bloc 20 est déjà `TESTED`. Ce n'est
pas un cache; l'UI doit distinguer état du bloc, consultation en cours et
historique d'exécution par `request_id`.

**CORRECTION CŒUR (Codex, 2026-08-31)** : historique borné de 24 missions dans
le state Hermès, lié par `request_id`, avec agents/route/résultat et statut du
bloc. L'endpoint de lecture expose désormais `mission_history` et
`last_execution` séparément de la mission courante. L'UI G doit seulement les
présenter — aucun état n'est à deviner ou écraser.

**CORRECTION UI (Claude, 2026-08-31, commit `a5d6ea7`)** : les 3 états sont
maintenant distincts à l'écran dans `RuthOSPrototype.tsx`. État réel du bloc
ajouté directement dans la carte "Mission proposée" (`project_context.block.status`,
déjà exposé par le backend, jamais affiché avant). Nouvelle carte séparée
(accent vert, jamais confondue avec la carte violette de la mission en
cours) "Dernière exécution réelle" — lit `last_execution`, recoupe
`mission_history` par `request_id` pour le contexte projet/bloc, s'affiche
même sans consultation active. Testé réellement (Playwright) : capture
confirmant `MISSION_TEST_RECU + TESTED` (résultat Pedro réel) visible
indépendamment de la consultation Jarvis bloc 05 alors en cours ; 0 erreur
console ; mobile 390×844 sans scroll horizontal ; `tsc --noEmit` propre.
**BUGS CONNUS ci-dessus : résolu.**

**TESTS** : pytest hermes_core (mission, policy, orchestrator) verts d'après Codex ; exécution réelle testée manuellement 2 fois (Pedro bloc Sécurité).

**DERNIÈRE REVUE CLAUDE** : 2026-08-31, cartographie complète — voir `CORE/AUDITS/2026-08-31_CLAUDE_cartographie-globale-ruthos-hermes-jarvis.md`.
**DERNIÈRE REVUE CODEX** : 2026-08-31 — API G rejouée : Bloc 20 `TESTED`,
nouvelle mission `mission_ready_not_executed`, dernier résultat séparé
`MISSION_TEST_RECU + TESTED`. Tests ciblés 10/10. Détail :
`HANDOFFS/2026-08-31_Codex_voice-mission-audit-needs-claude-ui.md`.

**HYGIÈNE DES MISSIONS (Codex, 2026-09-01)** : anomalie réelle corrigée :
l'observateur créait une mission pour chaque phrase de chat, y compris une
salutation ou une transcription dégradée (`...`). Il ne prépare désormais une
mission que pour une demande de travail explicite. Test HTTP réel : demande
Pedro / Bloc Sécurité → mission liée au Bloc 20, route Codex prête,
`execution_allowed=false`; salutation suivante → la mission est conservée,
non remplacée. Tests serveur ciblés 11/11 et tests `hermes_core` policy/
orchestrateur 12/12. Aucun agent n'a été lancé par ce test.

**RUTH_DECISION_REQUIRED** : brancher le chat quotidien à l'orchestrateur (au-delà de l'observation) — décision à prendre, pas commencé.
**PROCHAINE ACTION** : Codex branche le cycle explicite chat → mission →
préparation de validation → routeur existant ; Claude rend ce cycle visible
dans G. Aucun envoi automatique à un agent.

---

## BLOCK 06 — Mémoire Hermès (contexte, décisions, projet)

**OBJECTIF** : que Hermès dispose d'un contexte à jour (Obsidian, décisions, projet, session) pour raisonner et répondre.

**STATUT GLOBAL** : `TESTED`.

**CE QUI EXISTE** : `hermes_core/memory/` (context_builder.py, decision_memory.py, obsidian_memory.py, project_memory.py, session_memory.py) — lecture réelle du vault Obsidian, du journal de décisions markdown, de l'état projet et des handoffs de session, assemblés dans `memory_context.json`. `journal/hermes_events.jsonl` et `journal/actions.jsonl` écrits en continu (vérifié, horodatage du jour même). **Branché le 2026-08-31** : `refresh_memory_context()` appelée depuis `_hermes_core_capabilities_snapshot()` dans `personal_cockpit.py`, exposée dans `hermes.capabilities.memory` de la réponse API. Choix technique : à la demande (déclenché par le même chemin que le bouton "Actualiser" et les rafraîchissements après action, pas de polling continu) — Codex confirmé via le pont qu'aucune raison de performance n'était documentée contre le branchement.

**CE QUI MANQUE** : `memory/indexes/obsidian_*.json` (45 fichiers, cache distinct) dormant depuis le 13 mai — pas rafraîchi par ce branchement, à part.

**TESTS** : vérifié en direct sur le serveur réel — `curl /v1/personal-cockpit` renvoie `hermes.capabilities.memory` avec 4 clés réelles (session_handoffs, obsidian_bundle, decision_memory, project_memory) ; temps de réponse ~300ms, pas de régression perf.

**RUTH_DECISION_REQUIRED** : aucune.
**PROCHAINE ACTION** : aucune — visible dans l'API, à intégrer dans l'UI G si Ruth veut le voir affiché (pas demandé pour l'instant).

**DERNIÈRE REVUE CLAUDE** : 2026-08-31 — câblé et testé.
**DERNIÈRE REVUE CODEX** : question posée et répondue via le pont (2026-08-31) — voir `CORE/HANDOFFS/2026-08-31_CLAUDE_wiring-memoire-skills-question-codex.md`.

---

## BLOCK 07 — Skills / Routines / Executors (hermes_core)

**OBJECTIF** : capacités internes réutilisables d'Hermès (brief du jour, routeur de projet, garde-fou de risque, etc.).

**STATUT GLOBAL** : `TESTED`.

**CE QUI EXISTE** : `hermes_core/skills/registry.py` (~10 skills réelles définies : daily_brief, live_brief, session_resume, decision_log, project_router, risk_guard, obsidian_curator, next_actions, session_closer, validation_gate), `routines/`, `executors/` — code réel, pas de stub. `get_core_snapshot()` les assemble toutes (tools/skills/routines/executors) en un seul appel. **Branché le 2026-08-31** dans `personal_cockpit.py`, exposé dans `hermes.capabilities.{skills,routines,executors}` de la réponse API. À distinguer des skills Claude Code (`~/.claude/skills/`), système différent et lui bien utilisé — même mot, deux systèmes.

**CE QUI MANQUE** : rien côté branchement. Reste ouvert si Ruth veut : affichage dans l'UI G (pas demandé pour l'instant, visible uniquement via l'API pour le moment).

**TESTS** : vérifié en direct — `hermes.capabilities` renvoie 10 skills, 1 routine, 11 executors réels, temps de réponse ~300ms, pas de régression sur le reste du payload.

**RUTH_DECISION_REQUIRED** : aucune.
**PROCHAINE ACTION** : aucune — brancher un affichage UI seulement si Ruth le demande.

**DERNIÈRE REVUE CLAUDE** : 2026-08-31 — câblé et testé.
**DERNIÈRE REVUE CODEX** : question posée et répondue via le pont (2026-08-31) — "branchement délibérément laissé en attente de décision Ruth, pas un oubli, aucune raison de performance documentée."

---

## BLOCK 08 — Automatisations / Workflows (LaunchAgents)

**OBJECTIF** : tâches Hermès qui tournent seules, sans que Ruth ait à les déclencher (brief du matin, triage mail, etc.).

**STATUT GLOBAL** : `TESTED`.

**CE QUI EXISTE** : pas de moteur de workflow générique — les 16 fichiers `workflows/definitions/*.toml` sont des spécifications, jamais exécutées par du code (grep négatif). **Un seul workflow réellement câblé** : `hermes_prepare_my_day`, avec son propre script (`scripts/hermes_prepare_my_day.sh`) et un vrai LaunchAgent macOS actif (`com.ruth.jarvis.hermes.prepare-day.plist`, cron quotidien 8h, confirmé chargé). Deux autres LaunchAgents réels trouvés mais non explorés : `com.ruth.hermes.wake.plist` et `com.ruth.hermes.control.plist` (ouvre une vraie app macOS `Hermes Control.app`, créée le 8 mai, jamais mentionnée avant cet audit).

**BUGS CONNUS** : `hermes_prepare_my_day` a échoué 4 jours (2026-08-28 → 08-31). **Root cause réelle corrigée par Codex le 2026-08-31** (différente de mon premier diagnostic de permission macOS) : une réécriture décorative secondaire dans Obsidian/iCloud faisait échouer tout le script *après* que le brief utile ait déjà été créé — corrigé pour ne plus être bloquante. Vérifié : `automation_status.json` = `status: ok, exit_code: 0` (2026-08-31 10:18 UTC). Aucune action Ruth nécessaire, contrairement à ce qui était noté avant.

**CE QUI MANQUE** : les 15 autres workflows définis (mail_triage, obsidian_sync, daily_review...) et les 8 scripts `wrappers/*.py` (calendar_guard, mail_guard, etc., code réel non-stub) n'ont aucun déclencheur — construits, jamais branchés.

**RUTH_DECISION_REQUIRED** : aucune sur les 15 workflows — tranché.
**DÉCISION RUTH (2026-08-31)** : les 15 workflows non branchés restent de côté, même logique que les intégrations gelées (Bloc 09) — pas un chantier maintenant.
**PROCHAINE ACTION** : aucune sur le brief matinal (corrigé) ; `Hermes Control.app` et `com.ruth.hermes.wake.plist` restent à auditer séparément si utile plus tard, pas urgent.

**DERNIÈRE REVUE CLAUDE** : 2026-08-31 — voir cartographie globale.
**DERNIÈRE REVUE CODEX** : 2026-08-31 — a diagnostiqué et corrigé la vraie root cause du brief matinal (contre-revue de mon diagnostic initial de permission macOS, qui était incomplet).

---

## BLOCK 09 — Intégrations externes (Google, Yahoo, NotebookLM, Graphify, Apple, n8n)

**OBJECTIF** : connecter Hermès aux vrais outils de Ruth (calendrier, mail, Drive, etc.).

**STATUT GLOBAL** : `BLOCKED` (gelé explicitement — décision Ruth 2026-08-31).

**CE QUI EXISTE** : preuve d'activité réelle passée et non simulée — dossiers Google Drive créés avec de vrais IDs après validation de Ruth, mails Yahoo réellement déplacés avec vérification, test Graphify passé (rendu HTML confirmé), permissions Apple accordées.

**CE QUI MANQUE** : toute activité récente. Tous les `status.json` datent du 23 avril au 13 mai — 3 à 4 mois d'arrêt. `n8n` et `openrouter` n'ont même pas de `status.json` — jamais activées.

**RUTH_DECISION_REQUIRED** : aucune — tranché.
**DÉCISION RUTH (2026-08-31)** : gel explicite et assumé, pas un oubli. Focus reste sur sécurité Pedro + voix G. Pas de travail lancé ici tant que Ruth ne redemande pas.
**PROCHAINE ACTION** : aucune, en attente d'une future demande de Ruth.

**DERNIÈRE REVUE CLAUDE** : 2026-08-31 — voir cartographie globale.
**DERNIÈRE REVUE CODEX** : non faite.

---

## BLOCK 10 — Journalisation / Validation (cycle de vie des délégations)

**OBJECTIF** : tracer chaque délégation réelle avec preuve, jamais se fier à la seule parole d'un agent.

**STATUT GLOBAL** : `TESTED`.

**CE QUI EXISTE** : `hermes_core/validation/engine.py` — cycle de vie complet et réel : `prepared → awaiting_validation → approved → executed → result_logged`, avec branches `blocked`/`cancelled`/`rejected`, chaque transition journalisée avec horodatage. Prouvé en conditions réelles à deux reprises (Pedro, bloc Sécurité). `journal/hermes_events.jsonl` actif aujourd'hui.

**CE QUI MANQUE** : `validation/queue.json` (store top-level, distinct du module Python) dormant depuis le 1er mai — à vérifier si c'est normal (peu de délégations réelles avant cette semaine) ou un signe de désynchronisation.

**CRITÈRES DE FIN** : satisfait pour les délégations mission→exécution. Non applicable au chat quotidien (pas encore branché, voir Bloc 05).

**RUTH_DECISION_REQUIRED** : aucune.
**PROCHAINE ACTION** : vérifier `validation/queue.json` une fois plusieurs délégations réelles supplémentaires passées.

**DERNIÈRE REVUE CLAUDE** : 2026-08-31 — voir cartographie globale.
**DERNIÈRE REVUE CODEX** : non faite.

---

## BLOCK 11 — `OpenJarvis-clean` (référence morte)

**OBJECTIF** : n/a — bloc de suivi pour une décision de nettoyage, pas une fonctionnalité.

**STATUT GLOBAL** : `DONE`.

**CE QUI EXISTE** : `~/Jarvis/OpenJarvis-clean`, clone quasi intact du framework open source Stanford (Apache 2.0), 620 commits, dernier commit le 2026-04-29 — 4 mois d'inactivité. Une seule référence dans tout le système : un commentaire non résolu dans `scripts/jarvis_voice_v4.py` ("décider si on migre la v4 vers openjarvis-clean"), jamais tranché.

**CE QUI MANQUE** : aucune capacité identifiée qui n'existe pas déjà dans `~/Jarvis/OpenJarvis` (la version active).

**DÉCISION RUTH (2026-08-31)** : "attaque" — archivé, pas supprimé (réversible). Déplacé vers `~/Jarvis/_ARCHIVE/OpenJarvis-clean_archived-2026-08-31/`, git history intact, changements locaux non commités préservés (README.md, DashboardPage.tsx modifiés + 2 fichiers non trackés — rien perdu).
**PROCHAINE ACTION** : décision Ruth, sinon laisser tel quel sans y toucher.

**DERNIÈRE REVUE CLAUDE** : 2026-08-31 — voir cartographie globale.
**DERNIÈRE REVUE CODEX** : non faite.
