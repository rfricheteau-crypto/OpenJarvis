# Audit Codex — orchestration Hermès, preuve bout en bout

Date : 2026-08-31

## Verdict simple

L'orchestration n'est **pas automatique depuis une phrase de chat**, mais le
chemin contrôlé complet existe et vient d'être prouvé : après les gestes
explicites « Préparer l'exécution » puis « Approuver », Hermès a lancé un
processus Codex séparé, reçu son résultat et écrit une preuve dans le Bloc 20
Pedro.

## Chaîne réelle

| Flèche | Verdict | Preuve |
|---|---|---|
| Ruth → Hermès | ✅ | POST local `/v1/personal-cockpit/chat` : 200, 1,99 s. |
| Hermès → mission | 🟠 | `current_mission.json` créé, projet Pedro / bloc 20 résolu ; l'observateur classe cependant à tort cette phrase comme domaine JARVIS / `system_mapping`. |
| Mission → Codex | 🟠 | **Pas automatique** : le chat reste `observation_only` avec `observed_not_delegated`. Après `prepare-execution` + approbation explicite, le pont lance réellement Codex. |
| Codex reçoit | ✅ | `bridge-events.jsonl`, request `5969daad-8318-431a-952b-28d13f34da67` : `start` puis `end`, `exit_code: 0`, 37 793 ms, projet `pedro-os`. C'est un processus Codex CLI séparé, pas cette conversation interactive. |
| Codex → résultat | ✅ | résultat réel : `MISSION_TEST_RECU + TESTED`, écrit dans `current_delegation.json`, `recent_trace.jsonl` et `validation_state.json`. |
| Résultat → Hermès | ✅ | événement `delegation_result_logged`, status `executed`, présent dans `core_state.json`. |
| Hermès → projet/bloc | ✅ | `Pedro-OS/PROJECT_BUILD_MAP.md` Bloc 20 contient `DERNIÈRE REVUE HERMES — 2026-08-31 — Consultation agent réelle ... MISSION_TEST_RECU + TESTED`. |

## Test contrôlé effectué

Mission sans écriture : relire uniquement le titre et le statut du Bloc 20
Pedro, puis répondre `MISSION_TEST_RECU + le statut`.

1. Chat Hermès : réponse locale `MISSION_TEST_RECU | BLOCK_20 | TEST |
   SUCCESS`; en parallèle, mission structurée écrite dans le runtime.
2. Préparation explicite : validation créée avec
   `mission_request_id=hermes-req-251cadb6b7e2`.
3. Approbation explicitement autorisée par Ruth pour ce test lecture seule.
4. Routeur : Codex réellement lancé et terminé avec succès en 37,793 s.
5. Retour : `MISSION_TEST_RECU + TESTED`, journalisé et réintégré dans le
   Bloc 20 sans le déclarer `DONE`.

## Ce que signifie « Bloc 05 — Orchestration Hermès »

Oui : c'est le moteur concerné. Il réunit `decision_engine.py`, `mission.py`,
`agent_bridge.py`, la policy et le routeur partagé. Sa conception actuelle
est volontairement en deux temps :

1. chat → **observation / proposition de mission** ;
2. geste Ruth → préparation → validation → exécution bornée → résultat.

Il ne faut donc pas annoncer « délégation automatique » : elle n'existe pas
encore depuis une simple phrase, par choix de sûreté.

## Écarts réels trouvés

1. **Classification erronée** : une demande explicitement Pedro peut être
   classée `JARVIS/system_mapping` parce que le mot « Hermès » biaise le
   classifieur, bien que `project_context` résolve correctement Pedro/20.
2. **UX trompeuse, corrigée dans le code Claude pendant cet audit** : le
   premier appel `/hermes/validate` répondait « Aucune action externe » alors
   que Codex venait d'être lancé. Le code actuel maintient `executed_flag` et
   affiche l'agent exécutant ; à contre-tester lors du prochain envoi.
3. **Cycle de validation incohérent** : le journal enregistre
   `result_logged` puis `approved`, laissant le résumé final au statut
   `approved_for_handoff` malgré une exécution réussie. C'est une donnée de
   suivi incorrecte, pas un échec de l'agent.
4. **Preuve de session** : Claude vient d'ajouter
   `runtime/hermes/sessions/latest.log` et l'endpoint de lecture associé.
   Il est disponible pour le prochain test ; le test contrôlé précédent est
   prouvé par le journal append-only du pont et les fichiers runtime.

## Tests

- Test HTTP réel chat → préparation → approbation → agent → résultat : OK.
- `pytest` ciblé : 8/8 réussis, dont observation-only et refus si mission
  changée entre préparation et approbation.
- Aucun fichier métier Pedro n'a été modifié par l'agent de test, hormis la
  ligne de preuve attendue dans le Bloc 20.

## Ce qui reste ouvert

- Correction Codex livrée : le classifieur connaît désormais `PEDRO` avant
  `JARVIS`, donc « Hermès, sur Pedro OS… » reste dans le domaine Pedro. Test
  de régression ajouté et suite orchestrator+approval : **15/15**. Serveur
  live rechargé et contre-test HTTP réel : `GET /health` 200 en 0,010 s ;
  même phrase chat → `classified_domain: PEDRO`.
- Corriger l'ordre et le statut final du cycle de validation.
- Contre-tester une seconde mission lecture seule après le correctif UI
  Claude pour vérifier l'affichage de l'agent et le transcript de session.
- Décider séparément si Ruth veut, un jour, une délégation réellement
  automatique : ce serait une extension de permissions, pas un correctif.

## Fichiers modifiés par cet audit

- Ce handoff uniquement. Les autres modifications observées durant l'audit
  sont le travail Claude dans `personal_cockpit.py` et le travail Pedro
  antérieur de Codex ; aucun changement d'architecture effectué ici.
- Après répartition explicite avec Claude :
  - `/Users/ruthpierre/.openjarvis/jarvis-personal/hermes_core/orchestrator/decision_engine.py`
  - `/Users/ruthpierre/.openjarvis/jarvis-personal/hermes_core/orchestrator/tests/test_orchestrator.py`

## Prochaine action recommandée

Claude corrige l'état final de validation ; Codex contre-testera ensuite son
retour visible dans G avec une nouvelle mission lecture seule.

## Validation Ruth attendue

Aucune pour le diagnostic. Si Ruth veut une délégation depuis une simple
phrase sans les boutons de préparation/appobation, elle devra valider ce
changement de niveau d'autonomie explicitement.
