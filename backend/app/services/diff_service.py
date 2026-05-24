"""Semantic diff between two ontology version snapshots.

Normalizes both JSON-LD and plain-JSON snapshot formats into a common
{nodes, edges} shape, then computes added / removed / modified elements.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.graph import DiffResult, EdgeDiff, NodeDiff

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Snapshot normalisation
# ---------------------------------------------------------------------------


def _normalize_snapshot(snapshot: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    """Return ``(nodes, edges)`` lists regardless of snapshot format.

    Plain-JSON snapshots have top-level ``"nodes"`` / ``"edges"`` keys.
    JSON-LD snapshots are parsed with rdflib to extract the same data.
    """
    if "nodes" in snapshot:
        return snapshot["nodes"], snapshot.get("edges", [])

    # JSON-LD path
    return _extract_from_jsonld(snapshot)


def _extract_from_jsonld(jsonld_data: dict) -> tuple[list[dict], list[dict]]:
    """Parse a JSON-LD snapshot via rdflib and return (nodes, edges)."""
    from rdflib import BNode, Graph as RdfGraph
    from rdflib.namespace import OWL, RDF, RDFS

    g = RdfGraph()
    g.parse(data=json.dumps(jsonld_data), format="json-ld")

    nodes: list[dict] = []
    edges: list[dict] = []
    seen_uris: set[str] = set()

    # --- Classes ---
    for subj in g.subjects(RDF.type, OWL.Class):
        if isinstance(subj, BNode):
            continue
        uri = str(subj)
        if uri in seen_uris:
            continue
        seen_uris.add(uri)
        label = str(g.value(subj, RDFS.label, default=""))
        description = str(g.value(subj, RDFS.comment, default=""))
        nodes.append({
            "uri": uri,
            "label": label,
            "description": description,
            "node_type": "class",
        })

    # --- subClassOf relationships ---
    for subj, obj in g.subject_objects(RDFS.subClassOf):
        if isinstance(subj, BNode) or isinstance(obj, BNode):
            continue
        edges.append({
            "source_uri": str(subj),
            "target_uri": str(obj),
            "edge_type": "SUBCLASS_OF",
        })

    # --- equivalentClass relationships ---
    for subj, obj in g.subject_objects(OWL.equivalentClass):
        if isinstance(subj, BNode) or isinstance(obj, BNode):
            continue
        edges.append({
            "source_uri": str(subj),
            "target_uri": str(obj),
            "edge_type": "EQUIVALENT_TO",
        })

    # --- ObjectProperty nodes ---
    for subj in g.subjects(RDF.type, OWL.ObjectProperty):
        if isinstance(subj, BNode):
            continue
        uri = str(subj)
        if uri in seen_uris:
            continue
        seen_uris.add(uri)
        label = str(g.value(subj, RDFS.label, default=""))
        description = str(g.value(subj, RDFS.comment, default=""))
        domain = g.value(subj, RDFS.domain)
        range_val = g.value(subj, RDFS.range)
        nodes.append({
            "uri": uri,
            "label": label,
            "description": description,
            "node_type": "property",
        })
        if domain and range_val:
            edges.append({
                "source_uri": str(domain),
                "target_uri": str(range_val),
                "edge_type": "HAS_PROPERTY",
            })

    return nodes, edges


# ---------------------------------------------------------------------------
# Diff computation
# ---------------------------------------------------------------------------


def compute_diff(
    snapshot_a: dict,
    version_a_num: int,
    snapshot_b: dict,
    version_b_num: int,
) -> DiffResult:
    """Compare two version snapshots and return the semantic diff."""
    nodes_a, edges_a = _normalize_snapshot(snapshot_a)
    nodes_b, edges_b = _normalize_snapshot(snapshot_b)

    # --- Node diff (keyed by URI) ---
    map_a: dict[str, dict] = {n["uri"]: n for n in nodes_a}
    map_b: dict[str, dict] = {n["uri"]: n for n in nodes_b}

    uris_a = set(map_a.keys())
    uris_b = set(map_b.keys())

    node_diffs: list[NodeDiff] = []

    for uri in sorted(uris_b - uris_a):
        node_diffs.append(NodeDiff(
            uri=uri,
            label=map_b[uri].get("label", ""),
            status="added",
        ))

    for uri in sorted(uris_a - uris_b):
        node_diffs.append(NodeDiff(
            uri=uri,
            label=map_a[uri].get("label", ""),
            status="removed",
        ))

    for uri in sorted(uris_a & uris_b):
        a_node = map_a[uri]
        b_node = map_b[uri]
        changes: dict[str, dict[str, str]] = {}
        for field in ("label", "description"):
            old = a_node.get(field, "")
            new = b_node.get(field, "")
            if old != new:
                changes[field] = {"old": old, "new": new}
        if changes:
            node_diffs.append(NodeDiff(
                uri=uri,
                label=b_node.get("label", ""),
                status="modified",
                changes=changes,
            ))

    # --- Edge diff (keyed by source+target+type tuple) ---
    def edge_key(e: dict) -> tuple[str, str, str]:
        return (
            e.get("source_uri", e.get("source", "")),
            e.get("target_uri", e.get("target", "")),
            e.get("edge_type", ""),
        )

    set_a = {edge_key(e) for e in edges_a}
    set_b = {edge_key(e) for e in edges_b}

    edge_diffs: list[EdgeDiff] = []

    for src, tgt, etype in sorted(set_b - set_a):
        edge_diffs.append(EdgeDiff(
            source_uri=src, target_uri=tgt, edge_type=etype, status="added",
        ))

    for src, tgt, etype in sorted(set_a - set_b):
        edge_diffs.append(EdgeDiff(
            source_uri=src, target_uri=tgt, edge_type=etype, status="removed",
        ))

    # --- Summary ---
    added_nodes = sum(1 for n in node_diffs if n.status == "added")
    removed_nodes = sum(1 for n in node_diffs if n.status == "removed")
    modified_nodes = sum(1 for n in node_diffs if n.status == "modified")
    added_edges = sum(1 for e in edge_diffs if e.status == "added")
    removed_edges = sum(1 for e in edge_diffs if e.status == "removed")

    parts: list[str] = []
    if added_nodes:
        parts.append(f"Added {added_nodes} class{'es' if added_nodes != 1 else ''}")
    if removed_nodes:
        parts.append(f"removed {removed_nodes} class{'es' if removed_nodes != 1 else ''}")
    if modified_nodes:
        parts.append(f"modified {modified_nodes} class{'es' if modified_nodes != 1 else ''}")
    if added_edges:
        parts.append(f"added {added_edges} relationship{'s' if added_edges != 1 else ''}")
    if removed_edges:
        parts.append(f"removed {removed_edges} relationship{'s' if removed_edges != 1 else ''}")

    summary = ". ".join(parts) + "." if parts else "No changes."
    # Capitalize first letter
    if summary:
        summary = summary[0].upper() + summary[1:]

    return DiffResult(
        from_version=version_a_num,
        to_version=version_b_num,
        nodes=node_diffs,
        edges=edge_diffs,
        summary=summary,
    )
