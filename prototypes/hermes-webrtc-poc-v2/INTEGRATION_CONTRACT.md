# Contrat d'intégration G ↔ Hermès WebRTC V2

Ce document décrit le runtime réellement présent dans ce POC. Il ne propose
pas une API future et ne remplace pas le test humain microphone.

## But

G ouvre une session WebRTC persistante. Le navigateur envoie le flux micro en
continu ; le runtime détecte seul la fin de parole, transcrit, appelle le même
Hermès que G, répond oralement, puis réarme l'écoute. Le barge-in est une
conséquence du flux audio entrant : ce n'est pas une requête HTTP séparée.

## Ouverture de session

1. Le navigateur appelle `navigator.mediaDevices.getUserMedia({ audio: {
   echoCancellation: true, noiseSuppression: true, autoGainControl: true }})`.
2. Il crée un `RTCPeerConnection`, ajoute la piste micro et ouvre un data
   channel nommé `hermes-events`.
3. Il crée l'offre SDP puis appelle `POST /api/offer` avec :

```json
{ "sdp": "...", "type": "offer", "session_id": "g-session-stable" }
```

4. La réponse est l'answer SDP de WebRTC, plus `session_id`. G doit envoyer
   son identifiant stable de conversation comme `session_id`; sinon le runtime
   en crée un nouveau et la conversation vocale devient distincte de G.
5. Quand le data channel est ouvert, le navigateur envoie une seule fois :

```json
{ "type": "client-ready" }
```

Cela déclenche l'accueil. Des messages `ping:<timestamp>` sont seulement un
keepalive facultatif.

## Origine navigateur / ports

Le POC V2 est séparé de G (habituellement port 8790 vs 5173/8000). Il autorise
uniquement les origines locales explicites `localhost` et `127.0.0.1` sur ces
deux ports. Pour une autre origine de confiance, configurer au démarrage
`HERMES_PROTO_ALLOWED_ORIGINS` avec une liste d'origines séparées par des
virgules. `*` est volontairement refusé. G doit utiliser une base V2 explicite
(par exemple `http://127.0.0.1:8790` en développement), jamais supposer que
`/api/offer` pointe vers le serveur G.

## Flux reçu par G

Les messages du data channel sont des JSON :

```json
{ "type": "state", "state": "RECORDING", "detail": "Ruth parle" }
{ "type": "message", "role": "user", "text": "…", "confidence": 0.9 }
{ "type": "event", "name": "barge_in_start", "payload": { "reason": "assistant_busy" } }
```

États utiles : `LISTENING_ARMED`, `RECORDING`, `TRANSCRIBING`, `THINKING`,
`SPEAKING`, `COOLDOWN`, `LISTENING_AGAIN`. Les messages `message` doivent
alimenter la même conversation visuelle que G, sans renvoyer le texte à la
route chat une seconde fois : le runtime appelle déjà `/api/hermes/chat`.

Événements utiles : `user_speaking`, `user_speech_detected`,
`transcription_accepted`, `hermes_response_done`, `audio_play_start`,
`audio_play_end`, `barge_in_start`, `audio_output_interrupted`, `error`.

La piste audio distante arrive via `pc.ontrack`; G la joue dans un élément
`<audio>`. Sur `user_speaking` ou `barge_in_start`, G peut immédiatement
couper son rendu local (`pause`, piste distante désactivée), mais l'arrêt réel
du tour et la reprise d'écoute sont pilotés par le runtime.

## Interruption / barge-in

Il n'existe **pas** de `POST /interrupt`. Lorsque Ruth reparle pendant
`SPEAKING` ou `COOLDOWN`, le VAD côté runtime déclenche automatiquement :

`barge_in_start` → interruption audio → annulation du tour → `RECORDING`.

G ne doit donc ni arrêter/rallumer le micro à chaque phrase, ni inventer un
endpoint d'interruption. Le bouton unique sert seulement à démarrer ou quitter
la session complète.

## Fermeture

G ferme le data channel, le `RTCPeerConnection` et les pistes microphone. Le
runtime reçoit `on_client_disconnected` et ferme sa session. Il n'y a pas de
route HTTP de fermeture dans V2.

## Limites vérifiées

- `/api/proto/hermes/chat` renvoie volontairement 501 : ce n'est pas le chemin
  d'intégration.
- Le POC est encore isolé sur son propre port et doit être démarré pour être
  utilisé par G.
- Les tests automatisés prouvent le contrat logique ; le test navigateur avec
  vrai micro reste obligatoire pour valider VAD, TTS et barge-in.
