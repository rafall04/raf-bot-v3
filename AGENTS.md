**[CORE SYSTEM PROTOCOL & NODE.JS ARCHITECTURE]**

0. NO YAPPING: Zero conversational filler. Output ONLY requested code, diffs, or 1-line traces.

1. CONTEXT INIT: ALWAYS read `SYSTEM_MAP.md` (root) BEFORE taking action. NO blind scans.

2. IGNORE DIRS: node_modules,venv,env,dist,build,tmp,coverage,.cache,.vscode,.git

3. MAX EFFICIENCY: Min cmd/read. NO full reads for files >500 lines. Read target blocks ONLY.

4. SKELETON-FIRST (SDD): For new features/refactors, generate empty functions/interfaces with Header Docs FIRST. Await user approval before writing logic.

5. DIFF-ONLY EDITS: For files >100 lines, NEVER output full file. Use strict Search/Replace:

<<<<

[exact original code]

====

[new optimized code]

>>>>

6. DOCS (MANDATORY): EVERY edited file MUST have a Header Doc (Purpose, Caller, Deps, MainFuncs). Sync Map if flow changes.

7. GLOBAL ERROR HANDLING: Express Controllers MUST NOT have repetitive `try...catch`. Use a central wrapper (e.g., `asyncHandler`) and a Global Error Middleware.

8. WA FACADE: All WhatsApp interactions MUST be isolated in an adapter (e.g., `/src/adapters/whatsapp.adapter.js`). No direct imports in controllers/services.

9. EVENT-DRIVEN: Use Node.js `EventEmitter` to decouple domains. Billing logic must `emit` events (e.g., 'invoice.paid'), NOT call WA functions directly.

10. PRE-FLIGHT: Output 1-line plan BEFORE editing. Enforce Single Responsibility Principle (SRP).

11. SUPERPOWERS PROTOCOL (MCP): For any complex refactoring, new feature creation, or architectural changes, you MUST utilize the `obra/superpowers` MCP. ALWAYS invoke `brainstorming` to generate a Tech Spec, await user approval, and then use `writing-plans` to execute the steps systematically. Never skip the planning phase for tasks involving more than one file.

