# Use a V2 CLI vocabulary instead of preserving V1 command names

V2 should introduce a CLI vocabulary that names the product concepts directly instead of preserving V1 command names as the primary interface. Commands such as `compile` and `update` carry the old documentation-pipeline mental model. The TypeScript migration should design and implement new commands around the V2 brain concepts, then keep Make targets only as convenience aliases where useful. Old command names may be retired when they reinforce obsolete concepts.
