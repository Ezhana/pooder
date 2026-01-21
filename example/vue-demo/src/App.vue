<script setup lang="ts">
import { PooderEditor } from "@pooder/vue";
</script>

<template>
  <div class="app-container">
    <header>
      <h1>Pooder Editor Demo</h1>
    </header>
    <main class="editor-wrapper">
      <PooderEditor />
    </main>
  </div>
</template>

<style>
/* Global reset for full height */
html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden; /* Prevent body scroll */
}
</style>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}

header {
  flex: 0 0 auto;
  padding: 0 20px;
  background-color: #2c3e50;
  color: white;
  display: flex;
  align-items: center;
  height: 50px;
}

h1 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 500;
}

.editor-wrapper {
  flex: 1 1 auto;
  position: relative;
  overflow: hidden;
}
</style>
