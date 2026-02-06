import { Service } from "../service";
import EventBus from "../event";

export default class WorkbenchService implements Service {
  private _activeToolId: string | null = null;
  private eventBus?: EventBus;

  init() {
    // Initialization logic if needed
  }

  dispose() {
    // Cleanup logic if needed
  }

  setEventBus(bus: EventBus) {
    this.eventBus = bus;
  }

  get activeToolId() {
    return this._activeToolId;
  }

  activate(id: string) {
    if (this._activeToolId === id) return;
    const previous = this._activeToolId;
    this._activeToolId = id;
    this.eventBus?.emit("tool:activated", { id, previous });
  }
}
