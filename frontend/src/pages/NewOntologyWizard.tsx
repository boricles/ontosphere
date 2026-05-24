import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { useCreateOntology } from "@/api/ontologies";
import apiClient from "@/api/client";
import type { OntologyCreate, ImportResult } from "@/types/ontology";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Brain, ChevronRight, FileText, Import, Loader2, Play, XCircle } from "lucide-react";
import { toast } from "sonner";

const ACCEPTED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
};

const IMPORT_ACCEPTED_TYPES: Record<string, string[]> = {
  "text/turtle": [".ttl"],
  "application/rdf+xml": [".owl", ".rdf"],
  "application/ld+json": [".jsonld"],
  "application/json": [".json"],
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0">
      {steps.map((label, index) => (
        <div key={label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                index <= currentStep
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {index + 1}
            </div>
            <span className="mt-1 text-xs text-muted-foreground">{label}</span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`mx-2 mb-5 h-0.5 w-12 transition-colors ${
                index < currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export default function NewOntologyWizard() {
  const navigate = useNavigate();
  const createOntology = useCreateOntology();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1: Details
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [namespaceUri, setNamespaceUri] = useState("http://ontosphere.io/ontologies/");

  // Step 2: Documents / Import
  const [files, setFiles] = useState<File[]>([]);
  const [importMode, setImportMode] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles((prev) => [...prev, ...acceptedFiles]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple: true,
  });

  const onImportDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setImportFile(accepted[0]);
  }, []);

  const {
    getRootProps: getImportRootProps,
    getInputProps: getImportInputProps,
    isDragActive: isImportDragActive,
  } = useDropzone({
    onDrop: onImportDrop,
    accept: IMPORT_ACCEPTED_TYPES,
    multiple: false,
  });

  const canProceedStep1 = name.trim().length > 0 && namespaceUri.trim().length > 0;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // 1. Create ontology
      toast.info("Creating ontology...");
      const ontologyData: OntologyCreate = {
        name: name.trim(),
        description: description.trim() || undefined,
        namespace_uri: namespaceUri.trim(),
      };
      const created = await createOntology.mutateAsync(ontologyData);
      toast.success("Ontology created");

      if (importMode) {
        // Import path: upload RDF file directly
        if (!importFile) {
          toast.error("Please select an ontology file to import.");
          return;
        }
        toast.info("Importing ontology...");
        const formData = new FormData();
        formData.append("file", importFile);
        const { data: result } = await apiClient.post<ImportResult>(
          `/ontologies/${created.id}/import`,
          formData,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
        toast.success(
          `Imported ${result.classes_imported} classes, ` +
          `${result.properties_imported} properties, ` +
          `${result.relationships_imported} relationships.`,
        );
      } else {
        // Generate path: upload documents then start LLM processing
        if (files.length > 0) {
          toast.info(`Uploading ${files.length} document(s)...`);
          const formData = new FormData();
          files.forEach((file) => formData.append("files", file));
          await apiClient.post(`/ontologies/${created.id}/documents`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          toast.success("Documents uploaded");
        }
        toast.info("Starting processing pipeline...");
        await apiClient.post(`/ontologies/${created.id}/process`);
        toast.success("Processing started");
      }

      // Navigate to the editor
      navigate(`/ontologies/${created.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      toast.error(`Failed: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-6">
          <Brain className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold">Create New Ontology</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Step Indicator */}
        <div className="mb-8">
          <StepIndicator currentStep={step} steps={["Details", "Documents", "Review"]} />
        </div>

        {/* Step 1: Details */}
        {step === 0 && (
          <Card>
            <CardContent className="space-y-6 p-6">
              <div>
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="My Ontology"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what this ontology represents..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="namespace">
                  Namespace URI <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="namespace"
                  placeholder="http://ontosphere.io/ontologies/"
                  value={namespaceUri}
                  onChange={(e) => setNamespaceUri(e.target.value)}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  The base URI for all entities in this ontology.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Documents / Import */}
        {step === 1 && (
          <Card>
            <CardContent className="space-y-6 p-6">
              {/* Mode toggle */}
              <div className="flex gap-2">
                <Button
                  variant={importMode ? "outline" : "default"}
                  size="sm"
                  onClick={() => setImportMode(false)}
                >
                  Generate from documents
                </Button>
                <Button
                  variant={importMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setImportMode(true)}
                >
                  Import existing ontology
                </Button>
              </div>

              {!importMode ? (
                <>
                  {/* Document dropzone (existing) */}
                  <div
                    {...getRootProps()}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
                      isDragActive
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50"
                    }`}
                  >
                    <input {...getInputProps()} />
                    <FileText className="h-10 w-10 text-muted-foreground/50" />
                    {isDragActive ? (
                      <p className="mt-3 text-sm text-primary">Drop files here...</p>
                    ) : (
                      <>
                        <p className="mt-3 text-sm font-medium">
                          Drag & drop files here, or click to browse
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Supports PDF, DOCX, TXT, and Markdown files
                        </p>
                      </>
                    )}
                  </div>

                  {files.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-medium">
                        Uploaded Files ({files.length})
                      </h3>
                      <ul className="divide-y rounded-lg border">
                        {files.map((file, index) => (
                          <li
                            key={`${file.name}-${index}`}
                            className="flex items-center justify-between px-4 py-2.5"
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="truncate text-sm">{file.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                ({formatFileSize(file.size)})
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(index)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {files.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground">
                      No files added yet. You can also skip this step and upload documents later.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {/* Import dropzone */}
                  <div
                    {...getImportRootProps()}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
                      isImportDragActive
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50"
                    }`}
                  >
                    <input {...getImportInputProps()} />
                    <Import className="h-10 w-10 text-muted-foreground/50" />
                    {isImportDragActive ? (
                      <p className="mt-3 text-sm text-primary">Drop ontology file here...</p>
                    ) : (
                      <>
                        <p className="mt-3 text-sm font-medium">
                          Drag & drop an ontology file, or click to browse
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Supports Turtle (.ttl), OWL/RDF-XML (.owl, .rdf), and JSON-LD (.jsonld)
                        </p>
                      </>
                    )}
                  </div>

                  {importFile ? (
                    <div className="flex items-center justify-between rounded-lg border px-4 py-2.5">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm">{importFile.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          ({formatFileSize(importFile.size)})
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setImportFile(null)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground">
                      Select an existing ontology file to import.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Review */}
        {step === 2 && (
          <Card>
            <CardContent className="space-y-6 p-6">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Ontology Details</h3>
                <dl className="mt-2 space-y-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Name</dt>
                    <dd className="text-sm font-medium">{name}</dd>
                  </div>
                  {description && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Description</dt>
                      <dd className="text-sm">{description}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Namespace URI</dt>
                    <dd className="truncate text-sm font-mono">{namespaceUri}</dd>
                  </div>
                </dl>
              </div>

              <hr />

              {importMode ? (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Import File
                  </h3>
                  {importFile ? (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{importFile.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({formatFileSize(importFile.size)})
                      </span>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No file selected.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    The graph will be imported directly. No LLM processing.
                  </p>
                </div>
              ) : (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Documents ({files.length})
                  </h3>
                  {files.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {files.map((file, index) => (
                        <li key={`${file.name}-${index}`} className="flex items-center gap-2 text-sm">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{file.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({formatFileSize(file.size)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No documents. Processing will create an empty ontology scaffold.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Navigation Buttons */}
        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => (step === 0 ? navigate("/") : setStep(step - 1))}
            disabled={isSubmitting}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>

          {step < 2 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 0 && !canProceedStep1}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : importMode ? (
                <>
                  <Import className="mr-2 h-4 w-4" />
                  Create & Import
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Create & Process
                </>
              )}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
