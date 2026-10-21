// Discord may put the keyboard selection on either the row or its inner base.
const popup = '#app-mount [class*="autocomplete_"]';
const row =
  ':is([class*="autocompleteRow_"],[role="option"]):not([class*="autocompleteRow_"] [role="option"])';
const selected =
  ':is([aria-selected="true"],[data-selected="true"],[class*="selected_"])';

export const AUTOCOMPLETE_STATES_CSS = `
${popup} ${row}:is(:hover,:focus-visible,${selected}),
${popup} ${row}:has(${selected},:focus-visible),
${popup} :is([class*="base_"],[class*="selectable_"]):not([class*="autocompleteRow_"] *):is(:hover,:focus-visible,${selected}){
  background:color-mix(in srgb,var(--text-link,#c5baf8) 24%,var(--background-floating,#1b1723))!important;
  box-shadow:inset 3px 0 var(--text-link,#c5baf8)!important;
  outline:1px solid color-mix(in srgb,var(--text-link,#c5baf8) 60%,transparent)!important;
  outline-offset:-1px;border-radius:8px!important;
}
`;
