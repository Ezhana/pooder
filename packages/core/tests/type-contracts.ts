import {
  SceneService,
  SessionService,
  TypedEventEmitter,
} from "../src";

function compileTypedEventContracts(
  sessions: SessionService,
  scenes: SceneService,
): void {
  sessions.on("change", (event) => event.snapshot.descriptor.sessionId);
  scenes.on("rootChange", (event) => event.activeRoot?.id);

  // @ts-expect-error Session event names are closed over SessionServiceEventMap.
  sessions.on("session:change", () => undefined);
  // @ts-expect-error Scene event payload follows the selected event name.
  scenes.on("rootChange", (event: { invalid: true }) => event.invalid);

  const events = new TypedEventEmitter<{ changed: { value: number } }>();
  events.emit("changed", { value: 1 });
  // @ts-expect-error Arbitrary string event names are rejected.
  events.emit("changed:raw", { value: 1 });
  // @ts-expect-error Event payloads are checked at compile time.
  events.emit("changed", { value: "1" });
}

void compileTypedEventContracts;
