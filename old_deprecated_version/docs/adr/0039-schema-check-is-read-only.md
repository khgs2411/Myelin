# Keep schema check read-only

`schema check <project>` is read-only. It validates authored schema files and generated schema context without mutating files. This makes it safe for agents to run before query or learn workflows. If automatic repair becomes useful, add a separate `schema fix <project>` command rather than overloading check.
