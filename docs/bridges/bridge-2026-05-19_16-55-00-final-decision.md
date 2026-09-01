# Bridge final — décision vocale Ruth — 2026-05-19 16:55

## Décision retenue

La base vocale à garder est :

- `prototypes/hermes-webrtc-poc-v2/`

La page principale Jarvis :

- `frontend/src/pages/JarvisPersonalPage.tsx`

ne doit plus être traitée comme base proto vocale.

---

## Pourquoi

### Ce qui a été validé

Le proto V2 isolé sur `http://127.0.0.1:8790/web/` a été revalidé en test réel :

- le micro est capté
- `user_speech_detected` part bien
- la transcription revient
- Kokoro répond
- une seule voix
- fluidité meilleure après les derniers réglages

Retour utilisateur final :

- `oui c'est mieux`

### Ce qui a échoué comme base

La page principale Jarvis a cumulé :

- pipeline navigateur fragile
- double sortie audio possible
- boucle d’écoute continue instable
- ressenti moins fluide que le proto simple

Conclusion :

- la page principale reste un chantier UI/intégration
- le proto V2 est la seule base voix actuellement validée

---

## Corrections importantes conservées

### 1. Page principale Jarvis

Fichier :
- `frontend/src/pages/JarvisPersonalPage.tsx`

Corrections gardées :
- `audio.pause()` dans `audio.onerror`
- plus de fallback automatique vers `speechSynthesis` quand la voix locale est préférée

But :
- éviter la double voix locale / navigateur

### 2. Proto V2

Fichier :
- `prototypes/hermes-webrtc-poc-v2/src/hermes_webrtc_poc/runtime.py`

Réglages gardés :
- VAD plus tolérant
- cooldown anti-écho raccourci
- guard post-TTS raccourcie
- pré-roll micro
- salutation locale rapide (`bonjour Hermès` etc.)

But :
- retrouver un ressenti plus proche du proto fluide d’origine

---

## Recommandation produit/technique

### À faire maintenant

1. figer `hermes-webrtc-poc-v2` comme proto voix officiel
2. arrêter de tester la voix sur `JarvisPersonalPage.tsx`
3. préparer ensuite une intégration propre de V2 dans l’UI Jarvis

### À ne plus faire

- ne plus corriger la voix “au fil de l’eau” dans la page principale
- ne plus mélanger pipeline navigateur principal et proto WebRTC pendant les validations

---

## Prochaine étape recommandée

Une fois ce commit posé :

### Option la plus sûre

Utiliser temporairement :

- `http://127.0.0.1:8790/web/`

comme interface voix officielle de test.

Puis, dans un second chantier séparé :

- intégrer ce runtime V2 dans l’UI Jarvis
- sans réintroduire le vieux pipeline navigateur comme moteur voix principal

---

## Test de validation finale retenu

Test réussi côté V2 isolé :

1. ouvrir `http://127.0.0.1:8790/web/`
2. cliquer `Activer la conversation`
3. attendre la fin du bonjour
4. dire `bonjour Hermès`

Résultat observé :

- V2 entend la voix
- transcrit correctement
- répond avec Kokoro
- une seule voix
- ressenti meilleur qu’avant les derniers réglages

---

## Mise à jour Codex — 2026-05-30 fermeture terminal

### Décision toujours active

La voix officielle reste :

- `http://127.0.0.1:8790/web/`
- code source : `prototypes/hermes-webrtc-poc-v2/`

### Intégration UI ajoutée

Commit Jarvis :

- `011d912 feat(ui): link Jarvis personal page to validated voice v2`

Fichier modifié :

- `frontend/src/pages/JarvisPersonalPage.tsx`

Effet :

- ajout d’un encart **Voix recommandee**
- ajout d’un bouton **Ouvrir Voix V2**
- arrêt de la capture micro locale avant ouverture de V2
- arrêt de la lecture/parole locale avant ouverture de V2
- aucun retour à l’ancien pipeline voix navigateur comme base officielle

### État Git au moment de la passation

- branche locale : `main`
- état : `main...origin/main [ahead 23]`
- non poussé
- fichiers non trackés laissés volontairement hors commit :
  - `docs/agents/`
  - plusieurs fichiers `docs/bridges/bridge-2026-05-19_*`

### Test à faire à la reprise

1. Ouvrir `/jarvis-personal`.
2. Cliquer **Ouvrir Voix V2**.
3. Vérifier que `http://127.0.0.1:8790/web/` s’ouvre.
4. Vérifier que l’ancienne page ne garde pas une capture micro ou une parole active en parallèle.

### Ne pas faire sans validation Ruth

- pousser les 23 commits locaux
- supprimer ou classer les bridges non trackés
- relancer un refactor profond de la voix dans `JarvisPersonalPage.tsx`
- réactiver le pipeline navigateur comme moteur voix principal
