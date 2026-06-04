import { z } from "zod";

const nonEmptyString = z.string().min(1);
const stringList = z.array(nonEmptyString).min(1);
const keyedSummary = z.object({
  key: nonEmptyString,
  summary: nonEmptyString,
});

export const sourceClassificationRuleSchema = z.object({
  rule: z.literal("source-classification"),
  description: nonEmptyString,
  required_fields: stringList,
  source_kind: stringList,
  ownership: stringList,
  action: stringList,
  notes: z.string().optional(),
});

export const memoryScopesRuleSchema = z
  .object({
    rule: z.literal("memory-scopes"),
    description: nonEmptyString,
    scopes: z.array(keyedSummary).min(1),
    phase_0_active: stringList,
    phase_0_deferred: stringList,
  })
  .superRefine((rule, ctx) => {
    const scopes = new Set(rule.scopes.map((scope) => scope.key));
    for (const key of [...rule.phase_0_active, ...rule.phase_0_deferred]) {
      if (!scopes.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `phase_0 scope is not declared in scopes: ${key}`,
          path: ["scopes"],
        });
      }
    }
  });

export const pageTaxonomyRuleSchema = z.object({
  rule: z.literal("page-taxonomy"),
  description: nonEmptyString,
  categories: z.array(keyedSummary).min(1),
});

export const schemaContextSchema = z.object({
  schema_version: z.literal("0"),
  built_at: z.string().datetime(),
  inputs: z.record(nonEmptyString, nonEmptyString.regex(/^[a-f0-9]{64}$/)),
  source_classification: z.object({
    required_fields: stringList,
    source_kind: stringList,
    ownership: stringList,
    action: stringList,
  }),
  memory_scopes: z.object({
    scopes: stringList,
    phase_0_active: stringList,
    phase_0_deferred: stringList,
  }),
  page_taxonomy: z.object({
    categories: stringList,
  }),
  provenance: z.object({
    required: stringList,
  }),
  cli_vocabulary: z.object({
    commands: stringList,
  }),
});
