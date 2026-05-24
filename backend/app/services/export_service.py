"""Export service for serialising ontology graphs to standard formats.

Converts the internal AGE graph representation to RDF (OWL/XML, Turtle,
JSON-LD) using rdflib, or to a plain JSON representation.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.graph_service import GraphData, GraphService

logger = logging.getLogger(__name__)


async def export_ontology(
    session: AsyncSession,
    ontology_id: UUID,
    fmt: str,
    namespace_uri: str = "http://example.org/ontology#",
) -> str | bytes:
    """Export the ontology graph in the requested format.

    Supported formats:
        - ``"owl"``   -- RDF/XML (OWL)
        - ``"ttl"``   -- Turtle
        - ``"jsonld"`` -- JSON-LD
        - ``"json"``  -- Custom JSON (GraphData as dict)

    Args:
        session: Active async database session.
        ontology_id: UUID of the ontology.
        fmt: Target serialisation format.
        namespace_uri: Base namespace URI for the ontology.

    Returns:
        Serialised string (or bytes for XML) of the ontology.

    Raises:
        ValueError: If the format is not supported.
    """
    fmt = fmt.lower().strip()

    graph_data = await GraphService.get_graph(session, ontology_id)

    if fmt == "json":
        return _export_json(graph_data)

    return _export_rdf(graph_data, fmt, namespace_uri)


# ---------------------------------------------------------------------------
# JSON export
# ---------------------------------------------------------------------------

def _export_json(graph_data: GraphData) -> str:
    """Serialise GraphData to a plain JSON string."""
    payload = {
        "nodes": [
            {
                "uri": n.uri,
                "label": n.label,
                "description": n.description,
                "node_type": n.node_type,
                "properties": n.properties,
            }
            for n in graph_data.nodes
        ],
        "edges": [
            {
                "source_uri": e.source_uri,
                "target_uri": e.target_uri,
                "edge_type": e.edge_type,
                "label": e.label,
                "properties": e.properties,
            }
            for e in graph_data.edges
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# RDF export via rdflib
# ---------------------------------------------------------------------------

def _export_rdf(
    graph_data: GraphData,
    fmt: str,
    namespace_uri: str,
) -> str:
    """Build an rdflib graph and serialise to the requested RDF format."""
    from rdflib import Graph, Literal, Namespace, URIRef
    from rdflib.namespace import OWL, RDF, RDFS, XSD

    # Ensure namespace ends with # or /
    if not namespace_uri.endswith("#") and not namespace_uri.endswith("/"):
        namespace_uri += "#"

    NS = Namespace(namespace_uri)

    g = Graph()
    g.bind("owl", OWL)
    g.bind("rdfs", RDFS)
    g.bind("rdf", RDF)
    g.bind("xsd", XSD)
    g.bind("onto", NS)

    # -- Add an Ontology declaration --
    onto_uri = URIRef(namespace_uri.rstrip("#").rstrip("/"))
    g.add((onto_uri, RDF.type, OWL.Ontology))

    # -- Nodes --
    for node in graph_data.nodes:
        node_uri = _resolve_uri(node.uri, NS)

        if node.node_type == "class":
            g.add((node_uri, RDF.type, OWL.Class))
        elif node.node_type == "property":
            g.add((node_uri, RDF.type, OWL.ObjectProperty))
        elif node.node_type == "individual":
            g.add((node_uri, RDF.type, OWL.NamedIndividual))
        else:
            g.add((node_uri, RDF.type, OWL.Class))

        if node.label:
            g.add((node_uri, RDFS.label, Literal(node.label)))
        if node.description:
            g.add((node_uri, RDFS.comment, Literal(node.description)))

    # -- Edges --
    for edge in graph_data.edges:
        source = _resolve_uri(edge.source_uri, NS)
        target = _resolve_uri(edge.target_uri, NS)
        edge_type = edge.edge_type.upper()

        if edge_type == "SUBCLASS_OF":
            g.add((source, RDFS.subClassOf, target))
        elif edge_type == "DOMAIN":
            g.add((source, RDFS.domain, target))
        elif edge_type == "RANGE":
            # Check if target is an XSD datatype
            if edge.target_uri.startswith("xsd:"):
                datatype_name = edge.target_uri.split(":", 1)[1]
                g.add((source, RDFS.range, XSD[datatype_name]))
            else:
                g.add((source, RDFS.range, target))
        elif edge_type == "HAS_PROPERTY":
            g.add((source, OWL.hasKey, target))
        elif edge_type == "EQUIVALENT_TO":
            g.add((source, OWL.equivalentClass, target))
        elif edge_type == "RELATED_TO":
            # Generic relationship -- create an object property assertion
            rel_uri = _resolve_uri(edge.label or "relatedTo", NS)
            g.add((rel_uri, RDF.type, OWL.ObjectProperty))
            g.add((rel_uri, RDFS.domain, source))
            g.add((rel_uri, RDFS.range, target))
        elif edge_type == "DISJOINT_WITH":
            g.add((source, OWL.disjointWith, target))
        else:
            # Custom relationship type -- model as an object property
            rel_uri = _resolve_uri(edge.label or edge.edge_type, NS)
            g.add((rel_uri, RDF.type, OWL.ObjectProperty))
            if edge.label:
                g.add((rel_uri, RDFS.label, Literal(edge.label)))
            g.add((rel_uri, RDFS.domain, source))
            g.add((rel_uri, RDFS.range, target))

    # -- Serialise --
    format_map = {
        "owl": "xml",
        "ttl": "turtle",
        "jsonld": "json-ld",
    }
    rdf_format = format_map.get(fmt)
    if rdf_format is None:
        raise ValueError(
            f"Unsupported export format '{fmt}'. "
            f"Choose from: owl, ttl, jsonld, json"
        )

    serialised = g.serialize(format=rdf_format)

    logger.info(
        "Exported ontology %s as %s (%d bytes)",
        namespace_uri,
        fmt,
        len(serialised) if serialised else 0,
    )
    return serialised


def _resolve_uri(uri_or_fragment: str, namespace: Namespace) -> "URIRef":
    """Resolve a URI string: if it looks like a full URI, use it directly;
    otherwise treat it as a fragment in the given namespace."""
    from rdflib import URIRef

    if "://" in uri_or_fragment:
        return URIRef(uri_or_fragment)
    return namespace[uri_or_fragment]
