package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"time"

	"github.com/campusconnect/backend/internal/config"
	"github.com/campusconnect/backend/internal/database"
	"github.com/campusconnect/backend/seeds"
	"github.com/joho/godotenv"
)

func main() {
	skipMigrate := flag.Bool("skip-migrate", false, "Do not apply migrations before seeding")
	flag.Parse()

	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if !*skipMigrate {
		if err := database.Migrate(pool); err != nil {
			slog.Error("migrations failed", "error", err)
			os.Exit(1)
		}
	}

	slog.Warn("seeding database; existing CampusConnect data will be replaced")
	if _, err := pool.Exec(ctx, seeds.SeedSQL); err != nil {
		slog.Error("seed failed", "error", err)
		os.Exit(1)
	}
	slog.Info("database seeded successfully")
}
