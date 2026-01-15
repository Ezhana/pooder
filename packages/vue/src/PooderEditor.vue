<template>
  <div class="pooder-editor">
    <div class="center-area">
      <CanvasArea :width="width" :height="height" @init="onInit" />
    </div>
    <div class="right-panel">
      <ToolPanel :editor="editor" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, shallowRef } from "vue";
import { Editor } from "@pooder/core";
import {
  BackgroundTool,
  DielineTool,
  ImageTool,
  WhiteInkTool,
  FilmTool,
  HoleTool,
} from "@pooder/kit";

import CanvasArea from "./components/CanvasArea.vue";
import ToolPanel from "./components/ToolPanel.vue";

export default defineComponent({
  name: "PooderEditor",
  components: {
    CanvasArea,
    ToolPanel,
  },
  props: {
    width: {
      type: Number,
      default: 1200,
    },
    height: {
      type: Number,
      default: 600,
    },
  },
  setup(props) {
    const editor = shallowRef<Editor | null>(null);

    const onInit = (instance: Editor) => {
      instance.use(new BackgroundTool());
      instance.use(new ImageTool());
      instance.use(new WhiteInkTool());
      instance.use(new DielineTool());
      instance.use(new HoleTool());
      instance.use(new FilmTool());

      editor.value = instance;
      console.log(instance.getObjects());
      // instance.executeCommand("ImageTool.setUserImage",instance,"https://www.krakra.fan/api/minio/creation/a14e5b68479e4da0977c07dc84d0da0f?f=png&w=1488&h=1488",0.5)
      // instance.executeCommand("DielineTool.reset","https://www.krakra.fan/api/minio/creation/a14e5b68479e4da0977c07dc84d0da0f?f=png&w=1488&h=1488")
    };

    return {
      editor,
      onInit,
    };
  },
});
</script>

<style scoped>
.pooder-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #f0f2f5;
  box-sizing: border-box;
}

.center-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.right-panel {
  width: 100%;
  height: 320px;
  background: #fff;
  border-top: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  z-index: 10;
}
</style>
