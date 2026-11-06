# Job pruning in stacks

These terms describe the independent options for reducing obsolete or duplicate GitHub Actions work.

## Language

**Job pruning in stacks**:
Methods for reducing obsolete or duplicate work by canceling workflow runs or preventing jobs from starting.

**Prune option**:
One independently selected technique for job pruning. Its number identifies the technique, not its rank, difficulty, or a required adoption sequence.
_Avoid_: Level, tier

**Prune Option 1**:
Cancellation of earlier active runs of the same workflow within one branch or PR.

**Prune Option 2**:
Prevention of jobs on PRs identified as lower PRs in a stack.

**Prune Option 3**:
Cancellation of eligible active lower-PR workflow runs after PRs join a stack, when the top PR's work can replace them and the affected workflows allow pruning.
