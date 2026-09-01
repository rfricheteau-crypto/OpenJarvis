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
