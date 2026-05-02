<template>
  <slot />
</template>

<script setup lang="ts">
import { provide } from "vue";
import { POODER_RUNTIME_KEY, type PooderRuntimeLike } from "./runtime";

const props = defineProps<{
  runtime: PooderRuntimeLike;
}>();

provide(POODER_RUNTIME_KEY, props.runtime);
</script>
