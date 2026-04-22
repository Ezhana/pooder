import type { InjectionKey } from "vue";
import { inject } from "vue";
import type { Pooder } from "@pooder/core";

export const POODER_RUNTIME_KEY: InjectionKey<Pooder> = Symbol(
  "PooderRuntime",
);

export function usePooderRuntime(): Pooder {
  const runtime = inject(POODER_RUNTIME_KEY, null);
  if (!runtime) {
    throw new Error(
      "[@pooder/vue] Pooder runtime was not provided. Wrap consumers with PooderRuntimeProvider.",
    );
  }
  return runtime;
}
