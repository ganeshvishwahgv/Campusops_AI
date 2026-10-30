# AI recovery

AI room recovery and transport dispatch briefs are now implemented with Claude. See [AI.md](AI.md) for setup, features, endpoints and safeguards.

The rule-based checks remain the authority: room eligibility (capacity, access, equipment, overlaps) and bus seat allocation are computed deterministically, and Claude only ranks and explains those results. Without `ANTHROPIC_API_KEY`, the same features run on built-in rules and are labelled as such. Vehicle positions and occupancy in the transport module remain simulated.
