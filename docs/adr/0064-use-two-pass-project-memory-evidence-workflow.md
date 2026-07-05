# Use a two-pass Project Memory evidence workflow

Project Memory create mode should first build a deterministic evidence map for required answer domains, then write sectioned markdown from that map. Candidates and Session Memory are leads, but the evidence map is the bounded repo-grounded bridge that decides which docs, code paths, commands, state files, schemas, tests, and decisions can support durable Project Memory.

Considered options: use a fixed orientation manifest only, or let the curator perform broad read-only exploration while relying on output validation afterward. We choose the two-pass workflow because Project Memory needs both reproducible evidence coverage and enough depth to avoid another shallow create run.
