"""Pydantic v2 schemas for graph-related API payloads."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Graph data transfer objects
# ---------------------------------------------------------------------------


class GraphNode(BaseModel):
    """Single node in the visual graph."""

    id: str
    uri: str
    label: str
    node_type: Literal["class", "property", "individual"]
    properties: dict = Field(default_factory=dict)
    description: str = ""


class GraphEdge(BaseModel):
    """Single edge in the visual graph."""

    id: str
    source: str
    target: str
    edge_type: str
    properties: dict = Field(default_factory=dict)


class GraphData(BaseModel):
    """Complete graph payload sent to the frontend."""

    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Mutation payloads
# ---------------------------------------------------------------------------


class ClassCreate(BaseModel):
    """Create a new OWL class node."""

    uri: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    description: str = ""
    parent_uri: str | None = None


class ClassUpdate(BaseModel):
    """Partial update for an OWL class node."""

    label: str | None = None
    description: str | None = None


class PropertyCreate(BaseModel):
    """Create a new OWL property edge."""

    uri: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    domain_uri: str = Field(..., min_length=1)
    range_uri: str = Field(..., min_length=1)
    description: str = ""


class RelationshipCreate(BaseModel):
    """Create an arbitrary relationship between two nodes."""

    source_uri: str = Field(..., min_length=1)
    target_uri: str = Field(..., min_length=1)
    relationship_type: str = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# SHACL Validation
# ---------------------------------------------------------------------------


class ValidationViolation(BaseModel):
    """A single SHACL validation violation."""

    severity: str
    focus_node: str
    message: str
    path: str = ""


class ValidationResult(BaseModel):
    """Aggregated SHACL validation result."""

    conforms: bool
    violations: list[ValidationViolation] = Field(default_factory=list)
    results_text: str = ""


# ---------------------------------------------------------------------------
# Version diff
# ---------------------------------------------------------------------------


class NodeDiff(BaseModel):
    """A single node change between two versions."""

    uri: str
    label: str
    status: Literal["added", "removed", "modified"]
    changes: dict = Field(default_factory=dict)


class EdgeDiff(BaseModel):
    """A single edge change between two versions."""

    source_uri: str
    target_uri: str
    edge_type: str
    status: Literal["added", "removed"]


class BreakingChange(BaseModel):
    """A compatibility issue detected between two versions."""

    severity: Literal["error", "warning"]
    category: str
    message: str
    affected_uris: list[str] = Field(default_factory=list)


class DiffResult(BaseModel):
    """Semantic diff between two ontology version snapshots."""

    from_version: int
    to_version: int
    nodes: list[NodeDiff] = Field(default_factory=list)
    edges: list[EdgeDiff] = Field(default_factory=list)
    breaking_changes: list[BreakingChange] = Field(default_factory=list)
    summary: str = ""
