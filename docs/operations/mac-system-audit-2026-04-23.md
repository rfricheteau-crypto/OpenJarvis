# Audit systeme local Mac - 2026-04-23

Audit en lecture seule realise le 2026-04-23 vers 17:03-17:20 CEST.

## Diagnostic court

- Cause disque la plus probable: logs Mail Apple/Yahoo dans `~/Library/Containers/com.apple.mail/Data/Library/Logs/Mail`, environ 42 Go, dont un fichier IMAP de 40 Go modifie le 2026-04-23.
- Deuxieme cause disque majeure: temporaires Messages dans `~/Library/Containers/com.apple.MobileSMS/Data/tmp`, environ 25 Go, avec 101 copies d'une meme video `Joyeux Anniversaire Tamera.mp4` de 249 Mo.
- Facteur aggravant: volume Data presque plein, 194 GiB utilises sur 228 GiB, seulement 12 GiB disponibles, capacite 95%.
- Cause memoire probable: pas de processus actuellement enorme observe, mais historique de swap tres eleve et disque quasi plein. Quand macOS manque de RAM, un disque a 95% rend le swap/compression beaucoup plus vulnerable aux blocages.

## Memoire et processus observes

- RAM physique: 8 GiB.
- `vm_stat`/`memory_pressure`: nombreux swapins/swapouts historiques; pression actuelle pas critique au moment de l'audit.
- Load averages au lancement: 1.92 / 13.12 / 27.53, signe d'un episode charge juste avant ou encore en decroissance.
- Plus gros processus RSS observes:
- `Terminal.app`: ~301 Mo RSS, CPU ~17-21%.
- `Spotlight.app`: ~189 Mo RSS.
- `corespotlightd`: ~135 Mo RSS.
- `codex`: ~123-126 Mo RSS.
- `npm exec @zethictech/obsidian-mcp`: ~123 Mo RSS.
- `node ... obsidian-mcp`: ~56 Mo RSS.
- `ollama serve`: ~10 Mo RSS.
- Aucun `ffmpeg`, `whisper`, gros `python`, gros `node`, Chrome lourd ou Claude lourd n'a ete observe en RAM au moment de l'audit.

## Disque - masses principales

| Chemin | Taille | Nature | Risque | Recommandation |
|---|---:|---|---|---|
| `/Users/ruthpierre/Library/Containers/com.apple.mail/Data/Library/Logs/Mail` | 42G | Logs Mail Yahoo | Faible a moyen | Quarantaine puis suppression apres validation; verifier/desactiver le logging Mail. |
| `/Users/ruthpierre/Library/Containers/com.apple.mail/Data/Library/Logs/Mail/imap.mail.yahoo.com-B3AFCBB3-8D86-4CA5-B513-20929470986F.txt` | 40G | Log IMAP Yahoo | Faible | Candidat prioritaire: log technique, pas un mail. |
| `/Users/ruthpierre/Library/Containers/com.apple.MobileSMS/Data/tmp` | 25G | Temporaires Messages | Moyen | Quarantaine prudente, surtout les duplicats video. |
| `/Users/ruthpierre/Library/Containers/com.apple.MobileSMS/.../Joyeux Anniversaire Tamera.mp4` | 101 x 249M | Copies temporaires d'une video | Moyen | Quarantaine des copies temporaires, garder une copie si besoin. |
| `/Users/ruthpierre/Downloads` | 13G | Telechargements | Variable | Classer; ne pas supprimer automatiquement. |
| `/Users/ruthpierre/Downloads/IMG_2308.MOV` | 9.3G | Video personnelle probable | Eleve | Archiver/deplacer si a garder; ne pas supprimer sans validation. |
| `/Users/ruthpierre/Library/Application Support/Claude/vm_bundles` | 7.7G | Donnees Claude VM | Moyen | A valider; peut etre recreable mais lie a Claude. |
| `/Users/ruthpierre/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel` | 4.0G | Modele Chrome on-device | Faible a moyen | Nettoyage possible si Chrome ferme; Chrome peut retélécharger. |
| `/Users/ruthpierre/.npm` | 2.9G | Cache/npm npx | Faible | Nettoyage cache possible; recreable. |
| `/Users/ruthpierre/.npm/_npx` | 1.7G | Executions npx temporaires | Faible | Nettoyable apres validation. |
| `/Users/ruthpierre/.npm/_cacache` | 1.2G | Cache npm | Faible | Nettoyable via `npm cache clean --force` ou quarantaine. |
| `/Users/ruthpierre/.cache/uv` | 909M | Cache uv/python | Faible | Nettoyable; recreable. |
| `/Users/ruthpierre/Library/Caches/Google/Chrome` | 2.0G | Cache Chrome | Faible | Nettoyable si Chrome ferme. |
| `/Users/ruthpierre/Library/Caches/Homebrew/downloads` | 785M | Cache Homebrew | Faible | Nettoyable via `brew cleanup -s`. |
| `/Users/ruthpierre/Library/Caches/com.microsoft.VSCode.ShipIt` | 777M | Cache update VS Code | Faible | Nettoyable si VS Code ferme. |
| `/var/folders/jd/25lfydtd11q47p5zv9870cg00000gn/T/com.microsoft.VSCode.ShipIt.*` | 3 x 777M | Restes update VS Code | Faible | Nettoyable/quarantaine si VS Code ferme. |
| `/Users/ruthpierre/Jarvis/OpenJarvis/rust/target` | 1.3G | Build Rust | Faible | Nettoyable; reconstruit par Cargo. |
| `/Users/ruthpierre/Jarvis/OpenJarvis/.venv` | 741M | Environnement Python | Moyen | Garder sauf si regeneration voulue. |
| `/Users/ruthpierre/Jarvis/OpenJarvis/frontend/node_modules` | 367M | Dependances Node | Faible a moyen | Nettoyable; reinstall necessaire. |

## Downloads - classement propose

### A garder ou archiver

- `IMG_2307.MOV` 1.9G, `IMG_2308.MOV` 9.3G, `IMG_2309.MOV` 374M, `IMG_2310.MOV` 139M: videos personnelles probables. Archiver hors Downloads ou disque externe/cloud avant suppression locale.
- `PDFs/Modifichien.pdf` 183M et documents administratifs/SCI: a archiver par dossier, pas a supprimer sans revue.
- PDFs medicaux/administratifs visibles: `Ordonnance...pdf`, `Alerte de securite.pdf`, attestations, EDF, cotations: garder ou archiver.

### Probablement supprimable apres validation

- Installateurs dupliques Claude: `Installers/Claude.dmg`, `Installers/Claude (1).dmg`, `Duplicates_To_Review/Claude (2).dmg`, `Duplicates_To_Review/Claude (3).dmg`, `Installateurs/Claude.dmg` (~1.15G total).
- `Obsidian-1.12.7.dmg` 203M si Obsidian est installe.
- `Installateurs/Zoom.pkg` 53M si Zoom est installe.
- `.DS_Store`.

### A securiser

- `adv-dev-pour-test-firebase-adminsdk-*.json` et `adv-prod-471420-a9100a41cd42.json`: fichiers de credentials probables. Ne pas laisser dans Downloads. A deplacer en coffre/secret manager ou quarantaine securisee, pas supprimer sans rotation/validation.

### Ambigu

- `Complétez_avec_Docusign Mandat*.pdf/.zip`: doublons apparents mais document contractuel possible; garder un exemplaire valide, archiver le reste apres verification.
- `ADV_Claude_Pack*`, `copy-of-fieldflow-dashboard (1)`, `Jarvis_A_Donner`: petits, contexte projet; archiver plutot que supprimer.

## Actions recommandees

### Bloc 1 - actions sures immediates

- Fermer Mail puis verifier que l'option de journalisation/Connection Doctor n'est pas active dans Mail.
- Fermer Messages si possible avant traitement des temporaires.
- Redemarrer apres liberation d'espace pour purger une partie des temporaires et stabiliser swap/memoire.
- Garder au moins 30-40 Go libres sur ce Mac 8 Go RAM; sous 15 Go libres, les freezes deviennent probables.

### Bloc 2 - nettoyage a valider

- Mettre en quarantaine les logs Mail Yahoo de 42G.
- Mettre en quarantaine les temporaires Messages de 25G, ou au minimum les 101 copies temporaires de la video.
- Nettoyer caches recreables: Chrome cache 2.0G, Homebrew downloads 785M, VS Code ShipIt 2.3G temp + 777M cache, npm 2.9G, uv 909M.
- Deplacer les gros MOV de Downloads vers archive, pas suppression directe.
- Supprimer/quarantainer les DMG/PKG dupliques apres confirmation.

### Bloc 3 - prevention

- Ajouter une verification hebdomadaire: espace disque, top containers, top caches, top Downloads.
- Surveiller `~/Library/Containers/com.apple.mail/Data/Library/Logs/Mail` et alerter si >1G.
- Eviter de laisser `Downloads` comme stockage permanent; creer `Archive_A_Trier` mensuel.
- Pour OpenJarvis: nettoyer `rust/target` ponctuellement et eviter plusieurs environnements `.venv/node_modules` inutilises.

## Scripts prepares

- `scripts/maintenance/quarantine_mac_pressure_candidates.sh`: simulation par defaut; avec `--execute`, deplace les gros candidats vers une quarantaine datee.
- `scripts/maintenance/safe_cache_cleanup_dryrun.sh`: simulation par defaut; avec `--execute`, nettoie uniquement des caches recreables selectionnes.

Ne pas executer avec `--execute` sans validation explicite.

## Execution validee - 2026-04-23 17:19-17:28

Validation utilisateur recue. Execution ciblee realisee, sans toucher a `Downloads`.

### Resultat disque

- Avant execution: volume Data a 203756180 KiB utilises, 12391400 KiB disponibles, 95%.
- Apres execution: volume Data a 164103524 KiB utilises, 52044056 KiB disponibles, 76%.
- Espace effectivement recupere selon `df`: 39652656 KiB, soit environ 37.8 GiB.

### Mail

- Trois logs Mail/Yahoo >100M ont ete deplaces vers `/Users/ruthpierre/Jarvis_Quarantine/mac_pressure_20260423-171911/mail_logs` puis compresses.
- `imap.mail.yahoo.com-6D898C25-643A-4BC3-B073-FF304FA6A7F8.txt`: 656M -> 58M `.gz`.
- `imap.mail.yahoo.com-B3AFCBB3-8D86-4CA5-B513-20929470986F.txt`: 40G -> 10G `.gz`.
- `smtp.mail.yahoo.com-6E447C3B-675F-4A4D-ADD2-701D63547D2C.txt`: 744M -> 547M `.gz`.
- Dossier Mail logs residuel: 1.4M.

### Messages

- 101 copies temporaires de `Joyeux Anniversaire Tamera.mp4` trouvees dans `~/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS`.
- Hash SHA-256 commun: `dea4e092472ae29174a283bcc050a45c83ab1705dd058ebea34ba78b55c40dd9`.
- Une copie conservee: `/Users/ruthpierre/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS/LinkedFiles/23DFA9D1-52CE-4A31-983B-7EAF4E8F8DCE/Joyeux Anniversaire Tamera.mp4`.
- 100 doublons exacts temporaires retires.
- Dossier Messages tmp residuel: 442M.
- Manifestes conserves dans `/Users/ruthpierre/Jarvis_Quarantine/mac_pressure_20260423-172557/messages_tmp_duplicate_manifest`.

### Caches recreables nettoyes

- `~/.npm/_npx`: 1.7G.
- `~/.npm/_cacache`: 1.2G.
- `~/.cache/uv`: 909M.
- `~/Library/Caches/Google/Chrome`: 2.0G.
- `~/Library/Caches/com.microsoft.VSCode.ShipIt`: 777M.
- `~/Library/Caches/Homebrew/downloads`: 785M.
- `/var/folders/jd/25lfydtd11q47p5zv9870cg00000gn/T/com.microsoft.VSCode.ShipIt.*`: trois dossiers de 777M environ plus dossiers vides.

### Journaux

- Mail/quarantaine: `logs/maintenance/mac_pressure_cleanup_20260423-171911.log` (arret apres Mail a cause d'une erreur de syntaxe corrigee ensuite).
- Reprise Messages/caches: `logs/maintenance/mac_pressure_cleanup_20260423-172557.log`.

## Deuxieme audit espace - 2026-04-23

Regle media appliquee: voir `docs/operations/media-cleanup-governance.md`.

### Etat apres premier nettoyage

- Volume Data: 157 GiB utilises, 50 GiB libres, 76%.

### Gros postes restants

- `/Users/ruthpierre/Library/Application Support/Claude/vm_bundles/claudevm.bundle/rootfs.img`: 10,737,418,240 octets, donnees techniques Claude VM, sensible pour Claude mais non personnel.
- `/Users/ruthpierre/Jarvis_Quarantine/mac_pressure_20260423-171911`: 11G, logs Mail Yahoo compresses, supprimable apres validation si diagnostic termine.
- `/Users/ruthpierre/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel/2025.8.8.1141/weights.bin`: 4,269,932,544 octets, modele Chrome on-device, recreable.
- `/Users/ruthpierre/.local/share/llama.cpp/models/Qwen3-4B/Qwen_Qwen3-4B-Q4_K_M.gguf`: 2,497,280,960 octets, modele local Jarvis/LLM, a arbitrer.
- `/Users/ruthpierre/n8n-boost/n8n-mcp/node_modules`: 2.3G, dependances Node recreables.
- `/Users/ruthpierre/n8n-boost/haunchen-n8n-skills/node_modules`: 2.2G, dependances Node recreables.
- `/Users/ruthpierre/Jarvis/OpenJarvis/rust/target`: 1.3G, build Rust recreable.
- `/Users/ruthpierre/Downloads/IMG_2308.MOV`: 9,999,846,223 octets, media personnel probable, a verifier, non supprimable automatiquement.
- `/Users/ruthpierre/Downloads/IMG_2307.MOV`: 2,020,413,604 octets, media personnel probable, a verifier, non supprimable automatiquement.
- `/Users/ruthpierre/Downloads/IMG_2309.MOV`: 392,422,537 octets, media personnel probable, a verifier, non supprimable automatiquement.
- `/Users/ruthpierre/Downloads/IMG_2310.MOV`: 145,609,473 octets, media personnel probable, a verifier, non supprimable automatiquement.

### Audit medias cible

- `IMG_2307.MOV`, `IMG_2308.MOV`, `IMG_2309.MOV`, `IMG_2310.MOV`: pas de doublon exact detecte dans les zones scannees; medias personnels probables, probablement recuperables dans Google Photos si synchronises, a verifier avant toute suppression locale.
- `/Users/ruthpierre/Library/Messages/Drafts/+33687517023/Attachments/DC8DDE78-AA7F-4365-8502-EFE21DA665D9/Joyeux Anniversaire Tamera.mp4`: 260,695,114 octets, media Messages, copie de reference probable.
- `/Users/ruthpierre/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS/LinkedFiles/23DFA9D1-52CE-4A31-983B-7EAF4E8F8DCE/Joyeux Anniversaire Tamera.mp4`: 260,695,114 octets, doublon exact temporaire du draft Messages, hash `dea4e092472ae29174a283bcc050a45c83ab1705dd058ebea34ba78b55c40dd9`; candidat quarantaine/suppression apres validation en gardant le draft.
- `/Users/ruthpierre/Library/Containers/com.apple.MobileSMS/Data/tmp/TemporaryItems/com.apple.MobileSMS/Media/B5581ECE-F760-4962-918A-057C3CF3AFED/invideo-ai-1080 Decouvre la Puissance de la Numerologie 2025-05-31.mp4`: 121,422,516 octets, temporaire Messages/export non personnel probable, candidat quarantaine apres validation.

### Installers et archives

- Trois DMG Claude exacts ont le meme hash `0b8c7a20916031a1084d8e87c4764033244f04b73bbb322fe1b437b446f66964`: `Downloads/Installers/Claude (1).dmg`, `Downloads/Duplicates_To_Review/Claude (2).dmg`, `Downloads/Duplicates_To_Review/Claude (3).dmg`.
- Autres installateurs non dupliques exacts mais probablement recreables: `Downloads/Installers/Claude.dmg`, `Downloads/Installateurs/Claude.dmg`, `Downloads/Obsidian-1.12.7.dmg`, `Downloads/Installateurs/Zoom.pkg`.

## Deuxieme nettoyage valide - 2026-04-23 17:43-17:45

Validation utilisateur recue. Execution realisee avec exclusions explicites: pas de modification de `Claude/vm_bundles`, du modele Chrome `OptGuideOnDeviceModel`, du modele Qwen local, des PDFs, ni des credentials JSON.

### Resultat disque

- Avant execution: volume Data a 156 GiB utilises, 50 GiB libres, 76%.
- Apres execution: volume Data a 126 GiB utilises, 80 GiB libres, 62%.
- Gain visible: environ 30 GiB.

### Supprime definitivement

- `/Users/ruthpierre/Jarvis_Quarantine/mac_pressure_20260423-171911`: 11G, anciens logs Mail compresses.
- `/Users/ruthpierre/Downloads/IMG_2308.MOV`: 9.3G.
- `/Users/ruthpierre/Downloads/IMG_2307.MOV`: 1.9G.
- `/Users/ruthpierre/Downloads/IMG_2309.MOV`: 374M.
- `/Users/ruthpierre/Downloads/IMG_2310.MOV`: 139M.
- `/Users/ruthpierre/Library/Caches/com.openai.atlas`: 846M.
- `/Users/ruthpierre/Library/Caches/typescript`: 170M.
- `/Users/ruthpierre/Library/Caches/node-gyp`: 53M.
- `/Users/ruthpierre/Library/Application Support/Google/GoogleUpdater/crx_cache`: 695M.
- `/Users/ruthpierre/Library/Application Support/Code/CachedExtensionVSIXs`: 437M.
- `/Users/ruthpierre/Jarvis/OpenJarvis/rust/target`: 1.3G.
- `/Users/ruthpierre/n8n-boost/n8n-mcp/node_modules`: 2.3G.
- `/Users/ruthpierre/n8n-boost/haunchen-n8n-skills/node_modules`: 2.2G.

### Mis en quarantaine

Quarantaine: `/Users/ruthpierre/Jarvis_Quarantine/second_pass_20260423-174309`, taille finale 1.5G.

- Trois DMG Claude doublons exacts: `Claude (1).dmg`, `Claude (2).dmg`, `Claude (3).dmg`, 236M chacun.
- Installateurs recreables: `Claude.dmg` 208M, `Obsidian-1.12.7.dmg` 203M, `Zoom.pkg` 53M.
- Temporaire Messages doublon: `Joyeux Anniversaire Tamera.mp4` 249M.
- Temporaire Messages parasite: `invideo-ai-1080 Decouvre la Puissance de la Numerologie 2025-05-31.mp4` 116M.

Note: deux installateurs distincts `Claude.dmg` avaient le meme nom de destination dans la quarantaine `installers_recreable`; le dernier de 208M est celui conserve en quarantaine. Le premier de 236M etait un installateur recreable et n'est plus present.

### Verification medias Messages

- Copie de reference conservee: `/Users/ruthpierre/Library/Messages/Drafts/+33687517023/Attachments/DC8DDE78-AA7F-4365-8502-EFE21DA665D9/Joyeux Anniversaire Tamera.mp4`.
- Hash conserve: `dea4e092472ae29174a283bcc050a45c83ab1705dd058ebea34ba78b55c40dd9`.
- Aucun `invideo-ai*.mp4` restant dans les temporaires Messages scannes.

### Audit Claude vm_bundles

- Dossier: `/Users/ruthpierre/Library/Application Support/Claude/vm_bundles`, taille disque 7.7G.
- Contenu principal: `claudevm.bundle/rootfs.img`, taille logique 10,737,418,240 octets, blocs reels environ 7.7G, modifie le 2026-04-23 16:22.
- Type detecte: image disque avec table de partition GPT/MBR protective.
- Fichiers associes: `sessiondata.img` 49,651,712 octets, `efivars.fd` 131,072 octets, identifiants reseau/machine (`vmIP`, `machineIdentifier`, `macAddress`, `gvisorMacAddress`), `.rootfs.img.origin` = `5680b11bcdab215cccf07e0c0bd1bd9213b0c25d`.
- Interpretation: bundle de machine virtuelle Claude locale. Sert probablement a l'environnement local/sandbox Claude, distinct du repo OpenJarvis et de Codex, mais lie a Claude Desktop/Claude local.
- Risque suppression: moyen a eleve pour Claude local; peut forcer Claude a reconstruire/retélécharger une VM, perdre l'etat de session VM, ou casser temporairement des fonctions locales.
- Possibilite de recreation: probable par Claude, mais non garantie sans relance/telechargement; a tester seulement quand Claude local n'est pas critique.
- Recommandation actuelle: garder pour l'instant. Si besoin d'espace plus tard, deplacer en quarantaine hors `Application Support` quand Claude est ferme, tester Claude, puis supprimer la quarantaine apres validation.
