package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ha-cluster/internal/api"
	"ha-cluster/internal/auth"
	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/store/postgres"
	"ha-cluster/internal/workspace"

	"github.com/google/uuid"
)

// 固定 UUID，避免开发热重载后 JWT 里的 user id 对不上 store。
var adminUserID = uuid.MustParse("00000000-0000-0000-0000-000000000009")

const defaultAdminPassword = "123456qq"

func main() {
	ctx := context.Background()
	st := openStore(ctx)
	secretStr := os.Getenv("HA_JWT_SECRET")
	if secretStr == "" {
		log.Printf("[SECURITY WARNING] HA_JWT_SECRET is unset; using insecure development default! Set HA_JWT_SECRET in production!")
		secretStr = "dev-insecure-change-me-please-32b"
	}
	secret := []byte(secretStr)
	localRt := workspace.PickRuntime()
	var rt workspace.Runtime = localRt
	if os.Getenv("HA_RUNTIME") != "memory" {
		rt = workspace.NewRemoteAgentRuntime(st, os.Getenv("HA_NODE_TOKEN"), localRt)
	}
	log.Printf("runtime=%T (fallback=%T) store=%T", rt, localRt, st)
	app := service.New(st, rt, secret)
	ensureBootstrapAdmin(app)

	bgCtx, bgCancel := context.WithCancel(context.Background())
	service.StartBackgroundTasks(bgCtx, app)

	addr := env("HA_API_ADDR", ":8080")
	srv := &http.Server{Addr: addr, Handler: api.New(app)}
	go func() {
		log.Printf("ha-api listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	<-ch
	bgCancel()
	c2, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(c2)
	if memStore, ok := st.(*memory.Store); ok {
		_ = memStore.SaveSnapshot()
	}
}

func openStore(ctx context.Context) store.Store {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		st, err := postgres.Open(ctx, dsn)
		if err != nil {
			log.Fatalf("postgres: %v", err)
		}
		log.Printf("using postgres")
		return st
	}
	snapPath := os.Getenv("HA_DEV_STORE")
	if snapPath == "" {
		snapPath = "tmp/dev-store.json"
	}
	memStore := memory.New()
	if err := memStore.LoadSnapshot(snapPath); err == nil {
		log.Printf("loaded dev store snapshot from %s", snapPath)
	}
	memStore.SetSnapshotPath(snapPath)
	log.Printf("using memory store with snapshot %s (set DATABASE_URL for postgres)", snapPath)
	return memStore
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// ensureBootstrapAdmin 保证始终有可登录的管理员：
// 1) 已有 admin 用户 → 修复角色、同步 HA_ADMIN_PASSWORD、补 token_version；
// 2) 没有任何 platform_admin → 自动创建 admin（密码 HA_ADMIN_PASSWORD，默认 123456qq）。
// 设 HA_SEED=0 可关闭自动创建（仍允许手动注册首个用户为管理员）。
func ensureBootstrapAdmin(app *service.App) {
	if os.Getenv("HA_SEED") == "0" {
		return
	}
	ctx := context.Background()
	users, err := app.Store.ListUsers(ctx)
	if err != nil {
		log.Printf("bootstrap admin: list users: %v", err)
		return
	}
	hasPlatformAdmin := false
	for _, u := range users {
		if u.PlatformRole == models.RolePlatformAdmin || u.PlatformRole == models.RolePlatformOps {
			hasPlatformAdmin = true
			break
		}
	}

	wantPass := env("HA_ADMIN_PASSWORD", defaultAdminPassword)
	u, err := app.Store.GetUserByUsername(ctx, "admin")
	if err == nil {
		changed := false
		if u.PlatformRole != models.RolePlatformAdmin {
			u.PlatformRole = models.RolePlatformAdmin
			changed = true
		}
		if u.PasswordHash == "" || !auth.VerifyPassword(wantPass, u.PasswordHash) {
			if hash, hashErr := auth.HashPassword(wantPass); hashErr == nil {
				u.PasswordHash = hash
				if u.TokenVersion < 1 {
					u.TokenVersion = 1
				} else {
					u.TokenVersion++
				}
				changed = true
				log.Printf("synced admin password from HA_ADMIN_PASSWORD")
			}
		}
		if u.TokenVersion == 0 {
			u.TokenVersion = 1
			changed = true
		}
		if changed {
			u.UpdatedAt = time.Now()
			_ = app.Store.UpdateUser(ctx, u)
		}
		return
	}

	if hasPlatformAdmin {
		return
	}

	hash, hashErr := auth.HashPassword(wantPass)
	if hashErr != nil {
		log.Printf("bootstrap admin: hash password: %v", hashErr)
		return
	}
	now := time.Now()
	admin := &models.User{
		ID:           adminUserID,
		Username:     "admin",
		Email:        "admin@mnnumath.vip",
		PasswordHash: hash,
		PlatformRole: models.RolePlatformAdmin,
		Status:       models.UserActive,
		TokenVersion: 1,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := app.Store.CreateUser(ctx, admin); err != nil {
		log.Printf("bootstrap admin: create user: %v", err)
		return
	}
	log.Printf("bootstrapped admin user (id=%s)", adminUserID)
}
