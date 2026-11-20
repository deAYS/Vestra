import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface OverflowItem {
  label: string;
  testId: string;
  danger?: boolean;
  onSelect(): void;
}

interface Props {
  /** Accessible name of the ⋯ button, e.g. "More actions for Discord Stable". */
  label: string;
  testId: string;
  disabled: boolean;
  items: OverflowItem[];
}

/**
 * ⋯ button with a small menu. Opens with click/Enter/Space/ArrowDown, moves
 * with arrows/Home/End, closes on Escape, Tab, selection or an outside click.
 * Focus returns to the button whenever the menu closes from inside it.
 */
export function OverflowMenu({ label, testId, disabled, items }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  itemRefs.current.length = items.length;

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointer = (event: MouseEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const nodes = itemRefs.current.filter(
      (node): node is HTMLButtonElement => node !== null,
    );
    const index = nodes.findIndex((node) => node === document.activeElement);
    const focusAt = (next: number): void => {
      event.preventDefault();
      nodes[(next + nodes.length) % nodes.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return focusAt(index + 1);
      case "ArrowUp":
        return focusAt(index - 1);
      case "Home":
        return focusAt(0);
      case "End":
        return focusAt(nodes.length - 1);
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        return close();
      case "Tab":
        setOpen(false);
        return;
    }
  };

  return (
    <div className="vs-menu" ref={wrapper}>
      <button
        type="button"
        ref={button}
        className="vs-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title="More actions"
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      </button>
      {open ? (
        <div className="vs-menu__list" role="menu" aria-label={label} onKeyDown={move}>
          {items.map((item, index) => (
            <button
              key={item.testId}
              type="button"
              role="menuitem"
              tabIndex={-1}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              className={`vs-menu__item${item.danger ? " vs-menu__item--danger" : ""}`}
              data-testid={item.testId}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
