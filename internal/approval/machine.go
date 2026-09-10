package approval

import "fmt"

// NextAfterProjectApprove returns next phase after project admin approves.
func NextAfterProjectApprove(kind Kind) (ProjectPhase, error) {
	switch LevelForKind(kind) {
	case LevelSafe:
		return PhaseApprovedProject, nil
	case LevelDangerous:
		return PhasePendingPlatform, nil
	default:
		return "", fmt.Errorf("unknown kind")
	}
}

// CanProjectApprove returns whether project admin may act on current phase.
func CanProjectApprove(phase ProjectPhase, kind Kind) bool {
	if phase == PhaseRejected || phase == PhaseDone {
		return false
	}
	switch LevelForKind(kind) {
	case LevelSafe:
		return phase == PhasePendingProject || phase == ""
	case LevelDangerous:
		return phase == PhasePendingProject || phase == ""
	default:
		return false
	}
}

// CanPlatformApprove returns whether platform may finalize dangerous ops.
func CanPlatformApprove(phase ProjectPhase, kind Kind) bool {
	return LevelForKind(kind) == LevelDangerous && phase == PhasePendingPlatform
}

// InitialPhase for a new request.
func InitialPhase(kind Kind) ProjectPhase {
	return PhasePendingProject
}

// ValidateTransition checks project-phase transitions.
func ValidateTransition(from, to ProjectPhase) error {
	if from == to {
		return nil
	}
	allowed := map[ProjectPhase][]ProjectPhase{
		PhaseNone:            {PhasePendingProject},
		PhasePendingProject:  {PhaseApprovedProject, PhasePendingPlatform, PhaseRejected},
		PhaseApprovedProject: {PhaseDone},
		PhasePendingPlatform: {PhaseDone, PhaseRejected},
	}
	for _, ok := range allowed[from] {
		if ok == to {
			return nil
		}
	}
	return fmt.Errorf("invalid transition %s -> %s", from, to)
}
