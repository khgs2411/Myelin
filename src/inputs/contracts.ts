export const EXPERIENCE_CONTENT_EVENT_KINDS = ["user.prompt", "assistant.response"] as const;

export type ExperienceContentEventKind = (typeof EXPERIENCE_CONTENT_EVENT_KINDS)[number];

export type ProviderInputMetadata = {
  id?: string;
  occurred_at?: string;
  hook_event_name: string | null;
  cwd: string | null;
  provider: string;
  provider_session_id: string | null;
  turn_id: string | null;
  raw_payload_json: string;
  source: string;
};

export type ExperienceContentInput = {
  kind: "experience";
  event: ProviderInputMetadata & {
    event_kind: ExperienceContentEventKind;
    raw_text: string;
  };
};

export type ControlSignalInput = {
  kind: "control";
  signal: ProviderInputMetadata & {
    signal_kind: "session.start";
  };
};

export type IgnoredProviderInput = {
  kind: "ignored";
  diagnostic: ProviderInputMetadata & {
    reason:
      | "empty-content"
      | "internal-orchestration-prompt"
      | "internal-session-start"
      | "malformed-payload"
      | "unsupported-event";
  };
};

export type ProviderInput = ExperienceContentInput | ControlSignalInput | IgnoredProviderInput;

export type InputProviderAdapter = {
  classify(payload: unknown, occurredAt?: Date): ProviderInput;
};
