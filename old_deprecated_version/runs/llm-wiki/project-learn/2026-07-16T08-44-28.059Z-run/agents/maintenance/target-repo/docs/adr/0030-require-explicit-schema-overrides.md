# Require explicit schema overrides

Project-local schemas may extend or narrow global schema rules by default. They must not silently weaken or replace global rules. Any project-local weakening or replacement of a global rule requires a typed override record with an explicit reason. This lets projects handle real exceptions without allowing hidden drift from the product-wide maintenance contract.
