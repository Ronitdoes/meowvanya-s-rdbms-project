package tests

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestEmbeddedPostgresBootstrap verifies that the embedded test database can
// start on this machine. It is skipped in short mode.
func TestEmbeddedPostgresBootstrap(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping embedded postgres in short mode")
	}

	root := t.TempDir()
	port := 55432
	pg := embeddedpostgres.NewDatabase(
		embeddedpostgres.DefaultConfig().
			Version(embeddedpostgres.V17).
			Port(uint32(port)).
			RuntimePath(filepath.Join(root, "runtime")).
			DataPath(filepath.Join(root, "data")).
			BinariesPath(filepath.Join(root, "bin")).
			Database("campusconnect").
			Username("postgres").
			Password("postgres").
			StartTimeout(180 * time.Second).
			Logger(os.Stdout),
	)
	if err := pg.Start(); err != nil {
		t.Fatalf("start embedded postgres: %v", err)
	}
	t.Cleanup(func() { _ = pg.Stop() })

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, fmt.Sprintf("postgres://postgres:postgres@localhost:%d/campusconnect?sslmode=disable", port))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	var version string
	if err := pool.QueryRow(ctx, "SELECT version()").Scan(&version); err != nil {
		t.Fatalf("query version: %v", err)
	}
	t.Logf("connected to %s", version)
}
