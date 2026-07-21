export interface Disposable {
  dispose(): void;
}

export class SubscriptionBag {
  private readonly disposables: Disposable[] = [];

  add<T extends Disposable | undefined | null>(disposable: T): T {
    if (disposable) {
      this.disposables.push(disposable);
    }
    return disposable;
  }

  disposeAll(): void {
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }
}
