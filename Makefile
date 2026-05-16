.PHONY: init status dashboard prune help compile compile-continue update update-continue post-brain-refresh apply-pending reject-pending measure measure-legacy measure-tokens measure-routes measure-routes-all lint ask obsidian obsidian-all

SYSTEM_PATH := /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

USER_PROJECT_PATH :=
ifeq ($(origin PATH), command line)
USER_PROJECT_PATH := $(PATH)
else ifeq ($(origin REPO_PATH), command line)
USER_PROJECT_PATH := $(REPO_PATH)
endif

help:
	@echo "Daily operator commands:"
	@echo "  make init PROJECT=<project-key> [NAME=<display-name>] [PATH=/path/to/project] [TAGS=a|b] [RELATED_CONCEPTS=a|b] [FOCUSES=a|b]"
	@echo "      Scaffold a new project brain."
	@echo "  make compile PROJECT=<project-key> [AUTO=1]"
	@echo "      Full repo-truth refresh. Runs compile pipeline, then post-brain-refresh."
	@echo "  make update PROJECT=<project-key> [AUTO=1]"
	@echo "      Drain project inbox gap notes. Runs update pipeline, then post-brain-refresh."
	@echo ""
	@echo "Resume / approval commands:"
	@echo "  make compile-continue PROJECT=<project-key>"
	@echo "      Resume compile after approving a gated proposal."
	@echo "  make update-continue PROJECT=<project-key>"
	@echo "      Resume update after approving a gated ingest proposal."
	@echo "  make apply-pending PROJECT=<project-key> PROPOSAL=<proposal-id>"
	@echo "      Apply a deferred destructive slice."
	@echo "  make reject-pending PROJECT=<project-key> PROPOSAL=<proposal-id>"
	@echo "      Archive a deferred destructive slice without applying it."
	@echo ""
	@echo "Status and post-refresh:"
	@echo "  make status PROJECT=<project-key>"
	@echo "      Show inbox, validation, route health, runtime profile, freshness, and next-step hints."
	@echo "  make dashboard"
	@echo "      Compact inbox and health overview for all registered projects."
	@echo "  make post-brain-refresh PROJECT=<project-key>"
	@echo "      Refresh Obsidian, run NO_EMIT=1 route measurement, then print status."
	@echo "      compile/update already run this automatically after a successful pipeline."
	@echo ""
	@echo "Manual diagnostics:"
	@echo "  make lint PROJECT=<project-key>"
	@echo "      Standalone validate against the latest run."
	@echo "  make measure PROJECT=<project-key> [NO_EMIT=1]"
	@echo "      LLM-scored acceptance measurement; emits gap notes unless NO_EMIT=1."
	@echo "  make measure-routes PROJECT=<project-key> [NO_EMIT=1]"
	@echo "      Deterministic route measurement; emits route-repair gap notes unless NO_EMIT=1."
	@echo "  make measure-routes-all [NO_EMIT=1]"
	@echo "      Deterministic route measurement for all registered projects."
	@echo "  make measure-tokens PROJECT=<project-key> TASK=\"<brief>\""
	@echo "      Estimate query-route token savings for one task."
	@echo "  make ask PROJECT=<project-key> Q=\"your question\""
	@echo "      Query a project brain from the CLI."
	@echo ""
	@echo "Generated helper outputs:"
	@echo "  make obsidian PROJECT=<project-key>"
	@echo "      Generate Obsidian helper overlay under projects/<key>/obsidian/."
	@echo "  make obsidian-all"
	@echo "      Regenerate Obsidian helper overlays for all registered projects."
	@echo ""
	@echo "Maintenance:"
	@echo "  make prune [PROJECT=<project-key>] [GLOBAL=1] [ARTIFACT_KEEP=<n>]"
	@echo "      Prune old artifacts; keeps newest N runs per project/op bucket (default: 10)."
	@echo "  make measure-legacy PROJECT=<project-key>"
	@echo "      Run the legacy deterministic measurement command."
	@echo ""
	@echo "Common flags:"
	@echo "  AUTO=1                    auto-approve non-destructive units (compile, update)"
	@echo "                            destructive/high-uncertainty units still gate to pending-approvals/"
	@echo "  NO_EMIT=1                 suppress gap-note emission during measure and measure-routes"
	@echo "  MODEL=<backend>           override LLM backend (see MODEL selector below) -"
	@echo "                            applies to compile, update, measure, ask, and measure-tokens"
	@echo "  MODEL_REASONING_EFFORT=<level>"
	@echo "                            override Codex reasoning effort; compile/update default to medium"
	@echo "  LLM_WIKI_CONFIG=<path>    override model config file (default: llm-wiki.config)"
	@echo "  RANKING_CUTOFF=<n>        override ranking snapshot cutoff (compile)"
	@echo "  CODEX_BIN / CLAUDE_BIN    override CLI binary path (default: looked up on PATH)"
	@echo "  GLOBAL=1                  scope prune to global (non-project) artifacts"
	@echo "  ARTIFACT_KEEP=<n>         keep newest N runs per project/op bucket during prune"
	@echo ""
	@echo "MODEL selector (default: codex):"
	@echo "  MODEL=codex              use Codex CLI default model"
	@echo "  MODEL=codex/<id>         use Codex CLI with a specific model id"
	@echo "  MODEL=claude             use Claude CLI default model"
	@echo "  MODEL=claude/<id>        use Claude CLI with a specific model id"
	@echo "  MODEL=<id>               legacy: pass <id> to Codex as the model"
	@echo ""
	@echo "Pipeline default when MODEL is unset:"
	@echo "  compile/update stages use codex/gpt-5.5 with MODEL_REASONING_EFFORT=medium"
	@echo "  defaults are configured in llm-wiki.config"

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

dashboard:
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
	@$(MAKE) --no-print-directory post-brain-refresh PROJECT="$(PROJECT)"

compile-continue:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make compile-continue PROJECT=sample" && exit 1)
	@CONTINUE=1 bash scripts/compile.sh --project $(PROJECT)
	@$(MAKE) --no-print-directory post-brain-refresh PROJECT="$(PROJECT)"

update:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update PROJECT=sample" && exit 1)
	@bash scripts/update.sh --project $(PROJECT)
	@$(MAKE) --no-print-directory post-brain-refresh PROJECT="$(PROJECT)"

update-continue:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update-continue PROJECT=sample" && exit 1)
	@CONTINUE=1 bash scripts/update.sh --project $(PROJECT)
	@$(MAKE) --no-print-directory post-brain-refresh PROJECT="$(PROJECT)"

post-brain-refresh:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@$(MAKE) --no-print-directory obsidian PROJECT="$(PROJECT)"
	@NO_EMIT=1 $(MAKE) --no-print-directory measure-routes PROJECT="$(PROJECT)" >/dev/null
	@$(MAKE) --no-print-directory status PROJECT="$(PROJECT)"

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
	    set -e; \
	    project_dir="$$PROJECTS_ROOT/$$PROJECT"; \
	    latest="$$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(\"latest_run_dir\") or \"\")" "$$project_dir/state/update-state.json" 2>/dev/null)"; \
	    if [ -z "$$latest" ] || [ ! -d "$$latest" ]; then \
	      echo "error: no prior run found (latest_run_dir empty in update-state.json). Run make compile first." >&2; \
	      exit 1; \
	    fi; \
	    python3 scripts/backfill_metadata.py --project-dir "$$project_dir"; \
	    bash agents/update/06-validate/run.sh --project "$$PROJECT" --project-dir "$$project_dir" --run-dir "$$latest"; \
	    python3 scripts/stable_products.py render-validation --input "$$latest/validation-findings.json" --project-dir "$$project_dir" \
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

measure-routes:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@python3 scripts/measure_routes.py --project $(PROJECT)

measure-routes-all:
	@python3 scripts/measure_routes.py --all
