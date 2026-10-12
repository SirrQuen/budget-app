// Inlines custom-property easings inside @keyframes, at build time.
//
// Chrome ignores var() in a keyframe's animation-timing-function: the
// interval silently runs linear. Verified in Chrome 154 -- at 25% progress a
// keyframe eased with var(--e) sits at 25.00, the same curve written out
// sits at 28.82 (docs/phase-7-findings.md). On the `animation` property itself
// var() works; only the per-keyframe declaration drops it.
//
// So the stylesheet writes the token everywhere, and this plugin swaps
// `animation-timing-function: var(--x)` INSIDE @keyframes for the value
// `--x` is declared with on :root. The token stays the single source; the
// browser only ever sees a literal where it needs one.
//
// CommonJS because Turbopack's PostCSS host loads plugins with require().
//
// Scope is deliberately narrow: only animation-timing-function, only inside
// @keyframes, only tokens declared on a plain `:root` rule. Anything it
// can't resolve fails the build rather than shipping a linear interval.

const KEYFRAME_EASE = /^var\(\s*(--[\w-]+)\s*\)$/;

/** @type {import('postcss').PluginCreator<void>} */
const inlineKeyframeEasing = () => ({
  postcssPlugin: "inline-keyframe-easing",
  Once(root) {
    const tokens = new Map();
    root.walkRules((rule) => {
      if (rule.selector.trim() !== ":root") return;
      rule.each((node) => {
        if (node.type === "decl" && node.prop.startsWith("--")) tokens.set(node.prop, node.value.trim());
      });
    });

    root.walkAtRules(/^(-webkit-)?keyframes$/i, (atRule) => {
      atRule.walkDecls("animation-timing-function", (decl) => {
        const match = decl.value.trim().match(KEYFRAME_EASE);
        if (!match) return;
        const value = tokens.get(match[1]);
        if (!value) {
          throw decl.error(
            `${match[1]} is used in @keyframes ${atRule.params} but isn't declared on :root, ` +
              "so it can't be inlined -- and Chrome would run this interval linear.",
            { plugin: "inline-keyframe-easing" },
          );
        }
        decl.value = value;
      });
    });
  },
});
inlineKeyframeEasing.postcss = true;

module.exports = inlineKeyframeEasing;
