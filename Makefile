.PHONY: init init-project status status-all prune help update update-v2 update-v2-continue apply-pending reject-pending measure measure-tokens lint

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
	@echo "  make init-project PROJECT=<project-key> [NAME=<display-name>] [PATH=/path/to/project]"
	@echo "  make update PROJECT=<project-key>  # run the unified update pipeline"
	@echo "  make update-v2 PROJECT=<project-key>  # deprecated alias"
	@echo "  make update-v2-continue PROJECT=<project-key>  # resume after gated approval"
	@echo "  make lint PROJECT=<project-key>  # standalone validate against latest run"
	@echo "  make status PROJECT=<project-key>"
	@echo "  make status-all"
	@echo "  make prune [PROJECT=<project-key>] [GLOBAL=1]"
	@echo "  make apply-pending PROJECT=<project-key> PROPOSAL=<proposal-id>  # apply deferred destructive slice"
	@echo "  make reject-pending PROJECT=<project-key> PROPOSAL=<proposal-id>  # archive slice without applying"
	@echo "  make measure PROJECT=<project-key>"
	@echo "  make measure-tokens PROJECT=<project-key> TASK=\"<brief>\""
	@echo ""
	@echo "MODEL selector (default: codex):"
	@echo "  MODEL=codex              use Codex CLI default model"
	@echo "  MODEL=codex/<id>         use Codex CLI with a specific model id"
	@echo "  MODEL=claude             use Claude CLI default model"
	@echo "  MODEL=claude/<id>        use Claude CLI with a specific model id"
	@echo "  MODEL=<id>               legacy: pass <id> to Codex as the model"

init:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make init PROJECT=my_project" && exit 1)
	@/usr/bin/env PATH="$(SYSTEM_PATH)" ./scripts/init_project.sh --project "$(PROJECT)" \
		$(if $(NAME),--name "$(NAME)",) \
		$(if $(USER_PROJECT_PATH),--path "$(USER_PROJECT_PATH)",) \
		$(if $(TAGS),--tags "$(TAGS)",) \
		$(if $(RELATED_CONCEPTS),--related-concepts "$(RELATED_CONCEPTS)",) \
		$(if $(FOCUSES),--focuses "$(FOCUSES)",)

init-project:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make init-project PROJECT=my_project" && exit 1)
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

update:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update PROJECT=sample" && exit 1)
	@bash scripts/update.sh --project $(PROJECT)

update-v2:
	@echo "WARNING: 'make update-v2' is deprecated; use 'make update' instead." >&2
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update-v2 PROJECT=sample" && exit 1)
	@bash scripts/update.sh --project $(PROJECT)

update-v2-continue:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make update-v2-continue PROJECT=sample" && exit 1)
	@CONTINUE=1 bash scripts/update.sh --project $(PROJECT)

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
	      echo "error: no prior run found (latest_run_dir empty in update-state.json). Run make update first." >&2; \
	      exit 1; \
	    fi; \
	    bash agents/update/06-validate/run.sh --project "$$PROJECT" --project-dir "$$project_dir" --run-dir "$$latest" \
	  '

measure:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@bash scripts/measure.sh --project $(PROJECT)

measure-tokens:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(TASK)" || (echo "TASK is required, for example: make measure-tokens PROJECT=sample TASK=\"implement rate limiting\"" && exit 1)
	@bash scripts/measure_tokens.sh --project $(PROJECT) --task "$(TASK)"
