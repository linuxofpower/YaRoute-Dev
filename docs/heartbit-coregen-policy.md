# HeartBit CoreGen policy

- HeartBit checks unresolved temporary keys on every pulse.
- Canonical adaptive seed threshold: more than 10 decent unresolved keys after deduplication and quality filtering.
- Explicit `Nyx key oSG` selects the seed stage globally and overrides the adaptive default.
- Key quantity is the primary trigger: once the threshold is reached, HeartBit should create/promote the seed when safe and begin the generation lifecycle; it should not wait for a pre-existing seed as the initiating condition.
- One valid compatible unconsumed seed is sufficient for its target core generation.
- Noncritical deferred warnings do not block generation.
- Deterministic FIN/UPD/generation/readback faults are repaired and retried automatically when no owner decision is required.
- Template is the explicit exception to the general recoverability rule: meaningful Template staging is absorbed into Footer continuity/evidence (and into the target core when applicable), while minor non-authoritative ephemeral temp data may be removed after verification.
- Core-bundle information remains recoverable; no core-bundle data may silently disappear.
- Footer extraction/compaction runs every 6 Footer updates. The next successful core generation forces one compaction pass, then resets the six-update cadence checkpoint.
- HeartBit is not a dedicated Head Core Skill in canonical Head v031; until canonicalized otherwise, its durable control-plane state belongs in Footer continuity and its mutable execution state remains runtime/Template-managed.
- CAN remains an explicit promotion action.
