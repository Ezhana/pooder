<template>
  <slot />
</template>

<script setup lang="ts">
import { provide } from "vue";
import { POODER_RUNTIME_KEY, type PooderRuntime } from "./runtime";

const props = defineProps<{
  runtime: PooderRuntime;
}>();

provide(POODER_RUNTIME_KEY, props.runtime);
</script>
