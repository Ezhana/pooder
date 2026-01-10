<template>
  <div class="color-picker">
    <input 
        type="color" 
        :value="hexValue"
        @input="updateColor"
    />
    <div class="alpha-slider-wrap">
        <span class="alpha-label">A:</span>
        <input 
            type="range" 
            min="0" 
            max="100" 
            step="1"
            :value="alphaValue"
            @input="updateAlpha"
        />
        <span class="alpha-value">{{ alphaValue }}%</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'ColorPicker',
  props: {
    modelValue: {
      type: String,
      default: '#000000'
    }
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const getColorHex = (value: string): string => {
        if (!value) return '#000000';
        const str = String(value);
        if (str.startsWith('#')) {
            if (str.length === 9) return str.slice(0, 7);
            if (str.length === 7) return str;
            if (str.length === 4) return '#' + str[1] + str[1] + str[2] + str[2] + str[3] + str[3];
        }
        if (str.startsWith('rgb')) {
            const match = str.match(/\d+(\.\d+)?/g);
            if (match && match.length >= 3) {
                const r = parseInt(match[0]);
                const g = parseInt(match[1]);
                const b = parseInt(match[2]);
                const toHex = (n: number) => {
                    const hex = n.toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                };
                return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            }
        }
        return '#000000';
    };

    const getColorAlpha = (value: string): number => {
        if (!value) return 1;
        const str = String(value);
        if (str.startsWith('#')) {
             if (str.length === 9) return parseInt(str.slice(7), 16) / 255;
             return 1;
        }
        if (str.startsWith('rgba')) {
            const match = str.match(/\d+(\.\d+)?/g);
            if (match && match.length >= 4) return parseFloat(match[3]);
        }
        return 1;
    };

    const hexValue = computed(() => getColorHex(props.modelValue));
    const alphaValue = computed(() => Math.round(getColorAlpha(props.modelValue) * 100));

    const updateColor = (e: Event) => {
        const hex = (e.target as HTMLInputElement).value;
        const currentAlpha = getColorAlpha(props.modelValue);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const newValue = `rgba(${r}, ${g}, ${b}, ${currentAlpha})`;
        emit('update:modelValue', newValue);
        emit('change', newValue);
    };

    const updateAlpha = (e: Event) => {
        const alphaStr = (e.target as HTMLInputElement).value;
        const alpha = parseInt(alphaStr) / 100;
        const currentHex = getColorHex(props.modelValue);
        const r = parseInt(currentHex.slice(1, 3), 16);
        const g = parseInt(currentHex.slice(3, 5), 16);
        const b = parseInt(currentHex.slice(5, 7), 16);
        const newValue = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        emit('update:modelValue', newValue);
        emit('change', newValue);
    };

    return {
        hexValue,
        alphaValue,
        updateColor,
        updateAlpha
    };
  }
});
</script>

<style scoped>
.color-picker {
    display: flex;
    flex-direction: column;
}
.color-picker input[type="color"] {
    width: 100%;
    height: 30px;
    padding: 0;
    border: none;
    cursor: pointer;
}
.alpha-slider-wrap {
    display: flex;
    align-items: center;
    margin-top: 5px;
}
.alpha-label {
    font-size: 12px;
    color: #666;
    margin-right: 5px;
    width: 15px;
}
.alpha-slider-wrap input[type="range"] {
    flex: 1;
    margin-right: 5px;
}
.alpha-value {
    font-size: 12px;
    color: #666;
    width: 30px;
    text-align: right;
}
</style>
