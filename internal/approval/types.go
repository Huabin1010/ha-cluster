package approval

// Kind classifies approval requests.
type Kind string

const (
	KindWorkspaceCreate Kind = "workspace_create"
	KindWorkspaceResize Kind = "workspace_resize"
	KindWorkspaceDestroy Kind = "workspace_destroy"
	KindSSHAccess       Kind = "ssh_access"
)

// Level determines approval chain depth.
type Level string

const (
	LevelSafe      Level = "safe"      // project admin final
	LevelDangerous Level = "dangerous" // project then platform
)

func LevelForKind(k Kind) Level {
	switch k {
	case KindWorkspaceDestroy:
		return LevelDangerous
	default:
		return LevelSafe
	}
}

// ProjectPhase after project-side decision.
type ProjectPhase string

const (
	PhaseNone              ProjectPhase = ""
	PhasePendingProject    ProjectPhase = "pending_project"
	PhaseApprovedProject   ProjectPhase = "approved_project"
	PhasePendingPlatform   ProjectPhase = "pending_platform"
	PhaseRejected          ProjectPhase = "rejected"
	PhaseDone              ProjectPhase = "done"
)
