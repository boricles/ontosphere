import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/api/client";
import type {
  Ontology,
  OntologyCreate,
  OntologyUpdate,
  Document,
  GraphData,
  ClassCreate,
  ClassUpdate,
  RelationshipCreate,
  ValidationResult,
  OntologyVersion,
  TaskStatus,
  DiffResult,
} from "@/types/ontology";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const keys = {
  all: ["ontologies"] as const,
  detail: (id: string) => ["ontologies", id] as const,
  documents: (id: string) => ["ontologies", id, "documents"] as const,
  graph: (id: string) => ["ontologies", id, "graph"] as const,
  status: (id: string) => ["ontologies", id, "status"] as const,
  versions: (id: string) => ["ontologies", id, "versions"] as const,
  diff: (id: string, v1: string, v2: string) =>
    ["ontologies", id, "versions", "diff", v1, v2] as const,
};

// ---------------------------------------------------------------------------
// Ontology CRUD
// ---------------------------------------------------------------------------

export function useOntologies() {
  return useQuery<Ontology[]>({
    queryKey: keys.all,
    queryFn: async () => {
      const { data } = await apiClient.get<Ontology[]>("/ontologies/");
      return data;
    },
  });
}

export function useOntology(id: string) {
  return useQuery<Ontology>({
    queryKey: keys.detail(id),
    queryFn: async () => {
      const { data } = await apiClient.get<Ontology>(`/ontologies/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateOntology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OntologyCreate) => {
      const { data } = await apiClient.post<Ontology>("/ontologies", payload);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}

export function useUpdateOntology(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OntologyUpdate) => {
      const { data } = await apiClient.patch<Ontology>(
        `/ontologies/${id}`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.detail(id) });
      void qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}

export function useDeleteOntology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/ontologies/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function useUploadDocuments(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const { data } = await apiClient.post<Document[]>(
        `/ontologies/${ontologyId}/documents`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.documents(ontologyId) });
      void qc.invalidateQueries({ queryKey: keys.detail(ontologyId) });
    },
  });
}

export function useDocuments(ontologyId: string) {
  return useQuery<Document[]>({
    queryKey: keys.documents(ontologyId),
    queryFn: async () => {
      const { data } = await apiClient.get<Document[]>(
        `/ontologies/${ontologyId}/documents`,
      );
      return data;
    },
    enabled: !!ontologyId,
  });
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export function useProcessOntology(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<TaskStatus>(
        `/ontologies/${ontologyId}/process`,
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.status(ontologyId) });
      void qc.invalidateQueries({ queryKey: keys.detail(ontologyId) });
    },
  });
}

export function useOntologyStatus(ontologyId: string, isProcessing: boolean) {
  return useQuery<TaskStatus>({
    queryKey: keys.status(ontologyId),
    queryFn: async () => {
      const { data } = await apiClient.get<TaskStatus>(
        `/ontologies/${ontologyId}/status`,
      );
      return data;
    },
    enabled: !!ontologyId && isProcessing,
    refetchInterval: isProcessing ? 2000 : false,
  });
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export function useGraph(ontologyId: string) {
  return useQuery<GraphData>({
    queryKey: keys.graph(ontologyId),
    queryFn: async () => {
      const { data } = await apiClient.get<GraphData>(
        `/ontologies/${ontologyId}/graph`,
      );
      return data;
    },
    enabled: !!ontologyId,
  });
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export function useAddClass(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ClassCreate) => {
      const { data } = await apiClient.post(
        `/ontologies/${ontologyId}/classes`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.graph(ontologyId) });
    },
  });
}

export function useUpdateClass(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      uri,
      payload,
    }: {
      uri: string;
      payload: ClassUpdate;
    }) => {
      const { data } = await apiClient.patch(
        `/ontologies/${ontologyId}/classes/${encodeURIComponent(uri)}`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.graph(ontologyId) });
    },
  });
}

export function useDeleteClass(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (uri: string) => {
      await apiClient.delete(
        `/ontologies/${ontologyId}/classes/${encodeURIComponent(uri)}`,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.graph(ontologyId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export function useAddRelationship(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: RelationshipCreate) => {
      const { data } = await apiClient.post(
        `/ontologies/${ontologyId}/relationships`,
        payload,
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.graph(ontologyId) });
    },
  });
}

export function useDeleteRelationship(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (relationshipId: string) => {
      await apiClient.delete(
        `/ontologies/${ontologyId}/relationships/${relationshipId}`,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.graph(ontologyId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const EXPORT_EXTENSIONS: Record<string, string> = {
  owl: "rdf",
  ttl: "ttl",
  jsonld: "jsonld",
  json: "json",
};

export async function downloadExport(
  ontologyId: string,
  format: string,
  ontologyName?: string,
): Promise<void> {
  const base = apiClient.defaults.baseURL ?? "/api";
  const resp = await fetch(
    `${base}/ontologies/${ontologyId}/export?format=${encodeURIComponent(format)}`,
  );
  if (!resp.ok) {
    throw new Error(`Export failed (${resp.status})`);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ext = EXPORT_EXTENSIONS[format] ?? format;
  const name = ontologyName ?? `ontology_${ontologyId}`;
  a.download = `${name}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function useValidateOntology(ontologyId: string) {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<ValidationResult>(
        `/ontologies/${ontologyId}/validate`,
      );
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function useVersions(ontologyId: string) {
  return useQuery<OntologyVersion[]>({
    queryKey: keys.versions(ontologyId),
    queryFn: async () => {
      const { data } = await apiClient.get<OntologyVersion[]>(
        `/ontologies/${ontologyId}/versions`,
      );
      return data;
    },
    enabled: !!ontologyId,
  });
}

export function useCreateVersion(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (description: string) => {
      const { data } = await apiClient.post<OntologyVersion>(
        `/ontologies/${ontologyId}/versions`,
        { description },
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.versions(ontologyId) });
    },
  });
}

export function useRollbackVersion(ontologyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const { data } = await apiClient.post(
        `/ontologies/${ontologyId}/versions/${versionId}/rollback`,
      );
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.detail(ontologyId) });
      void qc.invalidateQueries({ queryKey: keys.graph(ontologyId) });
      void qc.invalidateQueries({ queryKey: keys.versions(ontologyId) });
    },
  });
}

export function useVersionDiff(
  ontologyId: string,
  versionAId: string,
  versionBId: string,
) {
  return useQuery<DiffResult>({
    queryKey: keys.diff(ontologyId, versionAId, versionBId),
    queryFn: async () => {
      const { data } = await apiClient.get<DiffResult>(
        `/ontologies/${ontologyId}/versions/${versionAId}/diff/${versionBId}`,
      );
      return data;
    },
    enabled: !!ontologyId && !!versionAId && !!versionBId,
  });
}
