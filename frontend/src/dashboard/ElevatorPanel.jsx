export default function ElevatorPanel({ floors, currentId, onSelect, onClose }) {
  return (
    <div className="cab is-dock" role="dialog" aria-label="Elevator">
      <div className="cab-head">
        <div>
          <strong>Elevator</strong>
          <p>Pick a floor. The map moves with the cab.</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close elevator">
          ×
        </button>
      </div>
      <div className="cab-floors">
        {floors.map((level) => {
          const here = level.id === currentId;
          return (
            <button
              key={level.id}
              type="button"
              className={here ? "cab-floor is-here" : "cab-floor"}
              disabled={here}
              onClick={() => onSelect(level.id)}
            >
              <span>{level.code}</span>
              <small>{level.subtitle}</small>
            </button>
          );
        })}
      </div>
      <p className="cab-note">Stairs stay on this plate. Only the elevator changes the map.</p>
    </div>
  );
}
