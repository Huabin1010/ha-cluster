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

var AdminUserID = uuid.MustParse("00000000-0000-0000-0000-000000000009")

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
	seedDemo(app)

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

func seedDemo(app *service.App) {
	if os.Getenv("HA_SEED") == "0" {
		return
	}
	ctx := context.Background()
	const Gi = int64(1024 * 1024 * 1024)
	_ = app.Store.UpsertNode(ctx, &models.Node{
		ID: uuid.MustParse("00000000-0000-0000-0000-000000000001"),
		Name: "dev-pc", Arch: models.ArchAMD64, Class: "desktop", Power: "mains", Role: "worker",
		FabricIP: "10.88.0.30", AllocatableCPU: 8000, AllocatableMem: 8 * Gi, AllocatableDisk: 200 * Gi,
		Ready: true, LastHeartbeat: time.Now(),
	})
	_ = app.Store.UpsertNode(ctx, &models.Node{
		ID: uuid.MustParse("00000000-0000-0000-0000-000000000002"),
		Name: "phone1", Arch: models.ArchARM64, Class: "phone", Power: "battery", Role: "worker",
		FabricIP: "10.88.0.10", AllocatableCPU: 2000, AllocatableMem: 1800 * 1024 * 1024, AllocatableDisk: 40 * Gi,
		Ready: true, LastHeartbeat: time.Now(),
	})

	// 确保 admin 用户具有固定确定性的 UUID，避免开发热重载或服务重启时随机生成新 UUID，
	// 导致前端持有旧有效 JWT 时被判定用户不存在（401）而强制退出登录。
	u, err := app.Store.GetUserByUsername(ctx, "admin")
	if err != nil {
		hash, hashErr := auth.HashPassword(env("HA_ADMIN_PASSWORD", "adminadmin"))
		if hashErr == nil {
			u = &models.User{
				ID:           AdminUserID,
				Username:     "admin",
				Email:        "admin@mnnumath.vip",
				PasswordHash: hash,
				PlatformRole: models.RolePlatformAdmin,
				Status:       models.UserActive,
				TokenVersion: 1,
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
			if err := app.Store.CreateUser(ctx, u); err == nil {
				log.Printf("seeded admin with fixed uuid: %s", AdminUserID)
			}
		}
	} else if u.PlatformRole != models.RolePlatformAdmin {
		u.PlatformRole = models.RolePlatformAdmin
		_ = app.Store.UpdateUser(ctx, u)
	}
}
