import { CREDIT_COST_BY_LEVEL, HINT_LEVELS } from "../../lib/config";

/** Placeholder panel: no API call. The hint service (M4/M5) replaces this. */
export function HintLadderStub() {
  return (
    <section aria-labelledby="hint-heading" className="card">
      <h2 id="hint-heading">Hint ladder</h2>
      <p>Hints arrive with the hint service. You will see each cost before you spend it.</p>
      <ol style={{ listStyle: "none", padding: 0 }}>
        {HINT_LEVELS.map((name, i) => (
          <li key={name} className="rung">
            <button
              type="button"
              aria-disabled="true"
              onClick={(e) => e.preventDefault()}
              style={{ all: "unset", flex: 1, cursor: "not-allowed", outline: "revert" }}
              aria-label={`Level ${i + 1}, ${name}, ${CREDIT_COST_BY_LEVEL[i]} credits, not available yet`}
            >
              {i + 1}. {name}
            </button>
            <span>{CREDIT_COST_BY_LEVEL[i] === 0 ? "free" : `${CREDIT_COST_BY_LEVEL[i]} cr`}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
