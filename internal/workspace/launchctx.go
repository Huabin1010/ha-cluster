package workspace

import (
	"context"

	"ha-cluster/internal/models"
)

type launchCtxKey struct{}

// LaunchContext 经 context 传入 Launch（SSH 公钥 + 自动注入的镜像仓库凭证）。
type LaunchContext struct {
	SSHKeys          []string
	DockerRegistries []models.DockerRegistryCred
}

func WithLaunchContext(ctx context.Context, lc LaunchContext) context.Context {
	return context.WithValue(ctx, launchCtxKey{}, lc)
}

func LaunchContextFrom(ctx context.Context, sshKeys []string) LaunchContext {
	if v, ok := ctx.Value(launchCtxKey{}).(LaunchContext); ok {
		if len(v.SSHKeys) == 0 {
			v.SSHKeys = sshKeys
		}
		return v
	}
	return LaunchContext{SSHKeys: sshKeys}
}
