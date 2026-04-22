<template>
  <slot />
</template>

<script setup lang="ts">
import type { Pooder } from "@pooder/core";
import { provide } from "vue";
import { POODER_RUNTIME_KEY } from "./runtime";

const props = defineProps<{
  runtime: Pooder;
}>();

provide(POODER_RUNTIME_KEY, props.runtime);
</script>
