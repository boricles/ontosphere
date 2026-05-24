# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-24

### Added

- Auto-generate class URIs from labels — typing a label auto-fills the URI field with a slugified version using the ontology namespace; URI remains editable for manual override.
- Relationship type picker — after drag-to-connect, a dialog lets you choose the relationship type (SUBCLASS_OF, HAS_PROPERTY, RELATED_TO, EQUIVALENT_TO, DISJOINT_WITH, or custom) instead of defaulting to RELATED_TO.
- Undo/redo for graph editing — client-side mutation stack with Ctrl+Z/Ctrl+Shift+Z keyboard shortcuts; supports undo of add class, delete class, and add relationship operations; undo/redo buttons in toolbar with action descriptions.
- Import existing ontology — new option in the Create Ontology wizard to import .ttl, .owl, .rdf, .jsonld files directly instead of generating from documents; uses rdflib to parse classes, properties, and relationships.

### Changed

- AddClassDialog: Label field moved above URI field for more intuitive flow; added "Auto-generated from label" helper text.

## [0.2.0] - 2026-05-16

### Added

- Visual graph editing — drag between nodes to create relationships, right-click for context menus, toggle edit mode from the toolbar.
- Robust WebSocket reconnection — exponential backoff with dormant mode.
- Class and relationship management in the UI — add classes, draw edges, and delete nodes.
- Refreshed README with screenshots, quick start guide, and updated roadmap.

### Fixed

- editMode reference lost during merge conflict resolution in GraphViewer.tsx.
- Connection banner not appearing on initial WebSocket failure.

## [0.1.0] - 2026-04-19

### Added

- PDF document upload with automatic text extraction and chunking.
- LLM-powered entity and property extraction (Azure OpenAI, OpenAI, Anthropic).
- Automatic ontology assembly with deduplication and hierarchy inference.
- Apache AGE graph storage with per-ontology named graphs.
- Interactive Cytoscape.js force-directed graph visualization.
- Multi-format export: JSON, Turtle (TTL), JSON-LD, RDF/XML.
- SHACL validation of generated ontologies via pyshacl.
- Ontology versioning with snapshot creation on each generation.
- Real-time WebSocket progress updates during processing.
- Background task processing via Celery + Redis.
- Docker Compose orchestration for all services (frontend, backend, PostgreSQL + AGE, Redis).

### Known Issues

- No authentication or authorization; intended for local / trusted-network use only.
- WebSocket reconnection after network interruption is not yet handled gracefully.
- SHACL violation details are not yet surfaced in the graph editor UI.
