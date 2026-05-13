# Gouvernance nettoyage medias personnels

Regle durable ajoutee le 2026-04-23.

## Principe

Tout fichier photo ou video personnel est sensible. Google Photos peut etre synchronise automatiquement, mais cela ne suffit jamais a autoriser une suppression locale sans verification explicite.

## Classification obligatoire

Chaque gros media personnel detecte doit etre classe dans une des categories suivantes:

- Media personnel probablement deja synchronise.
- Media personnel a verifier.
- Doublon exact d'un media personnel.
- Temporaire parasite.
- Non personnel / export / capture / telechargement technique.

## Informations minimales a fournir

- Chemin exact.
- Taille.
- Type.
- Date si disponible.
- Caractere probablement personnel ou non.
- Hash ou statut doublon exact si calcule.
- Recommandation prudente.

## Regles d'action

- Ne jamais supprimer directement un media personnel sans validation explicite.
- Pour plusieurs copies exactes, garder une copie locale de reference et signaler les doublons.
- Distinguer clairement medias personnels reels, temporaires Messages/caches/copies parasites, et videos exports/telechargements techniques.
- Priorite disque: temporaires geants, puis doublons exacts, puis caches recreables, puis gros medias personnels avec prudence maximale.
- Si un media personnel semble probablement recuperable dans Google Photos, le signaler comme "probablement recuperable dans Google Photos, a verifier avant suppression locale".

## Application pratique

Pour `Downloads`, les fichiers de type `IMG_*.MOV`, photos, videos familiales, captures personnelles ou documents scannes sont par defaut sensibles. Ils peuvent etre proposes pour archivage externe ou verification Google Photos, mais pas pour suppression automatique.
