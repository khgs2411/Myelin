PROJECT ?=
QUESTION ?=
REPO ?=
ARGS ?=

MYELIN := bun src/cli.ts

.PHONY: status query learn ingest bootstrap schema-check schema-build session-close test typecheck

status:
	@test -n "$(PROJECT)" || (echo "Usage: make status PROJECT=<project-key> [ARGS='--json']" >&2; exit 2)
	$(MYELIN) status $(PROJECT) $(ARGS)

query:
	@test -n "$(PROJECT)" || (echo "Usage: make query PROJECT=<project-key> QUESTION='...' [ARGS='--json']" >&2; exit 2)
	$(MYELIN) memory query $(PROJECT) "$(QUESTION)" $(ARGS)

learn:
	@test -n "$(PROJECT)" || (echo "Usage: make learn PROJECT=<project-key> [ARGS='--dry-run --json']" >&2; exit 2)
	$(MYELIN) project learn $(PROJECT) $(ARGS)

ingest:
	@test -n "$(PROJECT)" || (echo "Usage: make ingest PROJECT=<project-key> [ARGS='--json']" >&2; exit 2)
	$(MYELIN) ingest $(PROJECT) $(ARGS)

bootstrap:
	@test -n "$(PROJECT)" || (echo "Usage: make bootstrap PROJECT=<project-key> REPO=<path> [ARGS='--json']" >&2; exit 2)
	$(MYELIN) bootstrap $(PROJECT) --repo $(REPO) $(ARGS)

schema-check:
	@test -n "$(PROJECT)" || (echo "Usage: make schema-check PROJECT=<project-key> [ARGS='--json']" >&2; exit 2)
	$(MYELIN) schema check $(PROJECT) $(ARGS)

schema-build:
	@test -n "$(PROJECT)" || (echo "Usage: make schema-build PROJECT=<project-key> [ARGS='--dry-run']" >&2; exit 2)
	$(MYELIN) schema build $(PROJECT) $(ARGS)

session-close:
	@test -n "$(PROJECT)" || (echo "Usage: make session-close PROJECT=<project-key> [ARGS='--json']" >&2; exit 2)
	$(MYELIN) session close $(PROJECT) $(ARGS)

test:
	bun test

typecheck:
	bun run typecheck

include .symphony-reviewer/reviewer.mk
