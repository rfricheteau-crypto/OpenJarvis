# Hermès — réconciliation fidèle au pont lecture seule

## Résultat

- Cause racine confirmée : les adaptateurs `codex.sh` et `claude.sh` du pont
  Hermès exécutent tous leurs appels en lecture seule (`--sandbox read-only`
  et `--permission-mode plan`). Une délégation approuvée est donc une
  **contre-revue**, jamais une écriture de projet.
- Le backend distingue désormais explicitement `review_completed` de
  `completed_sync`. Un rapport de revue ne peut plus retirer un élément de
  `Manque`, modifier un Build Map ou apparaître comme un travail produit.
- La future boucle d'écriture reste protégée : elle exige une capacité
  explicite `controlled_write`, un résultat `RUTHOS_RESULT_JSON`, un état
  avant mission, le rescan de la source, puis la réconciliation. Sans cela :
  `sync_failed` avec le message demandé par Ruth.
- Les sources de blocs restent uniques : `project_blocks.py` relit les vrais
  Build Maps / checklist ADV. Aucun cache ou pourcentage manuel n'est ajouté.
- L'UI distingue maintenant « contre-revue lecture seule », « synchronisation
  réussie » et « synchronisation échouée » ; elle ne rafraîchit le bloc que
  pour `completed_sync`.

## Tests

- `uv run pytest tests/server/test_personal_cockpit_observer.py tests/server/test_project_blocks_reconciliation.py -q` → **21 passed**.
- `python3 -m unittest CORE.tests.test_build_map_result` → **4 passed**.
- `npm run build` dans `OpenJarvis/frontend` → **OK**.
- Endpoint réel `GET /v1/personal-cockpit/hermes/agents-status` → **200**,
  et confirme que la précédente mission ADV est `failed / approval_required`,
  donc n'a jamais été exécutée.

## Fichiers modifiés

- `/Users/ruthpierre/Jarvis/OpenJarvis/src/openjarvis/server/personal_cockpit.py`
- `/Users/ruthpierre/Jarvis/OpenJarvis/frontend/src/prototypes/ruthos/RuthOSPrototype.tsx`
- `/Users/ruthpierre/Jarvis/OpenJarvis/tests/server/test_personal_cockpit_observer.py`
- `/Users/ruthpierre/Jarvis/OpenJarvis/tests/server/test_project_blocks_reconciliation.py`
- `/Users/ruthpierre/.openjarvis/jarvis-personal/project_blocks.py`
- `/Users/ruthpierre/.openjarvis/jarvis-personal/hermes_core/api.py`
- `/Users/ruthpierre/.openjarvis/jarvis-personal/hermes_core/orchestrator/agent_bridge.py`
- `/Users/ruthpierre/.openjarvis/jarvis-personal/hermes_core/state/session_state.py`
- `/Users/ruthpierre/CODEX_RUTH_OS/CORE/bridge/build_map_result.py`
- `/Users/ruthpierre/CODEX_RUTH_OS/CORE/tests/test_build_map_result.py`
- `/Users/ruthpierre/CODEX_RUTH_OS/A_VALIDER_PAR_RUTH.md` (fausse alerte ADV
  `.env` retirée après vérification `ROUTER_DOCTOR_OK`, sans secret lu)

## Ce qui reste ouvert

1. Un vrai chemin `controlled_write` n'existe pas et ne doit pas être créé
   sans chantier sécurité séparé et validation Ruth.
2. Les Build Maps canoniques historiques sont surtout narratifs, sans items
   atomiques. La réconciliation automatique ne doit donc pas réécrire leur
   prose ; elle restera en échec explicite tant qu'un format d'items, validé
   par Ruth, ne sera pas introduit dans la même source.
3. Test humain G : envoyer une mission de revue et vérifier l'étiquette
   « Contre-revue terminée — aucun changement projet appliqué. ».

## Risques

- Ne jamais requalifier `review_completed` en `completed_sync` dans l'UI ou
  dans l'historique : ce serait réintroduire la fausse promesse corrigée ici.
- Pas de commit ni push : les worktrees Jarvis et Ruth OS contiennent des
  changements multi-agent non liés.

## Prochaine action recommandée

Faire un test humain d'une contre-revue Hermès et confirmer que la carte du
bloc ne bouge pas ; ensuite, concevoir séparément le cadre de sécurité d'un
futur écrivain contrôlé si Ruth le veut.

## Validation Ruth attendue

Ruth souhaite-t-elle garder Hermès en contre-revue/synchronisation humaine
pour l'instant, ou ouvrir plus tard un chantier dédié « écrivain contrôlé » ?
