"""High-level ontology orchestration service.

Provides CRUD operations on the Ontology SQLAlchemy model, version
management (snapshot/rollback via JSON-LD), and coordinates with the
graph service for AGE graph lifecycle management.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.export_service import export_ontology
from app.services.graph_service import GraphService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

async def create_ontology(
    session: AsyncSession,
    data: "OntologyCreate",
    user_id: UUID,
) -> "Ontology":
    """Create a new ontology record and its backing AGE graph.

    Args:
        session: Async DB session.
        data: Pydantic creation schema (name, description, namespace_uri).
        user_id: Owning user's UUID.

    Returns:
        The persisted Ontology ORM instance.
    """
    from app.models.ontology import Ontology

    ontology = Ontology(
        user_id=user_id,
        name=data.name,
        description=getattr(data, "description", None) or "",
        namespace_uri=getattr(data, "namespace_uri", None)
        or f"http://ontosphere.io/ontologies/{data.name.lower().replace(' ', '_')}#",
        status="draft",
    )
    session.add(ontology)
    await session.flush()  # populate ontology.id

    # Create the AGE graph for this ontology
    try:
        await GraphService.create_graph(session, ontology.id)
    except Exception as exc:
        logger.error("Failed to create AGE graph for ontology %s: %s", ontology.id, exc)
        # Non-fatal: the graph can be created lazily during processing

    await session.commit()
    await session.refresh(ontology)
    logger.info("Created ontology '%s' (id=%s)", ontology.name, ontology.id)
    return ontology


async def get_ontology(
    session: AsyncSession,
    ontology_id: UUID,
) -> "Ontology":
    """Fetch a single ontology by ID.

    Raises:
        ValueError: If the ontology does not exist.
    """
    from app.models.ontology import Ontology

    result = await session.execute(
        select(Ontology).where(Ontology.id == ontology_id)
    )
    ontology = result.scalar_one_or_none()
    if ontology is None:
        raise ValueError(f"Ontology {ontology_id} not found")
    return ontology


async def list_ontologies(
    session: AsyncSession,
    user_id: UUID,
) -> list["Ontology"]:
    """List all ontologies belonging to a user, ordered by creation date."""
    from app.models.ontology import Ontology

    result = await session.execute(
        select(Ontology)
        .where(Ontology.user_id == user_id)
        .order_by(Ontology.created_at.desc())
    )
    return list(result.scalars().all())


async def update_ontology(
    session: AsyncSession,
    ontology_id: UUID,
    data: "OntologyUpdate",
) -> "Ontology":
    """Update mutable fields on an existing ontology.

    Args:
        session: Async DB session.
        ontology_id: UUID of the ontology to update.
        data: Pydantic update schema with optional fields.

    Returns:
        The updated Ontology ORM instance.

    Raises:
        ValueError: If the ontology does not exist.
    """
    ontology = await get_ontology(session, ontology_id)

    update_fields = data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else data.dict(exclude_unset=True)

    for field_name, value in update_fields.items():
        if hasattr(ontology, field_name):
            setattr(ontology, field_name, value)

    await session.commit()
    await session.refresh(ontology)
    logger.info("Updated ontology %s", ontology_id)
    return ontology


async def delete_ontology(
    session: AsyncSession,
    ontology_id: UUID,
) -> None:
    """Delete an ontology and drop its AGE graph.

    Args:
        session: Async DB session.
        ontology_id: UUID of the ontology to delete.

    Raises:
        ValueError: If the ontology does not exist.
    """
    ontology = await get_ontology(session, ontology_id)

    # Drop the AGE graph
    try:
        await GraphService.drop_graph(session, ontology_id)
    except Exception as exc:
        logger.warning("Failed to drop AGE graph for ontology %s: %s", ontology_id, exc)

    await session.delete(ontology)
    await session.commit()
    logger.info("Deleted ontology %s", ontology_id)


# ---------------------------------------------------------------------------
# Version management
# ---------------------------------------------------------------------------

async def create_version(
    session: AsyncSession,
    ontology_id: UUID,
    description: str = "",
) -> "OntologyVersion":
    """Snapshot the current graph state as a new version.

    Exports the graph as JSON-LD, stores it in a new OntologyVersion row,
    and increments the version number.

    Args:
        session: Async DB session.
        ontology_id: UUID of the ontology.
        description: Human-readable description of this version.

    Returns:
        The created OntologyVersion ORM instance.
    """
    from app.models.ontology import Ontology, OntologyVersion

    ontology = await get_ontology(session, ontology_id)

    # Determine next version number
    result = await session.execute(
        select(OntologyVersion)
        .where(OntologyVersion.ontology_id == ontology_id)
        .order_by(OntologyVersion.version_number.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    next_version = (latest.version_number + 1) if latest else 1

    # Export current graph as JSON-LD
    try:
        jsonld_str = await export_ontology(
            session,
            ontology_id,
            fmt="jsonld",
            namespace_uri=ontology.namespace_uri,
        )
        snapshot = json.loads(jsonld_str) if isinstance(jsonld_str, str) else jsonld_str
    except Exception as exc:
        logger.error("Failed to export JSON-LD for version snapshot: %s", exc)
        # Fall back to a plain JSON export
        json_str = await export_ontology(
            session, ontology_id, fmt="json", namespace_uri=ontology.namespace_uri,
        )
        snapshot = json.loads(json_str) if isinstance(json_str, str) else json_str

    version = OntologyVersion(
        ontology_id=ontology_id,
        version_number=next_version,
        snapshot_jsonld=snapshot,
        description=description or f"Version {next_version}",
    )
    session.add(version)
    await session.commit()
    await session.refresh(version)

    logger.info(
        "Created version %d for ontology %s",
        next_version,
        ontology_id,
    )
    return version


async def list_versions(
    session: AsyncSession,
    ontology_id: UUID,
) -> list["OntologyVersion"]:
    """List all versions for an ontology, newest first."""
    from app.models.ontology import OntologyVersion

    result = await session.execute(
        select(OntologyVersion)
        .where(OntologyVersion.ontology_id == ontology_id)
        .order_by(OntologyVersion.version_number.desc())
    )
    return list(result.scalars().all())


async def rollback_version(
    session: AsyncSession,
    ontology_id: UUID,
    version_id: UUID,
) -> None:
    """Restore the ontology graph from a previous version snapshot.

    1. Load the OntologyVersion snapshot.
    2. Drop the current AGE graph.
    3. Recreate the graph from the snapshot data.

    Args:
        session: Async DB session.
        ontology_id: UUID of the ontology.
        version_id: UUID of the version to roll back to.

    Raises:
        ValueError: If the ontology or version is not found.
    """
    from app.models.ontology import OntologyVersion

    # Load the target version
    result = await session.execute(
        select(OntologyVersion).where(
            OntologyVersion.id == version_id,
            OntologyVersion.ontology_id == ontology_id,
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise ValueError(
            f"Version {version_id} not found for ontology {ontology_id}"
        )

    snapshot = version.snapshot_jsonld
    if not snapshot:
        raise ValueError(f"Version {version_id} has no snapshot data")

    # Drop and recreate the graph
    await GraphService.drop_graph(session, ontology_id)
    await GraphService.create_graph(session, ontology_id)

    # Rebuild from snapshot
    # The snapshot may be JSON-LD (from rdflib) or our plain JSON format.
    # If it has "nodes" and "edges" keys, it is our custom format.
    if isinstance(snapshot, dict) and "nodes" in snapshot:
        await _rebuild_from_json(session, ontology_id, snapshot)
    elif isinstance(snapshot, dict):
        # Assume it is a JSON-LD document: re-parse via rdflib and
        # re-extract nodes/edges.  For simplicity, store the graph
        # data in the expected format when creating versions.
        await _rebuild_from_jsonld(session, ontology_id, snapshot)
    else:
        logger.warning("Unknown snapshot format for version %s", version_id)

    logger.info(
        "Rolled back ontology %s to version %s (v%d)",
        ontology_id,
        version_id,
        version.version_number,
    )


async def _rebuild_from_json(
    session: AsyncSession,
    ontology_id: UUID,
    data: dict,
) -> None:
    """Rebuild the graph from a plain JSON snapshot (nodes + edges)."""
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    # Create nodes
    for node in nodes:
        uri = node.get("uri", "")
        node_type = node.get("node_type", "class")
        if node_type == "class":
            await GraphService.add_class(
                session,
                ontology_id,
                uri=uri,
                label=node.get("label", ""),
                description=node.get("description", ""),
            )
        elif node_type == "property":
            # Properties will be reconnected via edges below
            await GraphService.add_property(
                session,
                ontology_id,
                uri=uri,
                label=node.get("label", ""),
                domain_uri="",
                range_uri="",
                description=node.get("description", ""),
            )

    # Create edges
    for edge in edges:
        source = edge.get("source_uri", "")
        target = edge.get("target_uri", "")
        edge_type = edge.get("edge_type", "")
        if source and target and edge_type:
            try:
                await GraphService.add_relationship(
                    session, ontology_id, source, target, edge_type,
                )
            except ValueError:
                logger.debug(
                    "Skipping edge %s->%s [%s] during rollback",
                    source, target, edge_type,
                )


async def _rebuild_from_jsonld(
    session: AsyncSession,
    ontology_id: UUID,
    jsonld_data: dict,
) -> None:
    """Rebuild the graph from a JSON-LD snapshot.

    Parses the JSON-LD via rdflib and extracts OWL classes and properties.
    """
    try:
        from rdflib import Graph as RdfGraph
        from rdflib.namespace import OWL, RDF, RDFS

        g = RdfGraph()
        g.parse(data=json.dumps(jsonld_data), format="json-ld")

        # Extract classes
        for subj in g.subjects(RDF.type, OWL.Class):
            uri = str(subj)
            label = str(g.value(subj, RDFS.label, default=""))
            description = str(g.value(subj, RDFS.comment, default=""))
            await GraphService.add_class(
                session, ontology_id, uri=uri, label=label, description=description,
            )

        # Extract subclass relationships
        for subj, obj in g.subject_objects(RDFS.subClassOf):
            await GraphService.add_relationship(
                session, ontology_id, str(subj), str(obj), "SUBCLASS_OF",
            )

        # Extract equivalentClass relationships
        for subj, obj in g.subject_objects(OWL.equivalentClass):
            await GraphService.add_relationship(
                session, ontology_id, str(subj), str(obj), "EQUIVALENT_TO",
            )

        # Extract disjointWith relationships
        for subj, obj in g.subject_objects(OWL.disjointWith):
            await GraphService.add_relationship(
                session, ontology_id, str(subj), str(obj), "DISJOINT_WITH",
            )

        # Extract properties
        for subj in g.subjects(RDF.type, OWL.ObjectProperty):
            uri = str(subj)
            label = str(g.value(subj, RDFS.label, default=""))
            description = str(g.value(subj, RDFS.comment, default=""))
            domain = str(g.value(subj, RDFS.domain, default=""))
            range_val = str(g.value(subj, RDFS.range, default=""))
            if domain and range_val:
                await GraphService.add_property(
                    session, ontology_id,
                    uri=uri, label=label,
                    domain_uri=domain, range_uri=range_val,
                    description=description,
                )

    except Exception as exc:
        logger.error("Failed to rebuild graph from JSON-LD: %s", exc, exc_info=True)
        raise ValueError(f"Could not parse JSON-LD snapshot: {exc}") from exc
