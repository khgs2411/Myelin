PROJECT ?=
QUESTION ?=

MYELIN := bun src/cli.ts

.PHONY: status query learn ingest onboard schema-check schema-build session-close test typecheck

status:
	$(MYELIN) status $(PROJECT)

query:
	$(MYELIN) memory query $(PROJECT) "$(QUESTION)"

learn:
	$(MYELIN) project learn $(PROJECT)

ingest:
	$(MYELIN) project ingest $(PROJECT)

onboard:
	$(MYELIN) project onboard $(PROJECT)

schema-check:
	$(MYELIN) schema check $(PROJECT)

schema-build:
	$(MYELIN) schema build $(PROJECT)

session-close:
	$(MYELIN) session close $(PROJECT)

test:
	bun test

typecheck:
	bun run typecheck

include .symphony-reviewer/reviewer.mk
