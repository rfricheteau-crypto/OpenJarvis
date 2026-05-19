# OpenJarvis Graphify Governance - 2026-04-25

## Official Jarvis Graphify

- Official rendered scope: `OpenJarvis/src/openjarvis/server`
- Native HTML source: `OpenJarvis/src/openjarvis/server/.graphify/graph.html`
- Browser route: `GET /graphify/jarvis`
- Public mirror file: `graphify-out/openjarvis-server-native/graph.html`
- Rendering mode: native `vis-network`, not a custom fallback renderer

## Separation Rules

- Keep ADV outputs separate from Jarvis outputs.
- Do not reuse `ADV-App/graphify-out/graph.html` for Jarvis.
- Do not point Jarvis dashboard links at the ADV graph.
- Do not widen the Jarvis Graphify scope back to the full `OpenJarvis/src/openjarvis` tree for visual rendering.

## Regeneration Command

Use the native pipeline on the official Jarvis subgraph:

```bash
cd /Users/ruthpierre/Jarvis
graphify update /Users/ruthpierre/Jarvis/OpenJarvis/src/openjarvis/server
graphify cluster-only /Users/ruthpierre/Jarvis/OpenJarvis/src/openjarvis/server
cp /Users/ruthpierre/Jarvis/OpenJarvis/src/openjarvis/server/.graphify/graph.html /Users/ruthpierre/Jarvis/graphify-out/openjarvis-server-native/graph.html
```

## Dashboard Integration

- The Jarvis dashboard exposes Graphify through a stable link to `/graphify/jarvis`.
- The graph remains a separate browser view; it is not embedded in an iframe inside the dashboard.
- The graph view is part of the durable Jarvis UI access path, not a one-off artifact.
