export type SourceClassificationRule = {
  rule: "source-classification";
  description: string;
  required_fields: string[];
  source_kind: string[];
  ownership: string[];
  action: string[];
  notes?: string;
};

export type MemoryScopesRule = {
  rule: "memory-scopes";
  description: string;
  scopes: { key: string; summary: string }[];
  phase_0_active: string[];
  phase_0_deferred: string[];
};

export type PageTaxonomyRule = {
  rule: "page-taxonomy";
  description: string;
  categories: { key: string; summary: string }[];
};

export type SchemaInputs = Record<string, string>;

export type SchemaContext = {
  schema_version: "0";
  built_at: string;
  inputs: SchemaInputs;
  source_classification: {
    required_fields: string[];
    source_kind: string[];
    ownership: string[];
    action: string[];
  };
  memory_scopes: {
    scopes: string[];
    phase_0_active: string[];
    phase_0_deferred: string[];
  };
  page_taxonomy: {
    categories: string[];
  };
  provenance: {
    required: string[];
  };
  cli_vocabulary: {
    commands: string[];
  };
};
