package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port           string
	DatabaseURL    string
	JWTSecret      string
	FrontendURL    string
	AppEnv         string
	AutoMigrate    bool
	SecureCookies  bool
	CookieDomain   string
	CookieSameSite string
	JWTTTL         time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Port:           env("PORT", "8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		JWTSecret:      os.Getenv("JWT_SECRET"),
		FrontendURL:    env("FRONTEND_URL", "http://localhost:5173"),
		AppEnv:         env("APP_ENV", "development"),
		AutoMigrate:    envBool("AUTO_MIGRATE", true),
		SecureCookies:  envBool("SECURE_COOKIES", false),
		CookieDomain:   os.Getenv("COOKIE_DOMAIN"),
		CookieSameSite: strings.ToLower(env("COOKIE_SAME_SITE", "lax")),
		JWTTTL:         envDuration("JWT_TTL", 24*time.Hour),
	}

	var problems []string
	if cfg.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
	}
	if len(cfg.JWTSecret) < 32 {
		problems = append(problems, "JWT_SECRET must be at least 32 characters")
	}
	if cfg.CookieSameSite != "lax" && cfg.CookieSameSite != "strict" && cfg.CookieSameSite != "none" {
		problems = append(problems, "COOKIE_SAME_SITE must be lax, strict or none")
	}
	if len(problems) > 0 {
		return Config{}, errors.New(strings.Join(problems, "; "))
	}
	if cfg.AppEnv == "production" && !cfg.SecureCookies {
		return Config{}, fmt.Errorf("SECURE_COOKIES must be true in production")
	}
	return cfg, nil
}

func (c Config) IsProduction() bool { return c.AppEnv == "production" }

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return v
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return v
}
