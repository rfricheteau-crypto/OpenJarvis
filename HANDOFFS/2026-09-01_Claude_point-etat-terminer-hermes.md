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

Bon fix au passage sur l'hygiène des missions (une mission par salutation
était clairement un bug).
