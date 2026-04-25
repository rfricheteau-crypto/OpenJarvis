"""Official Jarvis Graphify routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, FileResponse

router = APIRouter(tags=["graphify"])

NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

JARVIS_ROOT = Path("/Users/ruthpierre/Jarvis").resolve()
OFFICIAL_SCOPE = JARVIS_ROOT / "OpenJarvis" / "src" / "openjarvis" / "server"
OFFICIAL_HTML = OFFICIAL_SCOPE / ".graphify" / "graph.html"
OFFICIAL_GRAPH = OFFICIAL_SCOPE / ".graphify" / "graph.json"
OFFICIAL_REPORT = OFFICIAL_SCOPE / ".graphify" / "GRAPH_REPORT.md"
PUBLIC_MIRROR = JARVIS_ROOT / "graphify-out" / "openjarvis-server-native" / "graph.html"
LOCAL_VIS_NETWORK = OFFICIAL_SCOPE / "static" / "assets" / "vis-network.min.js"


def _resolve_html() -> Path | None:
    for candidate in (OFFICIAL_HTML, PUBLIC_MIRROR):
        if candidate.exists():
            return candidate
    return None


@router.get("/graphify/jarvis")
async def jarvis_graphify_html():
    """Serve the native Graphify HTML for the official Jarvis server scope."""
    html = _resolve_html()
    if html is None:
        raise HTTPException(status_code=404, detail="Jarvis Graphify HTML is not available.")
    body = html.read_text(encoding="utf-8")
    if LOCAL_VIS_NETWORK.exists():
        body = body.replace(
            "https://unpkg.com/vis-network/standalone/umd/vis-network.min.js",
            "/assets/vis-network.min.js",
        )
    return HTMLResponse(body, media_type="text/html; charset=utf-8", headers=NO_CACHE_HEADERS)


@router.get("/v1/graphify/status")
async def graphify_status():
    """Return the official Jarvis Graphify integration status."""
    html = _resolve_html()
    return {
        "status": "native_html_ready" if html else "missing",
        "transport": "http",
        "official_scope": str(OFFICIAL_SCOPE),
        "render_mode": "vis-network native",
        "html_route": "/graphify/jarvis",
        "html_path": str(html or OFFICIAL_HTML),
        "graph_json": str(OFFICIAL_GRAPH),
        "graph_report": str(OFFICIAL_REPORT),
        "mirror_html": str(PUBLIC_MIRROR),
        "separation": "ADV graph outputs stay separate from Jarvis graph outputs.",
    }


__all__ = ["router"]
