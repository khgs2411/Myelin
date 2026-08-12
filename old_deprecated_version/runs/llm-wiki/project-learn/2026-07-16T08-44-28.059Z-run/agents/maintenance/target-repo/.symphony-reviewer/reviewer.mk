SYMPHONY_REVIEWER_PROJECT ?= myelin
SYMPHONY_REVIEWER_REGISTER ?= /Users/liadgoren/Repositories/openai_symphony/scripts/symphony-reviewer-register
SYMPHONY_REVIEWER_MESSAGE_FILE ?= /Users/liadgoren/Repositories/openai_symphony/scripts/symphony-reviewer-message.txt
SYMPHONY_REVIEWER_REPO_ROOT ?= $(CURDIR)
SYMPHONY_REVIEWER_PROJECT_EFFECTIVE = $(or $(strip $(PROJECT)),$(strip $(SYMPHONY_REVIEWER_PROJECT)))

ifneq ($(value PROMPT),)
export SYMPHONY_REVIEWER_PROMPT := $(value PROMPT)
endif

.PHONY: register-symphony-reviewer
register-symphony-reviewer:
	test -n "$(SYMPHONY_REVIEWER_PROJECT_EFFECTIVE)"
ifneq ($(strip $(value PROMPT)),)
	prompt_file="$(CURDIR)/.symphony-reviewer/.reviewer-prompt.tmp"; \
	{ /bin/cat "$(SYMPHONY_REVIEWER_MESSAGE_FILE)"; /usr/bin/printf "\n\nAdditional operator instructions:\n%s\n" "$$SYMPHONY_REVIEWER_PROMPT"; } > "$${prompt_file}"; \
	"$(SYMPHONY_REVIEWER_REGISTER)" --project "$(SYMPHONY_REVIEWER_PROJECT_EFFECTIVE)" --prompt-file "$${prompt_file}" --repo-root "$(SYMPHONY_REVIEWER_REPO_ROOT)"; \
	status="$$?"; \
	/bin/rm -f "$${prompt_file}"; \
	exit "$${status}"
else
	"$(SYMPHONY_REVIEWER_REGISTER)" --project "$(SYMPHONY_REVIEWER_PROJECT_EFFECTIVE)" --prompt-file "$(SYMPHONY_REVIEWER_MESSAGE_FILE)" --repo-root "$(SYMPHONY_REVIEWER_REPO_ROOT)"
endif
