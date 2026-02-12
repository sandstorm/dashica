# CLAUDE RULES

**General**

- STOP when finished with a task - DO NOT create git commits. The user will create commits themselves.
- consolidate all developer information into the README.md, OR into separate concepts in the docs/ folder.
- TRY implemented features E2E - maybe via a Chrome or Firefox Browser via Playwright or MCP or ...?
- DO NOT GUESS but investigate the root cause of problems! LET ME KNOW IF YOU DO NOT KNOW.

# Tools

- To run Golang compiler/interpreter etc, do `mise exec go -- go ...`
- To START THE APPLICATION, run `mise r watch` (with reload)

# Golang Best Practices

- Write Tests! according to Golang best practices
    - NEVER copy production logic into tests; to ensure the tests stay representative to the real world.