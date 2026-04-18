.PHONY: init init-project bootstrap bootstrap-orient bootstrap-domains bootstrap-expand bootstrap-validate bootstrap-reconcile validate lint ingest ingest-v2 ingest-apply ingest-global help

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
	@echo "  make bootstrap PROJECT=<project-key> [MODEL=<model>]"
	@echo "  make bootstrap-orient PROJECT=<project-key> [MODEL=<model>]"
	@echo "  make bootstrap-domains PROJECT=<project-key> [MODEL=<model>]"
	@echo "  make bootstrap-expand PROJECT=<project-key> [MODEL=<model>]"
	@echo "  make bootstrap-validate PROJECT=<project-key>"
	@echo "  make bootstrap-reconcile PROJECT=<project-key> [MODEL=<model>]"
	@echo "  make validate PROJECT=<project-key>"
	@echo "  make lint PROJECT=<project-key> [MODEL=<model>]"
	@echo "  make ingest PROJECT=<project-key> [MODEL=<model>] [AUTO=1]"
	@echo "  make ingest-v2 PROJECT=<project-key> [MODEL=<model>] [AUTO=1]  # alias"
	@echo "  make ingest-apply PROJECT=<project-key> RUN=<artifacts/runs/...> [MODEL=<model>]"
	@echo "  make ingest-global [MODEL=<model>]"
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

bootstrap:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make bootstrap PROJECT=my_project" && exit 1)
	@./agents/bootstrap/run.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",)

bootstrap-orient:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make bootstrap-orient PROJECT=my_project" && exit 1)
	@./agents/bootstrap/01-orient/run.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",)

bootstrap-domains:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make bootstrap-domains PROJECT=my_project" && exit 1)
	@./agents/bootstrap/02-domain-compiler/run.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",)

bootstrap-expand:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make bootstrap-expand PROJECT=my_project" && exit 1)
	@./agents/bootstrap/03-query-expander/run.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",)

bootstrap-validate:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make bootstrap-validate PROJECT=my_project" && exit 1)
	@./agents/bootstrap/04-validate/run.sh --project "$(PROJECT)"

bootstrap-reconcile:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make bootstrap-reconcile PROJECT=my_project" && exit 1)
	@./agents/bootstrap/05-reconcile/run.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",)

validate:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make validate PROJECT=my_project" && exit 1)
	@./scripts/validate.sh --project "$(PROJECT)"

lint:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make lint PROJECT=my_project" && exit 1)
	@./scripts/lint.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",)

ingest:
	@test -n "$(PROJECT)" || (echo "PROJECT is required, for example: make ingest PROJECT=my_project" && exit 1)
	@./scripts/ingest.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",) $(if $(AUTO),--auto,)

ingest-v2:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@./scripts/ingest.sh --project "$(PROJECT)" $(if $(MODEL),--model "$(MODEL)",) $(if $(AUTO),--auto,)

ingest-apply:
	@test -n "$(PROJECT)" || (echo "PROJECT is required" && exit 1)
	@test -n "$(RUN)" || (echo "RUN is required (path to artifacts/runs/<dir>)" && exit 1)
	@./scripts/ingest_apply.sh --project "$(PROJECT)" --run-dir "$(RUN)" $(if $(MODEL),--model "$(MODEL)",)

ingest-global:
	@./scripts/ingest.sh --global $(if $(MODEL),--model "$(MODEL)",)
