# Gouvernance multi-IA — Jarvis et projets Ruth

## Principe fondamental

Plusieurs IA et outils peuvent proposer des solutions.
Aucun n'est chef par défaut. Aucun n'est arbitre automatique.
La meilleure solution peut venir de n'importe quel outil.
**Ruth décide toujours.**

---

## Règle absolue

```
Aucune IA n'a automatiquement raison.
Aucune IA n'applique sans validation Ruth.
Un seul outil applique à la fois.
Git protège le retour arrière.
```

---

## Rôle de chaque outil

| Outil | Rôle dans la gouvernance |
|---|---|
| **Claude Code** | Propose, analyse, compare, documente. Attend validation. |
| **Codex** | Inspecte le code réel, propose, compare explicitement. Attend validation. |
| **ChatGPT** | Apporte un angle externe ou une vérification indépendante si consulté. |
| **QMD** | Source de vérité sur la mémoire Obsidian. Lecture seule sauf instruction Ruth. |
| **Hermès** | Orchestrateur. Route les tâches. Ne prend pas de décision unilatérale. |
| **Graphify** | Cartographie les dépendances avant modifications importantes. |

---

## Périmètre des projets concernés

- Jarvis / OpenJarvis
- Hermès
- QMD
- ADV-App
- adv-proxy
- adv-worker-stripe
- Obsidian
- Graphify
- futurs projets techniques Ruth

---

## Contexte Jarvis — périmètre étendu

Jarvis n'est pas seulement OpenJarvis.

L'écosystème complet :
- **OpenJarvis** — runtime local Python
- **Hermès** — orchestrateur 360°, routeur d'outils
- **QMD** — recherche sémantique sur vault Obsidian
- **Obsidian / JARVIS** — mémoire opérationnelle durable
- **Graphify** — cartographie et analyse de dépendances

Toute modification touchant le **vocal**, la **mémoire**, les **workflows** ou l'**architecture** doit vérifier l'impact sur l'ensemble.

---

## Méthode de comparaison

Quand deux outils proposent des solutions différentes, la comparaison se fait sur ces critères :

| Critère | Question |
|---|---|
| Sécurité | Est-ce que ça expose des données ou crée un risque ? |
| Simplicité | La solution est-elle lisible et maintenable ? |
| Impact minimal | Est-ce que ça touche seulement ce qui est nécessaire ? |
| Compatibilité code réel | Est-ce que ça s'intègre sans friction dans l'existant ? |
| Facilité de retour arrière | Peut-on revenir facilement si ça casse ? |
| Capacité à tester | Peut-on vérifier que ça fonctionne avant de déployer ? |
| Risque V1 stable | Est-ce que ça met en danger une version qui fonctionne ? |
| Cohérence architecture | Est-ce cohérent avec le design global du système ? |

---

## Méthode de décision Ruth

1. Lire les propositions de chaque outil
2. Comparer sur les critères ci-dessus
3. Choisir la solution retenue (ou demander une synthèse)
4. Désigner l'outil qui applique
5. Valider explicitement avant toute modification

La décision peut être :
- **Solution A** (Claude) → Codex applique sous supervision
- **Solution B** (Codex) → Claude documente, Codex applique
- **Synthèse** → Ruth dicte, un seul outil applique
- **Ni l'une ni l'autre** → Ruth demande un autre angle

---

## Sécurité Git — protocole obligatoire

Avant toute modification significative :

```bash
# 1. Vérifier l'état
git status
git log --oneline -5

# 2. Sauvegarder si modifications non commitées
git stash save "backup-avant-[nom-du-changement]-$(date +%Y%m%d-%H%M%S)"

# 3. Créer une branche de sécurité
git checkout -b backup/avant-[nom-du-changement]
git checkout main  # ou la branche principale

# 4. Après modification : vérifier que ça marche avant de continuer
```

Règles absolues Git dans ce projet :
- Ne jamais `git reset --hard` sans demande Ruth explicite
- Ne jamais `git push --force` sans demande Ruth explicite
- Ne jamais bypasser les hooks (`--no-verify`)
- Ne jamais committer credentials, tokens, `.env`

---

## Commandes utiles

```bash
# Lancer une analyse comparative structurée
./ai-bridge.sh "description du problème"

# Voir l'état Git avant de proposer une solution
git status && git log --oneline -5

# Vérifier les fichiers modifiés non sauvegardés
git diff --name-only

# Créer un snapshot rapide
git stash save "snapshot-$(date +%Y%m%d-%H%M%S)"

# Revenir au snapshot
git stash list
git stash pop stash@{0}
```

---

## Comment utiliser cette gouvernance pour un bug concret

### Exemple : bug vocal Jarvis (transcription / double voix / anti-écho)

**Étape 1 — Lancer le bridge**
```bash
./ai-bridge.sh "Bug vocal Jarvis : double transcription et anti-écho"
```

**Étape 2 — Claude propose**
Claude analyse les fichiers speech concernés, propose une solution, liste les risques.

**Étape 3 — Codex inspecte**
Codex lit le code réel, propose sa solution ou valide celle de Claude, compare explicitement.

**Étape 4 — Ruth compare**
Ruth lit les deux propositions, compare sur les 8 critères, choisit ou demande une synthèse.

**Étape 5 — Un seul outil applique**
L'outil désigné fait la modification. L'autre documente ou vérifie.

**Étape 6 — Test avant commit**
Tester la fonctionnalité. Si ça marche : commit. Si ça casse : rollback Git.

---

## Structure des fichiers de gouvernance

```
OpenJarvis/
├── CLAUDE.md          ← règles pour Claude Code
├── AGENTS.md          ← règles pour Codex + règles métier Jarvis
├── ai-bridge.sh       ← script d'analyse comparative
└── docs/
    └── ai-governance.md  ← ce fichier — documentation complète
```

---

## Historique

- 2026-05-19 : gouvernance multi-IA installée — Claude Code
