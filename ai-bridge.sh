#!/usr/bin/env bash
# ai-bridge.sh — Analyse comparative multi-IA
# Usage : ./ai-bridge.sh "description du problème"
# Crée un fichier bridge structuré pour comparer les propositions de chaque outil.

set -euo pipefail

PROBLEM="${1:-}"
if [[ -z "$PROBLEM" ]]; then
  echo "Usage : ./ai-bridge.sh \"description du problème\""
  exit 1
fi

TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BRIDGE_DIR="$(dirname "$0")/docs/bridges"
BRIDGE_FILE="${BRIDGE_DIR}/bridge-${TIMESTAMP}.md"

mkdir -p "$BRIDGE_DIR"

# Capture git status
GIT_STATUS=$(git -C "$(dirname "$0")" status 2>/dev/null || echo "non-git directory")
GIT_LOG=$(git -C "$(dirname "$0")" log --oneline -5 2>/dev/null || echo "")
GIT_DIFF=$(git -C "$(dirname "$0")" diff --name-only 2>/dev/null || echo "aucun")

cat > "$BRIDGE_FILE" << BRIDGE
# Bridge d'analyse multi-IA — ${TIMESTAMP}

## Problème soumis

${PROBLEM}

---

## État Git au moment du bridge

\`\`\`
${GIT_STATUS}
\`\`\`

### Derniers commits
\`\`\`
${GIT_LOG}
\`\`\`

### Fichiers modifiés non commitès
\`\`\`
${GIT_DIFF}
\`\`\`

---

## Proposition Claude Code

> À remplir par Claude Code après analyse du code réel.

### Analyse du problème
<!-- Claude : décrire ce que tu as trouvé dans le code -->

### Solution proposée
<!-- Claude : décrire la solution, fichiers concernés, pourquoi -->

### Fichiers à modifier
<!-- Claude : liste avec chemins exacts -->

### Risques identifiés
<!-- Claude : liste des risques -->

### Tests à faire
<!-- Claude : comment vérifier que ça marche -->

### Retour arrière possible ?
<!-- Claude : oui/non + méthode exacte -->

---

## Proposition Codex

> À remplir par Codex après inspection du code réel.
> Codex ne copie pas Claude. Codex inspecte, puis propose ou valide.

### Ce que Codex a trouvé dans le code
<!-- Codex : ce que tu as observé réellement -->

### Solution proposée par Codex
<!-- Codex : ta solution, tes fichiers, ton raisonnement -->

### Comparaison avec la proposition Claude

| Critère | Claude | Codex | Avantage |
|---|---|---|---|
| Sécurité | | | |
| Simplicité | | | |
| Impact minimal | | | |
| Compatibilité code réel | | | |
| Facilité retour arrière | | | |
| Capacité à tester | | | |
| Risque V1 stable | | | |
| Cohérence architecture | | | |

### Recommandation Codex
<!-- Codex : quelle solution tu recommandes et pourquoi. Ou "Ruth décide". -->

---

## Verdict recommandé (à remplir après comparaison)

- [ ] Solution Claude retenue
- [ ] Solution Codex retenue
- [ ] Synthèse Ruth
- [ ] Autre outil consulté : ___________

**Outil qui applique :** ___________

---

## Fichiers à modifier (validés)

<!-- Liste finale après décision Ruth -->

---

## Sauvegardes nécessaires avant application

\`\`\`bash
# À exécuter avant toute modification
git stash save "backup-avant-fix-${TIMESTAMP}"
# ou
git checkout -b backup/avant-fix-${TIMESTAMP}
\`\`\`

---

## Tests à faire après application

<!-- Liste des vérifications fonctionnelles -->

---

## Décision Ruth

> Cette section est remplie par Ruth uniquement.

**Solution retenue :**
**Outil qui applique :**
**Date de validation :**
**Résultat après test :**

---

*Bridge généré le ${TIMESTAMP} par ai-bridge.sh*
*Gouvernance : docs/ai-governance.md*
BRIDGE

echo ""
echo "Bridge créé : ${BRIDGE_FILE}"
echo ""
echo "Prochaines étapes :"
echo "  1. Demander à Claude d'analyser le problème et remplir sa section"
echo "  2. Demander à Codex d'inspecter le code et remplir sa section"
echo "  3. Comparer les deux propositions sur les 8 critères"
echo "  4. Ruth décide : quelle solution, quel outil applique"
echo "  5. Faire le backup Git avant toute modification"
echo "  6. Tester avant de committer"
echo ""

# Alerte si modifications non sauvegardées
MODIFIED=$(git -C "$(dirname "$0")" diff --name-only 2>/dev/null | wc -l | tr -d ' ')
if [[ "$MODIFIED" -gt 0 ]]; then
  echo "ATTENTION : ${MODIFIED} fichier(s) modifié(s) non commité(s) détecté(s)."
  echo "  Proposé : git stash save \"snapshot-avant-bridge-${TIMESTAMP}\""
  echo "  (à exécuter manuellement si tu veux sauvegarder avant de continuer)"
  echo ""
fi

echo "Pour ouvrir le bridge :"
echo "  open \"${BRIDGE_FILE}\""
echo "  # ou"
echo "  cat \"${BRIDGE_FILE}\""
