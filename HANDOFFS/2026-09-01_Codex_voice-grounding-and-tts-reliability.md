# Codex — vocal G : ancrage Pedro et fiabilité TTS (2026-09-01)

## Résultat

- Cause de la réponse « blog Pedro » confirmée avec contre-revue Claude :
  confusion STT possible `bloc` → `blog`, suivie d'une réponse LLM sans état
  projet structuré.
- Le vocal G corrige précisément « prochain blog Pedro » en « prochain bloc
  Pedro », sans réécrire un vrai usage du mot « blog ».
- Le backend répond maintenant aux questions `bloc` pour un projet depuis les
  snapshots Project State publiés, sans appeler un modèle et sans inventer un
  état manquant.
- La panne de réponse orale était réelle : `TTS_SPEED=1.28` dépassait la
  limite API `1.25`, causant HTTP 422. La vitesse est maintenant valide et
  bornée défensivement dans le bridge.
- Le texte écrit et le texte parlé restent désormais identiques. Pour réduire
  l'attente sans supprimer d'information, les longues réponses sont
  synthétisées et lues par morceaux dans l'ordre : Kokoro prépare le morceau
  suivant pendant que le précédent est lu.
- Les logs de diagnostic ne conservent plus le texte des échanges.

## Tests

- POC WebRTC : 16 tests ciblés réussis et compilation Python réussie.
- Backend : 9 tests ciblés `personal_cockpit` réussis.
- Smoke HTTP réel : `POST /api/hermes/chat` pour « prochain bloc Pedro » →
  `engine=grounded`, `provider=project-state`, réponse issue du snapshot
  Pedro réel, sans appel LLM.
- Smoke TTS réel à la vitesse `1.25` : Kokoro OK. La lecture progressive doit
  encore être validée au microphone/WebRTC réel.

## Fichiers modifiés

- `prototypes/hermes-webrtc-poc-v2/src/hermes_webrtc_poc/config.py`
- `prototypes/hermes-webrtc-poc-v2/src/hermes_webrtc_poc/runtime.py`
- `prototypes/hermes-webrtc-poc-v2/src/hermes_webrtc_poc/hermes_bridge.py`
- `prototypes/hermes-webrtc-poc-v2/tests/test_barge_in.py`
- `prototypes/hermes-webrtc-poc-v2/tests/test_hermes_bridge.py`
- `src/openjarvis/server/personal_cockpit.py`
- `tests/server/test_personal_cockpit_hermes_project_blocks.py`

## Reste ouvert

- La fluidité perçue (micro réel, VAD, interruption et compréhension) exige
  encore un test humain après redémarrage : elle ne peut pas être validée par
  les tests sans microphone.
- Le chemin Project State renvoie `active_block` et `next_action`; il ne doit
  pas prétendre connaître un « bloc suivant » absent de la source.

## Correctif voix Mac — 2026-09-01, 13:50

- Symptôme rapporté : en mode de test `?voice=native`, Hermès disait seulement
  « Bonjour » puis s'arrêtait.
- Cause confirmée dans le hook : l'état synchrone du tour précédent pouvait
  rester `THINKING` au démarrage de la nouvelle session. Le message d'accueil
  du runtime était alors lu par `speechSynthesis` comme s'il était une réponse.
- Correctif : l'état de référence est remis immédiatement à `connecting` puis
  `LISTENING_ARMED`, et le message d'accueil exact est explicitement exclu de
  la lecture native. Aucun changement au mode Kokoro normal.
- Vérification automatisée : build TypeScript/Vite réussi. Le test audio final
  reste humain (haut-parleur + micro Mac), car il ne peut pas être simulé dans
  le terminal.

## Décision Ruth — 2026-09-01

- Le test `speechSynthesis` / voix Mac est abandonné à la demande de Ruth :
  il n'était pas suffisamment fiable en conversation.
- Le code de ce test a été retiré du hook. Le seul chemin vocal reste Kokoro
  via le runtime WebRTC, sans paramètre `voice=native`.
- Vérification : aucune référence native restante dans le hook ; build
  frontend TypeScript/Vite réussi.

## Point commun Claude + Codex — finir Hermès (2026-09-01)

### Confirmé

- Le cockpit, les projets/blocs, Project State, les missions structurées, le
  routeur d'agents, les garde-fous VERT/ORANGE/ROUGE et les journaux existent
  et ont chacun des preuves de tests.
- Le chat quotidien répond, mais reste hors de ce cycle : il appelle encore le
  chat direct au lieu de faire mission → validation → routage.
- Le vocal Kokoro/WebRTC reste le seul vocal retenu. Sa dernière validation
  humaine est volontairement reportée à la demande de Ruth.

### Priorité commune proposée

1. Terminer **l'orchestration texte sûre du quotidien** : une demande Ruth est
   comprise, liée au bon projet/bloc, transformée en mission, puis seulement
   proposée à validation avant toute délégation réelle.
2. Unifier autour de ce chemin les deux routeurs encore séparés ; ne pas créer
   une quatrième couche.
3. Ensuite, faire alimenter la vue Projets par Project State et décider une
   vraie source pour Personnel.
4. Reprendre le test vocal Kokoro seulement quand Ruth le souhaite.

### Répartition sans doublon

- Codex : contrat backend et branchement sûr chat → mission → policy →
  `route_agent.py`, tests d'intégration et logs.
- Claude : parcours visible dans G (mission proposée, demande de validation,
  résultat réintégré) et cohérence UX.
- Aucun ne touche au code vocal Mac abandonné.

## Démarrage bloc orchestration — 2026-09-01

### Ce qui a été fait

- L'observateur de mission du chat filtre désormais les salutations, questions
  d'état et transcriptions manifestement dégradées. Elles ne remplacent plus
  la mission active.
- Une demande explicite a été testée contre le backend local : Pedro OS,
  Bloc Sécurité est résolu vers le Bloc 20 réel, la route Codex est préparée,
  et `execution_allowed=false` est conservé.
- Une salutation envoyée ensuite a confirmé que cette mission n'était pas
  écrasée.

### Fichiers modifiés

- `src/openjarvis/server/personal_cockpit.py`
- `tests/server/test_personal_cockpit_observer.py`
- `PROJECT_BUILD_MAP.md`

### Tests

- Tests serveur ciblés : 11/11.
- Tests `hermes_core` policy/orchestrateur : 12/12.
- Smoke HTTP réel local : mission préparée sans validation ni exécution ;
  salutation sans nouvelle mission.

### Reste ouvert

- Rendre la confirmation de mission immédiatement visible dans G (Claude,
  fichier frontend isolé), puis relier le clic explicite à la préparation
  déjà existante de validation.

## Première délégation réelle depuis G — 2026-09-01, Bloc 08 Pedro

### Preuve d'exécution

- Ruth a explicitement préparé puis approuvé la mission Pedro / Bloc 08.
- Le routeur a lancé Codex en `review`, sandbox lecture seule. Le journal
  `runtime/hermes/sessions/latest.log` confirme `MISSION_TEST_RECU + TESTED`
  et `executed_by=codex`; aucun fallback Claude.
- Le résultat revient dans `last_execution` : proposition d'un LEGAL GATE
  DON serveur (décision spécifique, autorité vérifiée, attestation liée à
  l'objet et validation Pedro), sans modifier le code.

### Limite trouvée

- L'interface garde « Envoi… » pendant que la route HTTP attend la fin de
  l'agent. Le résultat est bien enregistré mais la requête bloque le backend
  local jusqu'à la fin. À corriger : délégation en tâche suivie (statut
  `running`/`completed`) plutôt qu'attente synchrone.

### Validation Ruth requise

- La proposition LEGAL GATE DON implique une attestation de cession. Il faut
  une validation juridique professionnelle avant usage réel ; aucun changement
  du flux métier ne doit être appliqué sur cette seule contre-revue.

## Correctif « Envoi… » bloquant — 2026-09-01

- Après l'approbation explicite de Ruth, l'agent est maintenant lancé dans une
  tâche suivie : la route HTTP répond immédiatement avec `execution_status:
  running` au lieu d'attendre toute la contre-revue.
- L'état est persisté dans `runtime/hermes/current_execution.json`, puis passe
  à `completed` ou `failed` avec résumé/erreur ; aucune tâche ne peut être
  créée par le chat seul.
- `/hermes/agents-status` expose ce statut pour le polling de G.

### Tests

- Tests serveur ciblés : 12/12, dont le démarrage non bloquant.
- Tests cœur policy/orchestrateur : 12/12.
- Compilation Python : OK.
- Smoke HTTP lecture seule : statut d'exécution exposé (`idle` sans tâche).

### À tester humainement

- Une prochaine mission explicitement approuvée doit afficher « mission
  envoyée » immédiatement ; Hermès doit rester réactif, puis le résultat doit
  apparaître sans rechargement manuel.

## Correctif G « Actualiser » — 2026-09-01

### Cause confirmée

- Le bouton rechargeait uniquement le snapshot général de l'accueil via
  `onRefresh()`. La carte locale mission/résultat conservait donc une ancienne
  validation, pouvant afficher « agent inconnu » alors qu'une exécution Codex
  était bien enregistrée côté serveur.

### Correctif et preuve

- `handleRefresh()` relit maintenant en parallèle le snapshot et
  `/hermes/proposed-mission` (`refreshProposedMission()`).
- Vérification HTTP réelle : le backend expose l'exécution terminée avec
  `execution_status=executed` et `executed_by=codex`.
- `npm run build` frontend : réussi.

### À tester humainement

- Dans G, cliquer **Actualiser** : la carte « Dernière exécution réelle » doit
  indiquer Codex et ne plus reprendre le texte de validation. Si la carte ne
  se met pas à jour, recharger une fois le navigateur puis signaler l'heure
  exacte du clic pour corréler les logs.

## Réconciliation mission/résultat et vérité des décisions — 2026-09-01

### Trouvé

- Une mission exécutée pouvait rester affichée comme « Mission proposée — rien
  n'est lancé » : le singleton de validation perdait parfois son `request_id`,
  alors que `mission_history` conservait l'identifiant, l'agent et le résultat.
- Le rapport libre de l'agent contenait « garde-fou DON validé par Ruth ».
  C'est faux : Ruth n'a pas validé ce garde-fou ; c'est une proposition issue
  de l'audit lecture seule.

### Correctif

- L'API prend désormais `mission_history` comme preuve par requête et retire
  la carte proposée quand son même `request_id` est déjà exécuté.
- G affiche un compte rendu d'agent, non une prétendue décision Ruth, et
  signale explicitement toute affirmation de validation Ruth non présente dans
  un registre de décisions.
- Claude a complété indépendamment le polling borné de G pendant une exécution
  asynchrone ; la compilation commune est réussie.

### Tests

- Régression serveur : 11/11.
- Compilation Python : OK.
- Build frontend : OK.
- Smoke HTTP réel : `has_mission=false`, dernière exécution
  `hermes-req-30a1ec2296bf`, `executed_by=codex`, affirmation non vérifiée
  signalée.

### À tester humainement

- Recharger G : la carte « Mission proposée » du Bloc 08 doit disparaître.
  Le compte rendu Codex doit rester, avec l'avertissement sur la fausse
  validation DON.

## Audit dashboard — 2026-09-01

- Serveur rapide : snapshot cockpit mesuré à ~20 ms ; la lenteur perçue ne
  vient pas de cette route.
- Un brief Hermès de mai 2026 était présenté comme priorité immédiate. Il est
  désormais traité comme périmé après 24 h ; G demande une priorité fraîche.
- La tuile « En attente » dit maintenant « décisions à consulter », distincte
  du bouton d'approbation technique sans validation active.
- Tests serveur 11/11 et build frontend OK.
## Bloc 02 — Projets issus du seul Project State publié (2026-09-01)

### Cause

La liste Niveau 2 utilisait `PROJECTS` (registre statique). Elle pouvait donc
montrer des projets non publiés et créer une fausse impression d'état réel.

### Correctif

`RuthOSPrototype` charge désormais `/v1/personal-cockpit/project-state` et
construit cette liste exclusivement à partir de ses `projects`. Le registre
local sert encore aux pages de détail après clic, pas à la liste elle-même.

### Preuve

- `npm run build` frontend : réussi.
- Appel HTTP réel : le serveur publie actuellement uniquement `Pedro OS`.

### À tester humainement

Dans G, ouvrir **Projets** : Pedro OS doit être le seul élément. Son détail
doit encore s'ouvrir ; aucun projet non publié ne doit être visible.
