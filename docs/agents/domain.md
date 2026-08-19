# Domain Docs

This repository uses a single-context domain documentation layout.

## Before exploring

- Read `CONTEXT.md` at the repository root when it exists.
- Read ADRs in `docs/adr/` that touch the area being changed.
- If these files do not exist, proceed silently. The domain-modeling workflow creates them when domain terms or decisions are resolved.

## Use the glossary vocabulary

When an issue title, refactor proposal, hypothesis, or test names a domain concept, use the term defined in `CONTEXT.md`. Do not introduce synonyms that conflict with the glossary. If a needed concept is missing, record the vocabulary gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface it explicitly instead of silently overriding the decision.
