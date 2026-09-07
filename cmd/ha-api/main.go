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
	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/store/postgres"
	"ha-cluster/internal/workspace"

	"github.com/google/uuid"
)

func main() {
	ctx := context.Background()
	st := openStore(ctx)
	secretStr := os.Getenv("HA_JWT_SECRET")
	if secretStr == "" {
		log.Printf("[SECURITY WARNING] HA_JWT_SECRET is unset; using insecure development default! Set HA_JWT_SECRET in production!")
		secretStr = "dev-insecure-change-me-please-32b"
	}
	secret := []byte(secretStr)
	rt := workspace.PickRuntime()
	log.Printf("runtime=%T store=%T", rt, st)
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
	log.Printf("using memory store (set DATABASE_URL for postgres)")
	return memory.New()
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
	u, err := app.Register(ctx, "admin", "admin@mnnumath.vip", env("HA_ADMIN_PASSWORD", "adminadmin"))
	if err == nil {
		u.PlatformRole = models.RolePlatformAdmin
		_ = app.Store.UpdateUser(ctx, u)
		log.Printf("seeded admin")
	}
}
