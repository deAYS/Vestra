interface Props {
  label: string;
  onClick(): void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  testId?: string;
}

export function OperationButton({
  label,
  onClick,
  disabled,
  variant,
  testId,
}: Props): JSX.Element {
  return (
    <button
      type="button"
      className={`vs-btn vs-btn--${variant ?? "secondary"}`}
      onClick={onClick}
      disabled={disabled === true}
      data-testid={testId}
    >
      {label}
    </button>
  );
}
