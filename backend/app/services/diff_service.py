"""Semantic diff between two ontology version snapshots.

Normalizes both JSON-LD and plain-JSON snapshot formats into a common
{nodes, edges} shape, then computes added / removed / modified elements.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.schemas.graph import BreakingChange, DiffResult, EdgeDiff, NodeDiff

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


def _check_compatibility(
    node_diffs: list[NodeDiff],
    edge_diffs: list[EdgeDiff],
    edges_a: list[dict],
    map_a: dict[str, dict],
    map_b: dict[str, dict],
) -> list[BreakingChange]:
    """Run compatibility checks on the diff and return breaking changes."""
    changes: list[BreakingChange] = []

    removed_uris = {n.uri for n in node_diffs if n.status == "removed"}

    # Build lookup structures from the "from" snapshot edges
    def edge_src_or_tgt(e: dict) -> tuple[str, str]:
        src = e.get("source_uri", e.get("source", ""))
        tgt = e.get("target_uri", e.get("target", ""))
        return src, tgt

    # ERROR: orphaned_edges — removed node had connected edges
    for uri in sorted(removed_uris):
        label = map_a.get(uri, {}).get("label", "") or uri
        connected = sum(
            1 for e in edges_a
            if uri in edge_src_or_tgt(e)
        )
        if connected > 0:
            changes.append(BreakingChange(
                severity="error",
                category="orphaned_edges",
                message=f"Removed class '{label}' has {connected} connected relationship{'s' if connected != 1 else ''} that will be orphaned",
                affected_uris=[uri],
            ))

    # ERROR: broken_hierarchy — removed node was target of SUBCLASS_OF
    for uri in sorted(removed_uris):
        label = map_a.get(uri, {}).get("label", "") or uri
        subclasses = [
            e for e in edges_a
            if e.get("edge_type", "") == "SUBCLASS_OF"
            and (e.get("target_uri", e.get("target", "")) == uri)
        ]
        if subclasses:
            n = len(subclasses)
            changes.append(BreakingChange(
                severity="error",
                category="broken_hierarchy",
                message=f"Removed class '{label}' breaks the class hierarchy \u2014 {n} subclass{'es' if n != 1 else ''} lose their parent",
                affected_uris=[uri],
            ))

    # WARNING: relationship_type_change — same source+target, different edge_type
    edges_b_by_pair: dict[tuple[str, str], str] = {}
    for ed in edge_diffs:
        if ed.status == "added":
            edges_b_by_pair[(ed.source_uri, ed.target_uri)] = ed.edge_type

    for ed in edge_diffs:
        if ed.status == "removed":
            pair = (ed.source_uri, ed.target_uri)
            if pair in edges_b_by_pair:
                new_type = edges_b_by_pair[pair]
                if new_type != ed.edge_type:
                    src_label = map_b.get(pair[0], map_a.get(pair[0], {})).get("label", "") or pair[0]
                    tgt_label = map_b.get(pair[1], map_a.get(pair[1], {})).get("label", "") or pair[1]
                    changes.append(BreakingChange(
                        severity="warning",
                        category="relationship_type_change",
                        message=f"Relationship between '{src_label}' and '{tgt_label}' changed from {ed.edge_type} to {new_type}",
                        affected_uris=[pair[0], pair[1]],
                    ))

    # WARNING: high_impact_removal — more than 3 nodes removed
    if len(removed_uris) > 3:
        changes.append(BreakingChange(
            severity="warning",
            category="high_impact_removal",
            message=f"Large-scale removal: {len(removed_uris)} classes deleted \u2014 review carefully",
            affected_uris=sorted(removed_uris),
        ))

    # WARNING: property_domain_range_removed — removed node used as domain/range
    property_edges_a = [
        e for e in edges_a
        if e.get("edge_type", "") in ("HAS_PROPERTY", "DOMAIN", "RANGE")
    ]
    for uri in sorted(removed_uris):
        label = map_a.get(uri, {}).get("label", "") or uri
        prop_refs = sum(
            1 for e in property_edges_a
            if uri in edge_src_or_tgt(e)
        )
        if prop_refs > 0:
            changes.append(BreakingChange(
                severity="warning",
                category="property_domain_range_removed",
                message=f"Removed class '{label}' was used as domain/range for {prop_refs} property definition{'s' if prop_refs != 1 else ''}",
                affected_uris=[uri],
            ))

    return changes


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

    # --- Compatibility checks ---
    breaking_changes = _check_compatibility(
        node_diffs, edge_diffs, edges_a, map_a, map_b,
    )

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

    if breaking_changes:
        n_errors = sum(1 for bc in breaking_changes if bc.severity == "error")
        n_warnings = sum(1 for bc in breaking_changes if bc.severity == "warning")
        bc_parts: list[str] = []
        if n_errors:
            bc_parts.append(f"{n_errors} error{'s' if n_errors != 1 else ''}")
        if n_warnings:
            bc_parts.append(f"{n_warnings} warning{'s' if n_warnings != 1 else ''}")
        summary += f" Compatibility: {', '.join(bc_parts)}."

    return DiffResult(
        from_version=version_a_num,
        to_version=version_b_num,
        nodes=node_diffs,
        edges=edge_diffs,
        breaking_changes=breaking_changes,
        summary=summary,
    )
