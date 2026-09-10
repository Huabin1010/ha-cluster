package bastion

import (
	"errors"
	"strings"

	"github.com/google/uuid"

	"ha-cluster/internal/authz"
	"ha-cluster/internal/models"
)

var (
	ErrDenied  = errors.New("ssh denied")
	ErrOffline = errors.New("workspace not running")
)

type Target struct {
	Host string
	Port int
	Via  string // fabric | lan | breakglass
}

// Resolve picks dial target after authz.CanSSHSession.
func Resolve(w models.Workspace, n models.Node, actor models.User, m *models.Membership) (Target, error) {
	if w.Status != models.WSRunning && w.Status != models.WSDegraded {
		return Target{}, ErrOffline
	}
	if !authz.CanSSHSession(actor, m, w) {
		return Target{}, ErrDenied
	}
	if n.FabricIP != "" {
		return Target{Host: n.FabricIP, Port: w.SSHPort, Via: "fabric"}, nil
	}
	if n.LanIP != "" {
		return Target{Host: n.LanIP, Port: w.SSHPort, Via: "lan"}, nil
	}
	if n.BreakglassSSH != "" {
		host, port := parseHostPort(n.BreakglassSSH, 22)
		return Target{Host: host, Port: port, Via: "breakglass"}, nil
	}
	return Target{}, ErrOffline
}

func CanEnterPrivate(w models.Workspace, actorUserID string, ownerUserID string, role string, admin bool) bool {
	if admin {
		return true
	}
	if actorUserID == ownerUserID {
		return true
	}
	aid, _ := uuid.Parse(actorUserID)
	return authz.CanEnterPrivateWorkspace(w, aid, role, admin)
}

func parseHostPort(s string, def int) (string, int) {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, ":"); i > 0 {
		var p int
		for _, c := range s[i+1:] {
			if c < '0' || c > '9' {
				return s, def
			}
			p = p*10 + int(c-'0')
		}
		if p > 0 {
			return s[:i], p
		}
	}
	return s, def
}
