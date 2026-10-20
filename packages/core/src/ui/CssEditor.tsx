import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { css } from "@codemirror/lang-css";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { syntaxHighlighting } from "@codemirror/language";

export function CssEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>();
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      doc: value,
      extensions: [
        basicSetup,
        css(),
        syntaxHighlighting(oneDarkHighlightStyle),
        keymap.of([indentWithTab]),
        placeholder(
          "/* Your space. Your styles. */\n\n:root {\n  --text-link: #c5baf8;\n}",
        ),
        EditorView.contentAttributes.of({
          "aria-label": "Custom CSS",
          "aria-multiline": "true",
          role: "textbox",
          spellcheck: "false",
        }),
        EditorView.theme(
          {
            "&": {
              height: "360px",
              maxHeight: "50dvh",
              minHeight: "220px",
              backgroundColor: "#111015",
              fontSize: "12px",
            },
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: '"Cascadia Code",Consolas,monospace',
              lineHeight: "1.85",
              scrollbarWidth: "thin",
              scrollbarColor: "#494052 transparent",
            },
            ".cm-content": { padding: "18px 0", caretColor: "#C5BAF8" },
            ".cm-line": { padding: "0 18px" },
            ".cm-gutters": {
              backgroundColor: "#141219",
              color: "#686173",
              border: "none",
              padding: "0 7px",
            },
            ".cm-activeLine, .cm-activeLineGutter": {
              backgroundColor: "#c5baf808",
            },
            ".cm-cursor": { borderLeftColor: "#C5BAF8" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              backgroundColor: "#c5baf82a",
            },
            ".cm-tooltip": {
              backgroundColor: "#211c29",
              color: "#e5ddef",
              border: "1px solid #42354f",
            },
            ".cm-placeholder": { color: "#82788f" },
            ".cm-panels": {
              backgroundColor: "#211d29",
              borderColor: "#3e354b",
              color: "#ded6ed",
            },
          },
          { dark: true },
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changed.current(update.state.doc.toString());
        }),
      ],
    });
    editor.current = view;
    return () => {
      editor.current = undefined;
      view.destroy();
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && value !== view.state.doc.toString())
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  return <div ref={host} className="vs-css-editor" />;
}
