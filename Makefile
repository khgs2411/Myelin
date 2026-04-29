.PHONY: init status status-all prune help compile compile-continue update update-continue apply-pending reject-pending measure measure-legacy measure-tokens lint ask obsidian obsidian-all

SYSTEM_PATH := /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

USER_PROJECT_PATH :=
ifeq ($(origin PATH), command line)
USER_PROJECT_PATH := $(PATH)
else ifeq ($(origin REPO_PATH), command line)
USER_PROJECT_PATH := $(REPO_PATH)
endif

help:
	@echo "Targets:"
	@echo "  make init PROJECT=<project-key> [NAME=<display-name>] [PATH=/path/to/project] [TAGS=a|b] [RELATED_CONCEPTS=a|b] [FOCUSES=a|b]"
	@echo "  make compile PROJECT=<project-key> [AUTO=1]  # full recompile of the project brain"
	@echo "  make compile-continue PROJECT=<project-key>  # resume after gated approval"
	@echo "  make update PROJECT=<project-key> [AUTO=1]  # drain inbox, apply gap-note patches (lighter than compile)"
	@echo "  make update-continue PROJECT=<project-key>  # resume a gated ingest proposal"
	@echo "  make lint PROJECT=<project-key>  # standalone validate against latest run"
	@echo "  make status PROJECT=<project-key>"
	@echo "  make status-all"
	@echo "  make prune [PROJECT=<project-key>] [GLOBAL=1]"
	@echo "  make apply-pending PROJECT=<project-key> PROPOSAL=<proposal-id>  # apply deferred destructive slice"
	@echo "  make reject-pending PROJECT=<project-key> PROPOSAL=<proposal-id>  # archive slice without applying"
	@echo "  make measure PROJECT=<project-key> [NO_EMIT=1]  # score wiki against acceptance-questions.md (emits gap-notes for partial credit unless NO_EMIT=1)"
	@echo "  make measure-legacy PROJECT=<project-key>"
	@echo "  make ask PROJECT=<project-key> Q=\"your question\""
	@echo "  make obsidian PROJECT=<project-key>  # generate Obsidian projection under projects/<key>/obsidian/"
	@echo "  make obsidian-all  # regenerate Obsidian projections for all registered projects"
	@echo "  make measure-tokens PROJECT=<project-key> TASK=\"<brief>\""
	@echo ""
	@echo "Common flags:"
	@echo "  AUTO=1                    auto-approve non-destructive units (compile, update)"
	@echo "                            destructive/high-uncertainty units still gate to pending-approvals/"
	@echo "  NO_EMIT=1                 suppress gap-note emission during measure"
	@echo "  MODEL=<backend>           override LLM backend (see MODEL selector below) -"
	@echo "                            applies to compile, update, measure, ask, measure-tokens"
	@echo "  MODEL_REASONING_EFFORT=<level>"
	@echo "                            override Codex reasoning effort; compile/update default to high"
	@echo "  RANKING_CUTOFF=<n>        override ranking snapshot cutoff (compile)"
	@echo "  CODEX_BIN / CLAUDE_BIN    override CLI binary path (default: looked up on PATH)"
	@echo "  GLOBAL=1                  scope prune to global (non-project) artifacts"
	@echo ""
	@echo "MODEL selector (default: codex):"
	@echo "  MODEL=codex              use Codex CLI default model"
	@echo "  MODEL=codex/<id>         use Codex CLI with a specific model id"
	@echo "  MODEL=claude             use Claude CLI default model"
	@echo "  MODEL=claude/<id>        use Claude CLI with a specific model id"
	@echo "  MODEL=<id>               legacy: pass <id> to Codex as the model"
	@echo ""
	@echo "Pipeline default when MODEL is unset:"
	@echo "  compile/update stages use codex/gpt-5.4 with MODEL_REASONING_EFFORT=high"

init:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make init PROJECT=my_project" && exit 1)
	@/usr/bin/env PATH="$(SYSTEM_PATH)" ./scripts/init_project.sh --project "$(PROJECT)" \
		$(if $(NAME),--name "$(NAME)",) \
		$(if $(USER_PROJECT_PATH),--path "$(USER_PROJECT_PATH)",) \
		$(if $(TAGS),--tags "$(TAGS)",) \
		$(if $(RELATED_CONCEPTS),--related-concepts "$(RELATED_CONCEPTS)",) \
		$(if $(FOCUSES),--focuses "$(FOCUSES)",)

status:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@./scripts/status.sh --project "$(PROJECT)"

status-all:
	@./scripts/status.sh --all

prune:
	@if [ -n "$(PROJECT)" ]; then \
		./scripts/prune_artifacts.sh --project "$(PROJECT)"; \
	elif [ "$(GLOBAL)" = "1" ]; then \
		./scripts/prune_artifacts.sh --global; \
	else \
		./scripts/prune_artifacts.sh; \
	fi

compile:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make compile PROJECT=sample" && exit 1)
	@bash scripts/compile.sh --project $(PROJECT)
	@$(MAKE) --no-print-directory obsidian PROJECT="$(PROJECT)"

compile-continue:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make compile-continue PROJECT=sample" && exit 1)
	@CONTINUE=1 bash scripts/compile.sh --project $(PROJECT)
	@$(MAKE) --no-print-directory obsidian PROJECT="$(PROJECT)"

update:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update PROJECT=sample" && exit 1)
	@bash scripts/update.sh --project $(PROJECT)
	@$(MAKE) --no-print-directory obsidian PROJECT="$(PROJECT)"

update-continue:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update-continue PROJECT=sample" && exit 1)
	@CONTINUE=1 bash scripts/update.sh --project $(PROJECT)
	@$(MAKE) --no-print-directory obsidian PROJECT="$(PROJECT)"

apply-pending:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(PROPOSAL)" || (echo "PROPOSAL is required, for example: make apply-pending PROJECT=sample PROPOSAL=20260418-...-update" && exit 1)
	@bash scripts/apply_pending.sh --project $(PROJECT) --proposal $(PROPOSAL)

reject-pending:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(PROPOSAL)" || (echo "PROPOSAL is required" && exit 1)
	@bash scripts/reject_pending.sh --project $(PROJECT) --proposal $(PROPOSAL)

lint:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@PROJECT="$(PROJECT)" PROJECTS_ROOT="$${UPDATE_PROJECTS_ROOT:-$$(pwd)/projects}" \
	  bash -c '\
	    project_dir="$$PROJECTS_ROOT/$$PROJECT"; \
	    latest="$$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(\"latest_run_dir\") or \"\")" "$$project_dir/state/update-state.json" 2>/dev/null)"; \
	    if [ -z "$$latest" ] || [ ! -d "$$latest" ]; then \
	      echo "error: no prior run found (latest_run_dir empty in update-state.json). Run make compile first." >&2; \
	      exit 1; \
	    fi; \
	    python3 scripts/backfill_metadata.py --project-dir "$$project_dir"; \
	    bash agents/update/06-validate/run.sh --project "$$PROJECT" --project-dir "$$project_dir" --run-dir "$$latest" \
	  '

measure:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@bash scripts/measure_llm.sh --project $(PROJECT)

measure-legacy:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@bash scripts/measure.sh --project $(PROJECT)

ask:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(Q)" || (echo 'Q="your question" is required' && exit 1)
	@bash scripts/ask.sh --project $(PROJECT) --question "$(Q)"

obsidian:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@PROJECT="$(PROJECT)" PROJECTS_ROOT="$${UPDATE_PROJECTS_ROOT:-$$(pwd)/projects}" \
	  bash -c '\
	    project_dir="$$PROJECTS_ROOT/$$PROJECT"; \
	    python3 scripts/backfill_metadata.py --project-dir "$$project_dir"; \
	    python3 scripts/export_obsidian.py --project-dir "$$project_dir" \
	  '

obsidian-all:
	@PROJECTS_ROOT="$${UPDATE_PROJECTS_ROOT:-$$(pwd)/projects}" \
	  bash -c '\
	    rc=0; \
	    for project_dir in "$$PROJECTS_ROOT"/*; do \
	      [ -d "$$project_dir" ] || continue; \
	      [ -f "$$project_dir/state/project.json" ] || continue; \
	      project="$$(basename "$$project_dir")"; \
	      if ! $(MAKE) --no-print-directory obsidian PROJECT="$$project"; then \
	        rc=1; \
	      fi; \
	    done; \
	    exit "$$rc" \
	  '

measure-tokens:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(TASK)" || (echo "TASK is required, for example: make measure-tokens PROJECT=sample TASK=\"implement rate limiting\"" && exit 1)
	@bash scripts/measure_tokens.sh --project $(PROJECT) --task "$(TASK)"
