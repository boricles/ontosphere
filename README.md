# OntoSphere

**Turn documents into navigable knowledge graphs.**

OntoSphere is an open-source tool that extracts structured ontologies from unstructured documents using LLMs. Upload a PDF, and it identifies classes, properties, and relationships -- then assembles them into an OWL/RDF knowledge graph you can explore, visually edit, and export. Built for anyone working with agentic systems, semantic layers, GraphRAG pipelines, or domain-specific ontologies.

![OntoSphere editor with graph visualization](docs/screenshots/editor-graph.png)

---

## What's New in v0.3.0

- **Auto-generate class URIs from labels** -- typing a label auto-fills the URI with a slugified version; fully editable for manual override
- **Relationship type picker** -- after drag-to-connect, choose from SUBCLASS_OF, HAS_PROPERTY, RELATED_TO, EQUIVALENT_TO, DISJOINT_WITH, or enter a custom type
- **Undo/redo for graph editing** -- toolbar buttons and Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts; supports add class, delete class, and add relationship
- **Import existing ontology** -- new option in the Create Ontology wizard to import .ttl, .owl, .rdf, .jsonld files directly using rdflib, as an alternative to generating from documents

## Features

### Document-to-Ontology Pipeline

Upload a PDF and let LLMs (Azure OpenAI, OpenAI, or Anthropic) extract entities, properties, and relationships with full provenance tracking. Processing runs asynchronously via Celery workers with real-time progress updates over WebSocket.

### Visual Graph Editing

Toggle edit mode to modify your ontology directly on the graph canvas. Right-click nodes to edit, delete, or start a new relationship. Right-click empty space to add a new class. Drag between nodes to connect them.

<p align="center">
  <img src="docs/screenshots/add-relationship-context.png" alt="Right-click context menu" width="48%">
  <img src="docs/screenshots/add-class-dialog.png" alt="Add Class dialog" width="48%">
</p>

<p align="center">
  <img src="docs/screenshots/add-relationship-dialog.png" alt="Add Relationship dialog" width="48%">
  <img src="docs/screenshots/ontology-detail.png" alt="Ontology editor detail view" width="48%">
</p>

### Import Existing Ontologies

Already have an ontology? Import it directly. The Create Ontology wizard offers an "Import existing ontology" mode that accepts Turtle (.ttl), OWL/RDF-XML (.owl, .rdf), and JSON-LD (.jsonld) files. The backend parses them with rdflib, extracting classes, properties, and relationships into the graph -- no LLM processing needed.

### Ontology Browser

Browse and manage your ontologies from the dashboard. Each ontology tracks its processing status, document count, and version history.

![Ontology list](docs/screenshots/ontology-list.png)

### Search and Inspect

Search for classes by name and inspect node properties, relationships, and provenance in the side panel.

![Search node](docs/screenshots/search-node.png)

### Multi-Format Export

Export to JSON, Turtle (TTL), JSON-LD, and RDF/XML for use in downstream tools and triple stores.

![Export formats](docs/screenshots/graph-export-formats.png)

### Versioning

Every generation and edit creates a version snapshot. Compare versions and roll back when needed.

![Version history](docs/screenshots/version-history.png)

### SHACL Validation

Validate generated ontologies against SHACL shape constraints. Violations are surfaced directly in the editor.

---

## Quick Start

### Prerequisites

| Dependency     | Version | Notes                              |
|----------------|---------|------------------------------------|
| Docker         | 20.10+  | Required                           |
| Docker Compose | 2.0+    | Required                           |
| LLM API key   | --      | Azure OpenAI, OpenAI, or Anthropic |

### Setup

```bash
# Clone the repository
git clone https://github.com/boricles/ontosphere.git
cd ontosphere

# Create your environment file
cp .env.example .env

# Edit .env and set your LLM API key:
#   ONTOSPHERE_LLM_API_KEY=your-actual-key
#   ONTOSPHERE_LLM_API_BASE=https://YOUR-RESOURCE.openai.azure.com

# Start all services
docker compose up --build -d

# Open the application
#   Frontend:  http://localhost:5173
#   API docs:  http://localhost:8000/docs
```

Database tables are created automatically on first startup.

```bash
docker compose down        # stop, keep data
docker compose down -v     # stop, wipe data
```

---

## Tech Stack

| Layer      | Technology                                                |
|------------|-----------------------------------------------------------|
| Frontend   | React 18, TypeScript, Vite, Cytoscape.js, Tailwind CSS   |
| Backend    | Python 3.11, FastAPI, SQLAlchemy 2.0 (async), Pydantic v2|
| Database   | PostgreSQL 16 + Apache AGE (graph queries)                |
| Queue      | Redis + Celery                                            |
| LLM        | Azure OpenAI / OpenAI / Anthropic (pluggable)             |
| Export     | RDFLib (Turtle, JSON-LD, RDF/XML)                         |
| Validation | pyshacl (SHACL shapes)                                    |

## Architecture

```
                   +---------------------+
                   |     Frontend         |
                   |  React + Vite        |
                   |  Port 5173           |
                   +----------+----------+
                              |
                              | REST / WebSocket
                              v
                   +----------+----------+
                   |     Backend          |
                   |  FastAPI + Uvicorn   |
                   |  Port 8000           |
                   +---+------------+----+
                       |            |
              +--------+--+    +----+--------+
              | PostgreSQL |    |    Redis    |
              | + Apache   |    | (broker +   |
              |   AGE      |    |  pub/sub)   |
              | Port 5432  |    | Port 6379   |
              +------------+    +------+------+
                                       |
                                +------+------+
                                |   Celery    |
                                |   Worker    |
                                +-------------+
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and adjust.

| Variable                       | Default       | Description                            |
|--------------------------------|---------------|----------------------------------------|
| `ONTOSPHERE_LLM_PROVIDER`     | `azure`       | `openai`, `azure`, or `anthropic`      |
| `ONTOSPHERE_LLM_API_BASE`     | --            | Base URL for the LLM API               |
| `ONTOSPHERE_LLM_API_KEY`      | --            | API key for the LLM provider           |
| `ONTOSPHERE_LLM_MODEL`        | `gpt-4o`      | Model / deployment name                |
| `DATABASE_URL`                 | (see .env)    | Async SQLAlchemy connection string     |
| `REDIS_URL`                    | `redis://redis:6379/0` | Redis for Celery and pub/sub  |
| `CORS_ORIGINS`                 | `localhost:*` | Allowed CORS origins                   |

See `.env.example` for the full list.

## API Documentation

Interactive API docs are available when the backend is running:

- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## Development Setup (Without Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Requires a local PostgreSQL with Apache AGE extension and Redis.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Tests

```bash
cd backend && pytest -v
```

---

## Roadmap

- [x] Document upload and text extraction (PDF)
- [x] LLM-based entity/property extraction with provenance
- [x] Automatic ontology assembly
- [x] Apache AGE graph storage
- [x] Interactive graph visualization (Cytoscape.js)
- [x] Multi-format export (JSON, Turtle, JSON-LD, RDF/XML)
- [x] SHACL validation
- [x] Ontology versioning
- [x] Real-time progress via WebSocket
- [x] Docker Compose orchestration
- [x] Robust WebSocket reconnect with dormant mode
- [x] Visual graph editing (drag-to-connect, context menus)
- [x] Auto-generate class URIs from labels
- [x] Relationship type picker in drag-to-connect flow
- [x] Undo/redo for graph editing operations
- [x] Import existing ontology files (.ttl, .owl, .rdf, .jsonld)
- [ ] SHACL violation visualization in graph editor
- [ ] Ontology CI / agent-behavior dry-run (git-style diff, schema-registry compatibility checks, dry-run replay)
- [ ] Collaborative editing
- [ ] Authentication and authorization (OAuth 2.0 / OIDC)

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests
4. Ensure tests pass: `cd backend && pytest -v`
5. Open a Pull Request against `main`

## License

This project is licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) for the full text.

---

Built by [Boris Villazon-Terrazas, PhD](https://www.linkedin.com/in/boris-villazon-terrazas-phd/) ([@boricles](https://github.com/boricles)).
