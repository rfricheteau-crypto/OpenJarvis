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
