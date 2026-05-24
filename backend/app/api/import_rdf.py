"""Import an existing RDF/OWL ontology file into the graph."""

from __future__ import annotations

import logging
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from rdflib import BNode
from rdflib import Graph as RdfGraph
from rdflib.namespace import OWL, RDF, RDFS
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.ontology import Ontology, OntologyStatus
from app.schemas.common import ImportResult
from app.services.graph_service import GraphService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ontologies/{ontology_id}", tags=["import"])

# Map file extensions to rdflib parse formats.
_EXT_TO_FORMAT: dict[str, str] = {
    ".ttl": "turtle",
    ".owl": "xml",
    ".rdf": "xml",
    ".jsonld": "json-ld",
    ".json": "json-ld",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_ontology_or_404(
    ontology_id: uuid.UUID,
    session: AsyncSession,
) -> Ontology:
    result = await session.execute(
        select(Ontology).where(Ontology.id == ontology_id)
    )
    ontology = result.scalars().first()
    if ontology is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ontology {ontology_id} not found.",
        )
    return ontology


def _label_for(g: RdfGraph, subject, uri_str: str) -> str:  # type: ignore[type-arg]
    """Return rdfs:label if present, otherwise the local name from the URI."""
    val = g.value(subject, RDFS.label)
    if val:
        return str(val)
    fragment = uri_str.rsplit("#", 1)[-1].rsplit("/", 1)[-1]
    return fragment or uri_str


def _description_for(g: RdfGraph, subject) -> str:  # type: ignore[type-arg]
    """Return rdfs:comment if present, otherwise empty string."""
    val = g.value(subject, RDFS.comment)
    return str(val) if val else ""


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/import", response_model=ImportResult)
async def import_rdf(
    ontology_id: uuid.UUID,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db),
) -> ImportResult:
    """Parse an RDF file and populate the ontology graph."""

    ontology = await _get_ontology_or_404(ontology_id, session)

    # --- Detect format from extension ---
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    rdf_format = _EXT_TO_FORMAT.get(ext)
    if rdf_format is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file extension '{ext}'. "
            f"Accepted: {', '.join(sorted(_EXT_TO_FORMAT))}",
        )

    # --- Read file ---
    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file.",
        )

    # --- Parse RDF ---
    g = RdfGraph()
    try:
        g.parse(data=content, format=rdf_format)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not parse RDF file: {exc}",
        ) from exc

    if len(g) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The file contains no RDF triples.",
        )

    # --- Ensure graph exists ---
    await GraphService.create_graph(session, ontology_id)

    class_count = 0
    prop_count = 0
    rel_count = 0
    seen_uris: set[str] = set()

    # --- Pass 1: owl:Class ---
    for subj in g.subjects(RDF.type, OWL.Class):
        if isinstance(subj, BNode):
            continue
        uri = str(subj)
        if uri in seen_uris:
            continue
        seen_uris.add(uri)
        try:
            await GraphService.add_class(
                session,
                ontology_id,
                uri=uri,
                label=_label_for(g, subj, uri),
                description=_description_for(g, subj),
            )
            class_count += 1
        except Exception:
            logger.debug("Skipping class %s", uri, exc_info=True)

    # --- Pass 2: rdfs:Class (not already seen) ---
    for subj in g.subjects(RDF.type, RDFS.Class):
        if isinstance(subj, BNode):
            continue
        uri = str(subj)
        if uri in seen_uris:
            continue
        seen_uris.add(uri)
        try:
            await GraphService.add_class(
                session,
                ontology_id,
                uri=uri,
                label=_label_for(g, subj, uri),
                description=_description_for(g, subj),
            )
            class_count += 1
        except Exception:
            logger.debug("Skipping rdfs:Class %s", uri, exc_info=True)

    # --- Pass 3: rdfs:subClassOf relationships ---
    for subj, obj in g.subject_objects(RDFS.subClassOf):
        if isinstance(subj, BNode) or isinstance(obj, BNode):
            continue
        try:
            await GraphService.add_relationship(
                session, ontology_id, str(subj), str(obj), "SUBCLASS_OF",
            )
            rel_count += 1
        except Exception:
            logger.debug(
                "Skipping subClassOf %s -> %s", subj, obj, exc_info=True,
            )

    # --- Pass 4: owl:equivalentClass relationships ---
    for subj, obj in g.subject_objects(OWL.equivalentClass):
        if isinstance(subj, BNode) or isinstance(obj, BNode):
            continue
        try:
            await GraphService.add_relationship(
                session, ontology_id, str(subj), str(obj), "EQUIVALENT_TO",
            )
            rel_count += 1
        except Exception:
            logger.debug(
                "Skipping equivalentClass %s -> %s", subj, obj, exc_info=True,
            )

    # --- Pass 5: Properties (ObjectProperty, DatatypeProperty, AnnotationProperty) ---
    property_rdf_types = [OWL.ObjectProperty, OWL.DatatypeProperty, OWL.AnnotationProperty]
    seen_props: set[str] = set()
    for rdf_type in property_rdf_types:
        for subj in g.subjects(RDF.type, rdf_type):
            if isinstance(subj, BNode):
                continue
            uri = str(subj)
            if uri in seen_props:
                continue
            seen_props.add(uri)
            domain_val = g.value(subj, RDFS.domain)
            range_val = g.value(subj, RDFS.range)
            if not domain_val or not range_val:
                continue
            if isinstance(domain_val, BNode) or isinstance(range_val, BNode):
                continue
            try:
                await GraphService.add_property(
                    session,
                    ontology_id,
                    uri=uri,
                    label=_label_for(g, subj, uri),
                    domain_uri=str(domain_val),
                    range_uri=str(range_val),
                    description=_description_for(g, subj),
                )
                prop_count += 1
            except Exception:
                logger.debug("Skipping property %s", uri, exc_info=True)

    # --- Finalise ---
    ontology.status = OntologyStatus.READY  # type: ignore[assignment]
    await session.commit()

    logger.info(
        "Imported ontology %s: %d classes, %d properties, %d relationships",
        ontology_id, class_count, prop_count, rel_count,
    )

    return ImportResult(
        status="ok",
        classes_imported=class_count,
        properties_imported=prop_count,
        relationships_imported=rel_count,
        message=f"Imported {class_count} classes, {prop_count} properties, "
        f"{rel_count} relationships.",
    )
