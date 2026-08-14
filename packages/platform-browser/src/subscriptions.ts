export interface Disposable {
  dispose(): void;
}

interface ConfigLike {
  onAnyChange(handler: (event: any) => void): Disposable;
}

export class SubscriptionBag {
  private readonly disposables: Disposable[] = [];

  add<T extends Disposable | undefined | null>(disposable: T): T {
    if (disposable) {
      this.disposables.push(disposable);
    }
    return disposable;
  }

  onConfigChange(
    configService: ConfigLike,
    handler: (event: any) => void,
  ): void {
    this.add(configService.onAnyChange(handler));
  }

  disposeAll(): void {
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }
}
