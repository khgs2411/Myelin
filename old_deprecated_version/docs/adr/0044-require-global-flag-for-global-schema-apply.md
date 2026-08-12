# Require --global for global schema candidate apply

Applying a global schema candidate requires `schema apply <candidate-id> --global`. Schema candidate IDs are globally unique, but global schema changes affect every project and should not apply accidentally. The explicit flag makes broad-impact changes intentional.
