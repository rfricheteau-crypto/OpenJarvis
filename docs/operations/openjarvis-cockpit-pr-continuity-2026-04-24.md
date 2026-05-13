# OpenJarvis / Jarvis - Continuite technique - 2026-04-24

## Done

- Fork utilise : `rfricheteau-crypto/OpenJarvis`.
- Le premier push direct vers `open-jarvis/OpenJarvis` a echoue faute de droits.
- Le remote local a ete bascule vers le fork.
- Le push vers le fork a reussi.
- Un premier essai de PR depuis `main` etait trop large.
- Une branche propre a ete creee depuis `open-jarvis/OpenJarvis:main` :
  - `pr/cockpit-clean`
- Commit isole retenu pour la PR propre :
  - `b01e52e feat(cockpit): add jarvis personal runtime dashboard`

## Current status

- PR active : **#279**
- Titre : `feat(cockpit): add Jarvis personal runtime dashboard`
- Head : `rfricheteau-crypto:pr/cockpit-clean`
- Base : `open-jarvis/OpenJarvis:main`
- La PR est ouverte et en attente de review maintainer.
- Aucun merge n'a ete fait.

## Blockers

- Review maintainer encore en attente.
- Merge bloque tant qu'une personne avec droits d'ecriture n'approuve pas.
- Dossiers non suivis encore presents localement pendant cette sequence :
  - `docs/operations/`
  - `scripts/maintenance/`

## Next step

- Attendre la review sur la PR **#279**.
- Si retour maintainer, faire un patch minimal sur `pr/cockpit-clean`.
- Ne pas melanger cette PR avec les dossiers non suivis hors perimetre.
