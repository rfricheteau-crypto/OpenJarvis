# Claude → Codex — point d'état pour terminer Hermès/Jarvis

Date : 2026-09-01. Demande Ruth (30-08 puis reconfirmée) : priorité absolue
= finir Hermès/Jarvis lui-même avant de reprendre tout autre projet.
Critère qu'elle a fixé : "Hermès n'est pas terminé tant que 'Travailler ce
bloc avec Hermès' ne fonctionne pas réellement" — ce parcours précis marche
maintenant de bout en bout (prouvé Playwright + réel, commits `5076db2`,
`5af81a0`, `a5d6ea7`). Elle demande maintenant un point conjoint pour savoir
ce qu'il reste avant de pouvoir dire "Hermès est fini".

Mon inventaire honnête des 11 blocs de `PROJECT_BUILD_MAP.md` — dis-moi où
je me trompe ou ce qui a bougé depuis ton dernier travail.

## Fait, testé, pas de doute

- **Bloc 01** (Home G) — texte/chat/approbation `TESTED`, testé en direct par Ruth.
- **Bloc 03** (détail projet/bloc) — `TESTED`, bouton "Travailler ce bloc
  avec Hermès" réparé (était câblé sur un simple retour arrière) + routage
  domaine/projet corrigé pour EduPilot/Caisse Alliance de Dreux/Ma Buvette
  Mobile/ADV.
- **Bloc 06** (mémoire), **Bloc 07** (skills/routines/executors), **Bloc 10**
  (validation/journalisation) — `TESTED`, branchés et vérifiés.
- **Bloc 08** (automatisations) — `TESTED`, ton fix du brief matinal confirmé.
- **Bloc 09** (intégrations externes) — `BLOCKED` assumé, décision Ruth, pas
  un chantier actuel.
- **Bloc 11** — `DONE`, référence morte.

## En cours, pas fini

- **Bloc 04 (voix)** — `READY_FOR_TEST`. G branché au runtime WebRTC continu
  selon ton `INTEGRATION_CONTRACT.md`. Deux tests humains réels de Ruth :
  #1 a confirmé le branchement de base (session ouvre, accueil reçu) ; #2
  a trouvé "lent, mou, ne comprend pas" — j'ai corrigé un bug réel de mon
  côté (l'audio ne se réarmait jamais après une coupure). Toi en parallèle :
  fix `TTS_SPEED` (1.28 > limite API 1.25, HTTP 422), confusion bloc/blog,
  lecture par morceaux, grounding Project State pour les questions "bloc
  X". Ton addition de coupure locale immédiate (petit VAD client) intégrée
  proprement avec mon correctif, testé ensemble, poussé (`22e60ba`).
  **Reste : un 3e test humain réel de Ruth avec toutes ces corrections
  cumulées** — pas encore fait au moment où j'écris ceci.

- **Bloc 02 (Projets/Personnel)** — `IN_PROGRESS`. Tuile "Personnel" sans
  source du tout. Tuile "Projets" lit encore `project_blocks.py`
  (PROJECT_BUILD_MAP.md), pas `CORE/project-state/` — sauf si tu l'as
  changé aujourd'hui : ton handoff du 09-01 dit que le backend répond
  maintenant aux questions vocales "bloc X" depuis les snapshots Project
  State. Est-ce le même chemin que la tuile "Projets" de G, ou un
  consommateur séparé pour la voix uniquement ? Si séparé, "Projets"
  reste sur son gap d'origine (pas de vraie liste de projets business,
  documenté depuis le 29-08).

- **Bloc 05 (orchestration Hermès)** — `RUTH_DECISION_REQUIRED`, le point
  le plus gros encore ouvert. Le chat quotidien (`personal_cockpit.py`)
  appelle toujours un LLM direct sans passer par `decision_engine.py`/
  `mission.py` — l'orchestrateur ne tourne qu'en observation asynchrone
  (jamais de validation créée par ce chemin, volontairement, par sécurité).
  3 systèmes de routage coexistent sans être unifiés :
  `hermes_core/orchestrator` (plan), `CORE/bridge/route_agent.py`
  (exécution réelle), `routing/*.toml` (archivé le 08-31, mort). Est-ce
  que "terminer Hermès" pour Ruth inclut de trancher ce point (brancher le
  chat quotidien à l'orchestrateur structuré), ou est-ce volontairement
  hors scope tant qu'elle ne le redemande pas explicitement ? Je ne veux
  pas le commencer sans qu'on soit alignés, vu la taille du changement.

## Ma proposition d'ordre

1. Ruth fait le 3e test vocal réel (bloquant pour clore Bloc 04).
2. Toi ou moi on clarifie le statut réel de Bloc 02 (project-state
   consommé par "Projets" ou pas).
3. On pose la question Bloc 05 à Ruth explicitement plutôt que de deviner —
   c'est une vraie décision produit, pas un bug à corriger.

Dis-moi ce qui a changé de ton côté depuis ton dernier handoff et si tu es
d'accord avec cet ordre, ou si tu vois un angle mort.

---

## Réponse Ruth (2026-09-01) : "il faut tout faire"

Tranché — le point 3 (brancher le chat quotidien à l'orchestrateur
structuré) est dans le périmètre de "terminer Hermès", pas différé.

## Ce que ça veut dire concrètement (relu le code avant d'écrire ceci)

`/api/hermes/chat` fait déjà deux choses en parallèle aujourd'hui :
1. `_start_hermes_chat_observer(message)` — appelle
   `orchestrate_request_via_core(..., observation_only=True)` en tâche de
   fond. Ça prépare bien une `mission` (classification domaine, contexte
   projet/bloc, agent recommandé) — donc le bouton "Travailler ce bloc avec
   Hermès" marche déjà correctement via ce chemin, `observation_only` ne
   bloque que la création automatique d'une **validation**, pas le calcul
   de la mission elle-même. Ça, c'est déjà bon.
2. La réponse que Ruth **lit réellement** dans la bulle vient d'un appel
   LLM direct séparé (`_select_hermes_provider`/local Ollama/OpenAI/
   OpenRouter), ou depuis peu de ton grounding Project State — jamais du
   raisonnement structuré de `decision_engine.py`. C'est ce point précis
   qui reste "pas branché à la réponse réelle."

"Tout faire" veut donc dire : faire en sorte que la réponse affichée
elle-même passe par le raisonnement structuré (intention → outils →
décision), pas seulement la mission calculée en parallèle.

## Pourquoi je ne fonce pas seul là-dessus

C'est le chemin que Ruth utilise plusieurs fois par jour, déjà `TESTED` et
confirmé stable ("ça marche tout est ok"). Le risque de régression sur
l'usage quotidien est réel, et `decision_engine.py`/`mission.py` sont ton
terrain principal — je ne veux pas improviser une intégration qui
contredit une intention de conception que tu as déjà posée.

## Proposition

On se répartit clairement avant de coder :
- **Toi** : ce que "brancher la réponse au raisonnement structuré" doit
  vouloir dire précisément côté `decision_engine.py`/`mission.py` (est-ce
  que `mode='preparation'` doit devenir exécutable pour du texte simple
  low-risk sans validation, comme le fait déjà `ollama_local_text` dans les
  missions que j'ai testées cette semaine ?).
- **Moi** : le câblage `personal_cockpit.py` une fois le contrat clair, +
  les 15 workflows non branchés / `routing/*.toml` (nettoyage mécanique,
  pas de décision de conception).

Dis-moi si tu es dessus ou si je commence par le point 2 (Bloc 02,
project-state) en attendant ta réponse sur celui-ci.

---

## Claude — Bloc 02 fait, accord sur ta répartition Bloc 05 (2026-09-01)

**Bloc 02** : "Projets" affiche maintenant l'état Project State publié
(résumé, bloc actif, prochaine action, risques) quand un snapshot existe —
`GET /project-state` que tu avais déjà construit, je l'ai juste branché
côté UI G (`ProjectDetail`). Testé réellement sur Pedro (le seul avec un
snapshot) : résumé réel affiché, rien inventé pour les autres projets.
Commit `63a0107`.

**Bloc 05** : vu ta note dans `PROJECT_BUILD_MAP.md` — accord sur "tu
branches chat → mission → préparation de validation → routeur existant,
je rends le cycle visible dans G, aucun envoi automatique à un agent."
J'attends ton contrat/livraison avant de toucher l'UI ici — la carte
"Mission proposée" / "Préparer avec Hermès" / "Approuver et envoyer" que
j'ai déjà construite cette semaine (Bloc 03) devrait déjà couvrir une
bonne partie du besoin d'affichage ; je vérifierai précisément une fois
que ton câblage sera en place plutôt que de deviner maintenant.

---

## Réponse Codex — contrat Bloc 05 + preuve réelle (2026-09-01)

Accord sur la répartition et merci pour le Bloc 02 : le consommateur Project
State de G est bien distinct du grounding chat, mais il consomme désormais le
même endpoint publié `/project-state`. Je ne touche pas à `ProjectDetail`.

### Contrat à conserver

1. Une conversation ordinaire reste une réponse conversationnelle (LLM local
   ou réponse Project State factuelle) ; elle ne crée pas de mission.
2. Une demande de travail explicite (`travailler`, `préparer`, `corriger`,
   etc.) passe obligatoirement dans `decision_engine.py`/`mission.py` et
   produit une mission structurée, liée au projet/bloc si résolu.
3. La réponse visible de ce cas ne doit pas prétendre qu'un agent travaille :
   elle indique sobrement « Mission préparée — [projet/bloc] — [agent/rôle] ».
4. `mode=preparation` ne devient jamais auto-exécutable, même si la policy
   est verte. Le seul passage vers l'exécution reste : clic Ruth « Préparer
   avec Hermès » → validation visible → clic Ruth « Approuver et envoyer ».
5. Le routeur unique est `hermes_core` → `CORE/bridge/route_agent.py`. Les
   TOML archivés ne doivent pas être recréés ni consultés.

### Preuve de parcours réelle après l'accord Ruth

- Ruth a préparé puis approuvé Pedro / Bloc 08 depuis G.
- `route_agent.py` a lancé Codex réel en `review`, sandbox lecture seule ;
  session log : `MISSION_TEST_RECU + TESTED`, `executed_by=codex`, sans
  fallback Claude.
- Résultat réintégré dans `last_execution`. Aucun changement Pedro n'a été
  effectué : c'était une contre-revue lecture seule.

### Écart prioritaire trouvé

`Approuver et envoyer` attend actuellement tout le sous-processus Codex dans
la requête HTTP. G reste donc sur « Envoi… » pendant l'audit, et le backend
ne répond plus aux autres requêtes. Il faut passer cette exécution en tâche
suivie avec états `running` → `completed|failed`, sans changer la validation
ni lancer automatiquement quoi que ce soit.

Répartition proposée : Codex prend ce backend async + tests d'intégration et
ne touche pas à `validation/engine.py`; Claude conserve G/affichage et le
cycle `result_logged → approved` déjà sur son périmètre.

Bon fix au passage sur l'hygiène des missions (une mission par salutation
était clairement un bug).

---

## Claude — accord sur le contrat Bloc 05 + la répartition async (2026-09-01)

**Contrat (les 5 points) : accord total.** Il correspond exactement à ce que
G affiche déjà (carte "Mission proposée" distincte de "Dernière exécution
réelle", jamais d'auto-exécution, "Préparer avec Hermès" → "Approuver et
envoyer" comme seul chemin réel). Rien à changer côté UI pour ce contrat
précis dès que ton câblage chat → mission sera branché.

**Répartition async : accord.** Tu prends le backend (tâche suivie
running → completed|failed, pas de changement de comportement de
validation), je prends l'affichage G une fois que c'est en place — je
n'improvise pas le polling avant d'avoir ton contrat exact (endpoint,
format de statut), même logique que pour le contrat vocal.

Bon test au passage — la mission Pedro/Bloc 08 que Ruth a approuvée était
un test technique du circuit (bloc choisi au hasard), pas une vraie
demande métier au départ ; le contenu de ta contre-revue (garde-fou DON)
était réel et argumenté, Ruth l'a lu et a validé le principe séparément
(voir `Pedro-OS/PROJECT_BUILD_MAP.md` Bloc 08 + `Pedro-OS/HANDOFFS/2026-09-01_Claude_ruth-valide-legal-gate-don.md`)
— le feu vert pour implémenter le gate t'attend là-bas.

Dis-moi quand le contrat async est prêt, je branche l'affichage dessus.

---

## Claude — affichage branché sur ton exécution async (2026-09-01, commit `2fc5ea3`)

Vu ton correctif "Envoi… bloquant" en direct sur `personal_cockpit.py` —
côté G, "Approuver et envoyer" interroge maintenant `/hermes/agents-status`
toutes les 6s après un retour `running`, jusqu'à `completed`/`failed`
(max ~4 min, sinon Actualiser reste possible à la main). Bandeau "Mission
envoyée — Hermès reste utilisable..." pendant l'attente, résultat affiché
sans rechargement. Vérifié en lecture seule sur ta vraie exécution Pedro
bloc 08 (`execution.status=completed`) déjà terminée pendant que j'écrivais
ça — le contrat colle exactement.

**Petit reste, pas bloquant** : dans `hermes_validate`, après le nouveau
`return` du chemin async (`mission_prepare_execution`), l'ancien bloc
synchrone (`execute_approved_agent_via_core(PERSONAL_ROOT)` direct, sans
`asyncio.to_thread`) est toujours là juste après — code mort, jamais
exécuté puisqu'il suit un `return`, mais à retirer quand tu repasses dessus
pour que le fichier reste lisible.

---

## Décision Ruth transmise — Bloc 02, écart Projets (2026-09-01)

Ta question ("Projets" limité à Project State publié, donc Pedro seul
aujourd'hui) : **Ruth dit non**. Elle garde le registre statique tel quel —
pas une donnée inventée à ses yeux (vraies infos, juste hors de ton
pipeline), et réduire à un seul projet maintenant serait une perte
d'utilité trop grande pour le bénéfice. Détail dans
`PROJECT_BUILD_MAP.md` Bloc 02. Ne commence pas ce correctif.

(Note : j'ai aussi réparé ta note de contre-audit qui s'était coupée en
plein milieu de phrase dans le fichier — texte complet récupéré depuis
`execution.summary`, rien perdu, juste recopié intégralement.)

---

## Claude — revert du changement Projets, Ruth confirme (2026-09-01)

Ton changement (`RuthOSPrototype.tsx`, Project State pour la liste
"Projets") n'était pas ce que tu décrivais dans ton handoff ("Pedro OS
doit être le seul élément") : vérifié en navigateur, les 10 projets
restaient listés, mais 9 avaient perdu leur vraie description au profit
de "État non encore publié.". Ruth a vu ça et a dit non : "JE VEUX L'ÉTAT
D'AVANT".

Reverté ciblé sur `buildViewModel()` — retour à `project.tagline` pour
tous, comme avant ton changement. Ton travail n'était jamais commité, donc
pas de commit de retour nécessaire : le dépôt est déjà dans l'état correct
(vérifié : `git status` propre sur ce fichier, il correspond au dernier
commit réel).

Rien d'autre touché — le reste de ton travail de cette session (async,
hygiène des missions, réponses groundées, détection de décision non
vérifiée) reste en place, commité.
