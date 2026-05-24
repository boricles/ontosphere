"""OntoSphere API -- aggregate router that includes all sub-routers.

Collects all sub-routers and exposes a single ``api_router`` that
:mod:`app.main` includes under the ``/api`` prefix.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.documents import router as documents_router
from app.api.events import router as events_router
from app.api.export import router as export_router
from app.api.graph import router as graph_router
from app.api.import_rdf import router as import_router
from app.api.ontologies import router as ontologies_router
from app.api.processing import router as processing_router
from app.api.validation import router as validation_router
from app.api.versions import router as versions_router

api_router = APIRouter()

# Core CRUD
api_router.include_router(ontologies_router)

# Nested under /ontologies/{ontology_id}
api_router.include_router(documents_router)
api_router.include_router(processing_router)
api_router.include_router(import_router)
api_router.include_router(graph_router)
api_router.include_router(export_router)
api_router.include_router(validation_router)
api_router.include_router(versions_router)

# WebSocket (no prefix -- uses its own full path)
api_router.include_router(events_router)

__all__ = ["api_router"]
