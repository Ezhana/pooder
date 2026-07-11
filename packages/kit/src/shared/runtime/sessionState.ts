export function cloneWithJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface SessionLike<T> {
  committed: T;
  working: T;
  hasWorkingChanges: boolean;
}

export function applyCommittedSnapshot<T>(
  session: SessionLike<T>,
  nextCommitted: T,
  options: {
    clone: (value: T) => T;
    toolActive: boolean;
    preserveDirtyWorking?: boolean;
  },
): void {
  const clone = options.clone;
  session.committed = clone(nextCommitted);

  const shouldPreserveDirtyWorking =
    options.toolActive &&
    options.preserveDirtyWorking !== false &&
    session.hasWorkingChanges;

  if (!shouldPreserveDirtyWorking) {
    session.working = clone(session.committed);
    session.hasWorkingChanges = false;
  }
}

export function runDeferredConfigUpdate(
  state: any,
  action: () => void,
  cooldownMs = 0,
): void {
  state.isUpdatingConfig = true;
  action();
  if (cooldownMs <= 0) {
    state.isUpdatingConfig = false;
    return;
  }
  setTimeout(() => {
    state.isUpdatingConfig = false;
  }, cooldownMs);
}

export class WorkingSessionState<T> {
  committed: T;
  working: T;
  hasWorkingChanges = false;
  isUpdatingConfig = false;

  private readonly clone: (value: T) => T;

  constructor(initial: T, clone: (value: T) => T) {
    this.clone = clone;
    this.committed = this.clone(initial);
    this.working = this.clone(initial);
  }

  setCommitted(
    next: T,
    options: { toolActive?: boolean; preserveDirtyWorking?: boolean } = {},
  ): void {
    this.committed = this.clone(next);
    const shouldPreserveDirtyWorking =
      options.toolActive === true &&
      options.preserveDirtyWorking !== false &&
      this.hasWorkingChanges;

    if (!shouldPreserveDirtyWorking) {
      this.working = this.clone(this.committed);
      this.hasWorkingChanges = false;
    }
  }

  setWorking(next: T, options: { markDirty?: boolean } = {}): void {
    this.working = this.clone(next);
    if (options.markDirty !== false) {
      this.hasWorkingChanges = true;
    }
  }

  resetWorkingFromCommitted(): void {
    this.working = this.clone(this.committed);
    this.hasWorkingChanges = false;
  }

  commitWorkingToCommitted(): void {
    this.committed = this.clone(this.working);
    this.hasWorkingChanges = false;
  }

  runConfigUpdate(action: () => void): void {
    this.isUpdatingConfig = true;
    try {
      action();
    } finally {
      this.isUpdatingConfig = false;
    }
  }
}
