# Use global install with per-repo capture opt-in

Myelin capture integrations are installed at the machine/provider level, such as global Codex hooks, but saved capture is enabled only for repositories that have been bootstrapped into Myelin. Hooks from unbootstrapped repos are dropped as no-ops, and hook failures must fail open so Myelin never interrupts an active agent session; this keeps Myelin globally available while preserving explicit per-repo ownership and the user's primary coding workflow.
