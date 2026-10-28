/** El recorrido en miniatura: ● INICIO ━━▶ FINAL ●, con el color del trazo. */
export function RouteLine() {
  return (
    <span className="rline" aria-hidden="true">
      <i className="rline-dot start" />
      <i className="rline-bar" />
      <i className="rline-dot end" />
    </span>
  );
}
