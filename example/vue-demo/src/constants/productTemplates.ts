export const PRODUCT_TEMPLATES = {
  BASIC: "basic",
  ROUND_BADGE: "round_badge",
  RECT_BADGE: "rect_badge",
  ACRYLIC: "acrylic",
  ACRYLIC_KEYCHAIN: "acrylic_keychain",
  SHIKISHI: "shikishi",
  ACRYLIC_STANDEES: "acrylic_standees",
  WOOD_STANDEES: "wood_standees",
  THICK_ACRYLIC: "thick_acrylic",
  THICK_ACRYLIC_KEYCHAIN: "thick_acrylic_keychain",
  ACRYLIC_COASTER: "acrylic_coaster",
  ACRYLIC_CARD: "acrylic_card",
  GLASS_CUP: "glass_cup",
  CHEERING_FAN: "cheering_fan",
  STICKERS: "stickers",
  SPECIAL_BADGES: "special_badges",
  OVAL_BADGES: "oval_badges",
  HOLOGRAPHIC_BADGES: "holographic_badges",
  POSTERS: "posters",
  POSTCARDS: "postcards",
  SPECIAL_PRINTS: "special_prints",
} as const;

export const HOLE_PRESETS = {
  KEYCHAIN_NORMAL: {
    name: "Normal Keychain",
    features: [
      {
        id: "lug",
        groupId: "preset",
        operation: "add",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 4,
        rotation: 0,
        constraints: [
          {
            type: "path",
            params: {
              maxOffset: 2,
              minOffset: -4,
            },
          },
        ],
      },
      {
        id: "hole",
        groupId: "preset",
        operation: "subtract",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2,
        rotation: 0,
        constraints: [
          {
            type: "path",
            params: {
              maxOffset: 2,
              minOffset: -4,
            },
          },
        ],
      },
    ],
  },
  KEYCHAIN_THICK: {
    name: "Thick Keychain",
    features: [
      {
        id: "lug",
        groupId: "preset",
        operation: "add",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 4,
        rotation: 0,
        constraints: [
          {
            type: "path",
            params: {
              maxOffset: 2,
              minOffset: -4,
            },
          },
        ],
      },
      {
        id: "hole",
        groupId: "preset",
        operation: "subtract",
        skipCut: true,
        shape: "circle",
        x: 0.5,
        y: 0,
        radius: 2,
        rotation: 0,
        constraints: [
          {
            type: "path",
            params: {
              maxOffset: 2,
              minOffset: -4,
            },
          },
        ],
      },
    ],
  },
  STANDEE_TAB: {
    name: "Standee Tab",
    features: [
      {
        id: "standee-tab-lug",
        groupId: "standee-tab",
        operation: "add",
        skipCut: true,
        shape: "rect",
        x: 0.5,
        y: 1.02,
        width: 20,
        height: 3,
        rotation: 0,
        bridge: { type: "vertical" },
        constraints: [
          {
            type: "lowest-tangent",
            params: {
              gap: 0,
              confineX: true,
            },
          },
        ],
      },
    ],
  },
};

export const TEMPLATE_HOLE_PRESETS = {
  [PRODUCT_TEMPLATES.ACRYLIC_KEYCHAIN]: ["KEYCHAIN_NORMAL"],
  [PRODUCT_TEMPLATES.THICK_ACRYLIC_KEYCHAIN]: ["KEYCHAIN_THICK"],
  [PRODUCT_TEMPLATES.ACRYLIC_STANDEES]: ["STANDEE_TAB"],
  [PRODUCT_TEMPLATES.WOOD_STANDEES]: ["STANDEE_TAB"],
};

const buildCutConfigFromOffset = (offset = 0) => {
  if (offset > 0) {
    return {
      "size.cutMode": "outset",
      "size.cutMarginMm": offset,
    };
  }
  if (offset < 0) {
    return {
      "size.cutMode": "inset",
      "size.cutMarginMm": Math.abs(offset),
    };
  }
  return {
    "size.cutMode": "trim",
    "size.cutMarginMm": 0,
  };
};

export const TEMPLATE_CONFIGS = {
  [PRODUCT_TEMPLATES.BASIC]: () => ({}),

  [PRODUCT_TEMPLATES.ROUND_BADGE]: () => ({
    "dieline.shape": "circle",
    "size.unit": "mm",
    "dieline.showBleedLines": true,
    ...buildCutConfigFromOffset(3.5),
  }),

  [PRODUCT_TEMPLATES.RECT_BADGE]: () => ({
    "dieline.radius": 10,
    ...buildCutConfigFromOffset(5),
  }),

  [PRODUCT_TEMPLATES.ACRYLIC]: () => ({
    "dieline.radius": 10,
    ...buildCutConfigFromOffset(5),
  }),

  [PRODUCT_TEMPLATES.ACRYLIC_KEYCHAIN]: () => ({
    "dieline.shape": "rect",
    "dieline.showBleedLines": false,
    "dieline.offsetStyle": "hidden",
    "dieline.features": HOLE_PRESETS.KEYCHAIN_NORMAL.features,
    ...buildCutConfigFromOffset(-2),
  }),

  [PRODUCT_TEMPLATES.SHIKISHI]: () => ({
    "dieline.style": "dashed",
  }),

  [PRODUCT_TEMPLATES.ACRYLIC_STANDEES]: () => ({
    "size.viewPadding": "20%",
    "dieline.features": HOLE_PRESETS.STANDEE_TAB.features,
  }),

  [PRODUCT_TEMPLATES.WOOD_STANDEES]: () => ({
    "size.viewPadding": "20%",
    "dieline.features": HOLE_PRESETS.STANDEE_TAB.features,
  }),

  [PRODUCT_TEMPLATES.STICKERS]: () => ({
    "dieline.radius": 0,
  }),

  [PRODUCT_TEMPLATES.THICK_ACRYLIC]: () => ({
    "dieline.radius": 0,
  }),

  [PRODUCT_TEMPLATES.POSTCARDS]: () => ({
    "dieline.radius": 0,
  }),

  [PRODUCT_TEMPLATES.HOLOGRAPHIC_BADGES]: () => ({
    "dieline.shape": "circle",
    "dieline.showBleedLines": true,
    ...buildCutConfigFromOffset(3.5),
  }),

  [PRODUCT_TEMPLATES.OVAL_BADGES]: () => ({
    "dieline.shape": "ellipse",
    "dieline.showBleedLines": true,
    ...buildCutConfigFromOffset(3.5),
  }),

  [PRODUCT_TEMPLATES.SPECIAL_BADGES]: () => ({
    "dieline.shape": "circle",
    "dieline.showBleedLines": true,
    ...buildCutConfigFromOffset(3.5),
  }),

  [PRODUCT_TEMPLATES.THICK_ACRYLIC_KEYCHAIN]: () => ({
    "size.unit": "mm",
    "size.actualWidthMm": 50,
    "size.actualHeightMm": 80,
    "dieline.shape": "rect",
    "dieline.showBleedLines": false,
    "dieline.offsetStyle": "hidden",
    "dieline.features": HOLE_PRESETS.KEYCHAIN_THICK.features,
    ...buildCutConfigFromOffset(-2),
  }),
};

// Map category NAMES to Template Types
export const CATEGORY_TEMPLATE_MAP: Record<string, string> = {
  // Badges
  "Round Badges": PRODUCT_TEMPLATES.ROUND_BADGE,
  "Rectangular Badges": PRODUCT_TEMPLATES.RECT_BADGE,
  "Oval Badges": PRODUCT_TEMPLATES.OVAL_BADGES,
  "Special Badges": PRODUCT_TEMPLATES.SPECIAL_BADGES,
  "Holographic Badges": PRODUCT_TEMPLATES.HOLOGRAPHIC_BADGES,
  "Badges / Pin": PRODUCT_TEMPLATES.ROUND_BADGE,

  // Acrylics
  "Acrylic Keychain": PRODUCT_TEMPLATES.ACRYLIC_KEYCHAIN,
  "Thick Acrylic Keychains": PRODUCT_TEMPLATES.THICK_ACRYLIC_KEYCHAIN,
  "Acrylic Standees": PRODUCT_TEMPLATES.ACRYLIC_STANDEES,
  "Wood Standees": PRODUCT_TEMPLATES.WOOD_STANDEES,
  "Thick Acrylic": PRODUCT_TEMPLATES.THICK_ACRYLIC,
  "Acrylic Coaster": PRODUCT_TEMPLATES.ACRYLIC_COASTER,
  "Acrylic card": PRODUCT_TEMPLATES.ACRYLIC_CARD,
  "Acrylic Shikishi Boards": PRODUCT_TEMPLATES.SHIKISHI,
  "Shikishi Boards": PRODUCT_TEMPLATES.SHIKISHI,

  // Prints
  Posters: PRODUCT_TEMPLATES.POSTERS,
  Postcards: PRODUCT_TEMPLATES.POSTCARDS,
  "Special Prints": PRODUCT_TEMPLATES.SPECIAL_PRINTS,
  Prints: PRODUCT_TEMPLATES.POSTCARDS,

  // Stickers
  Stickers: PRODUCT_TEMPLATES.STICKERS,
  "Die Cut Stickers": PRODUCT_TEMPLATES.STICKERS,
  "Half Cut Stickers": PRODUCT_TEMPLATES.STICKERS,
  "Half Cut Sticker": PRODUCT_TEMPLATES.STICKERS,
  "Special Stickers": PRODUCT_TEMPLATES.STICKERS,

  // Others
  "Glass cup & mug": PRODUCT_TEMPLATES.GLASS_CUP,
  "Cheering Fan": PRODUCT_TEMPLATES.CHEERING_FAN,
  Other: PRODUCT_TEMPLATES.BASIC,
  "Special / More": PRODUCT_TEMPLATES.BASIC,
};

export const getTemplateConfig = (categoryName: string) => {
  // 1. Try exact match
  let templateType = CATEGORY_TEMPLATE_MAP[categoryName];

  // 2. Try trimming
  if (!templateType && categoryName) {
    templateType = CATEGORY_TEMPLATE_MAP[categoryName.trim()];
  }

  // 3. Fallback to BASIC if not found
  if (!templateType) {
    templateType = PRODUCT_TEMPLATES.BASIC;
  }

  const generator =
    // @ts-ignore
    TEMPLATE_CONFIGS[templateType] || TEMPLATE_CONFIGS[PRODUCT_TEMPLATES.BASIC];

  return generator();
};
