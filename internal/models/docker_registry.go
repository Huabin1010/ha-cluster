package models

import (
	"time"

	"github.com/google/uuid"
)

// DockerRegistry — 平台级镜像仓库凭证（仅 platform_admin 管理）。
type DockerRegistry struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Server       string    `json:"server"`
	Username     string    `json:"username"`
	PasswordEnc  string    `json:"-"`
	AutoInject   bool      `json:"auto_inject"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// DockerRegistryCred — 下发给 agent 解密后的凭证（不入库 JSON）。
type DockerRegistryCred struct {
	Server   string `json:"server"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// DockerRegistryPublic — API 列表响应（不含密码）。
type DockerRegistryPublic struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Server     string    `json:"server"`
	Username   string    `json:"username"`
	AutoInject bool      `json:"auto_inject"`
	HasSecret  bool      `json:"has_secret"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (r DockerRegistry) Public() DockerRegistryPublic {
	return DockerRegistryPublic{
		ID: r.ID, Name: r.Name, Server: r.Server, Username: r.Username,
		AutoInject: r.AutoInject, HasSecret: r.PasswordEnc != "",
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
