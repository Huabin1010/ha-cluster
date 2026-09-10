package authz

import "ha-cluster/internal/models"

func IsPlatformAdmin(u models.User) bool {
	return u.PlatformRole == models.RolePlatformAdmin
}

func IsPlatformStaff(u models.User) bool {
	return u.PlatformRole == models.RolePlatformAdmin || u.PlatformRole == models.RolePlatformOps
}

func CanManageNodes(u models.User) bool {
	return IsPlatformStaff(u)
}

func CanApproveDangerousOps(u models.User) bool {
	return u.PlatformRole == models.RolePlatformAdmin
}
