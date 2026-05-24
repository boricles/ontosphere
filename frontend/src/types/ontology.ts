export interface Ontology {
  id: string;
  name: string;
  description: string;
  namespace_uri: string;
  status: "draft" | "processing" | "ready" | "error";
  created_at: string;
  updated_at: string;
  document_count: number;
}

export interface OntologyCreate {
  name: string;
  description?: string;
  namespace_uri: string;
}

export interface OntologyUpdate {
  name?: string;
  description?: string;
  namespace_uri?: string;
}

export interface Document {
  id: string;
  ontology_id: string;
  filename: string;
  content_type: string;
  file_size: number;
  status: string;
  error_message?: string;
  uploaded_at: string;
}

export interface GraphNode {
  id: string;
  uri: string;
  label: string;
  node_type: "class" | "property" | "individual";
  properties: Record<string, unknown>;
  description: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edge_type: string;
  properties: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ClassCreate {
  uri: string;
  label: string;
  description?: string;
  parent_uri?: string;
}

export interface ClassUpdate {
  label?: string;
  description?: string;
}

export interface PropertyCreate {
  uri: string;
  label: string;
  domain_uri: string;
  range_uri: string;
  description?: string;
}

export interface RelationshipCreate {
  source_uri: string;
  target_uri: string;
  relationship_type: string;
}

export interface ValidationResult {
  conforms: boolean;
  violations: ValidationViolation[];
  results_text: string;
}

export interface ValidationViolation {
  severity: string;
  focus_node: string;
  message: string;
  path: string;
}

export interface OntologyVersion {
  id: string;
  ontology_id: string;
  version_number: number;
  description: string;
  created_at: string;
}

export interface TaskStatus {
  task_id: string;
  status: string;
  progress: number;
  message: string;
}

export interface ImportResult {
  status: string;
  classes_imported: number;
  properties_imported: number;
  relationships_imported: number;
  message: string;
}

export interface NodeDiff {
  uri: string;
  label: string;
  status: "added" | "removed" | "modified";
  changes: Record<string, { old: string; new: string }>;
}

export interface EdgeDiff {
  source_uri: string;
  target_uri: string;
  edge_type: string;
  status: "added" | "removed";
}

export interface BreakingChange {
  severity: "error" | "warning";
  category: string;
  message: string;
  affected_uris: string[];
}

export interface DiffResult {
  from_version: number;
  to_version: number;
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  breaking_changes: BreakingChange[];
  summary: string;
}
