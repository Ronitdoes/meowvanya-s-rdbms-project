package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/campusconnect/backend/internal/auth"
	"github.com/campusconnect/backend/internal/config"
	"github.com/campusconnect/backend/internal/database"
	"github.com/campusconnect/backend/internal/server"
	"github.com/campusconnect/backend/seeds"
)

var (
	testPool *pgxpool.Pool
	testApp  *httptest.Server
)

func TestMain(m *testing.M) {
	if os.Getenv("CC_SKIP_DB_TESTS") == "1" {
		fmt.Println("CC_SKIP_DB_TESTS=1: skipping embedded PostgreSQL integration tests")
		os.Exit(m.Run())
	}

	code, err := runWithDatabase(m)
	if err != nil {
		fmt.Fprintln(os.Stderr, "integration database setup failed:", err)
		os.Exit(1)
	}
	os.Exit(code)
}

func runWithDatabase(m *testing.M) (int, error) {
	port, err := freePort()
	if err != nil {
		return 0, err
	}

	dataRoot, err := os.MkdirTemp("", "campusconnect-it-*")
	if err != nil {
		return 0, err
	}
	defer os.RemoveAll(dataRoot)

	binaries := filepath.Join(os.TempDir(), "campusconnect-embedded-pg-17")
	pg := embeddedpostgres.NewDatabase(
		embeddedpostgres.DefaultConfig().
			Version(embeddedpostgres.V17).
			Port(uint32(port)).
			BinariesPath(binaries).
			RuntimePath(filepath.Join(dataRoot, "runtime")).
			DataPath(filepath.Join(dataRoot, "data")).
			Database("campusconnect").
			Username("postgres").
			Password("postgres").
			StartTimeout(240 * time.Second),
	)
	if err := pg.Start(); err != nil {
		return 0, fmt.Errorf("start embedded postgres: %w", err)
	}
	defer func() { _ = pg.Stop() }()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	dsn := fmt.Sprintf("postgres://postgres:postgres@127.0.0.1:%d/campusconnect?sslmode=disable", port)
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return 0, fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()

	if err := database.Migrate(pool); err != nil {
		return 0, err
	}
	if _, err := pool.Exec(ctx, seeds.SeedSQL); err != nil {
		return 0, fmt.Errorf("seed: %w", err)
	}

	cfg := config.Config{
		AppEnv:         "test",
		FrontendURL:    "",
		SecureCookies:  false,
		CookieSameSite: "lax",
		JWTTTL:         time.Hour,
	}
	deps := server.Deps{
		DB:        pool,
		Config:    cfg,
		Auth:      auth.NewManager(strings.Repeat("integration-secret-", 3), time.Hour),
		Validator: validator.New(),
	}
	testPool = pool
	testApp = httptest.NewServer(server.NewRouter(deps))
	defer testApp.Close()

	return m.Run(), nil
}

func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func mustURL(raw string) *url.URL {
	parsed, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return parsed
}

func resetSeed(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := testPool.Exec(ctx, seeds.SeedSQL); err != nil {
		t.Fatalf("reset seed: %v", err)
	}
}

type apiClient struct {
	t    *testing.T
	http *http.Client
}

func newClient(t *testing.T) *apiClient {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	return &apiClient{
		t: t,
		http: &http.Client{
			Jar:     jar,
			Timeout: 30 * time.Second,
		},
	}
}

func (c *apiClient) csrfToken() string {
	cookies := c.http.Jar.Cookies(mustURL(testApp.URL))
	for _, cookie := range cookies {
		if cookie.Name == auth.CSRFCookieName {
			return cookie.Value
		}
	}
	return ""
}

func (c *apiClient) do(method, path string, body any, headers map[string]string) (int, []byte) {
	c.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			c.t.Fatalf("marshal request: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, testApp.URL+path, reader)
	if err != nil {
		c.t.Fatalf("build request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	if method != http.MethodGet && method != http.MethodHead && headers[auth.CSRFHeaderName] == "" && c.csrfToken() != "" {
		req.Header.Set(auth.CSRFHeaderName, c.csrfToken())
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(res.Body)
	if err != nil {
		c.t.Fatalf("read response: %v", err)
	}
	return res.StatusCode, payload
}

func (c *apiClient) get(path string) (int, []byte) {
	return c.do(http.MethodGet, path, nil, nil)
}

func (c *apiClient) post(path string, body any) (int, []byte) {
	return c.do(http.MethodPost, path, body, nil)
}

func (c *apiClient) patch(path string, body any) (int, []byte) {
	return c.do(http.MethodPatch, path, body, nil)
}

func (c *apiClient) delete(path string) (int, []byte) {
	return c.do(http.MethodDelete, path, nil, nil)
}

func (c *apiClient) login(email, password string) map[string]any {
	c.t.Helper()
	status, payload := c.post("/api/v1/auth/login", map[string]any{
		"email":    email,
		"password": password,
	})
	if status != http.StatusOK {
		c.t.Fatalf("login %s: status %d body %s", email, status, payload)
	}
	user := decodeData[map[string]any](c.t, payload)
	if c.csrfToken() == "" {
		c.t.Fatalf("login %s set no csrf cookie: %s", email, payload)
	}
	return user
}

func decodeData[T any](t *testing.T, payload []byte) T {
	t.Helper()
	var envelope struct {
		Data T `json:"data"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode data: %v (body %s)", err, payload)
	}
	return envelope.Data
}

func decodeDataWithMeta[T any](t *testing.T, payload []byte) (T, map[string]any) {
	t.Helper()
	var envelope struct {
		Data T              `json:"data"`
		Meta map[string]any `json:"meta"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode data: %v (body %s)", err, payload)
	}
	return envelope.Data, envelope.Meta
}

func expectStatus(t *testing.T, status int, expected int, payload []byte) {
	t.Helper()
	if status != expected {
		t.Fatalf("expected status %d, got %d: %s", expected, status, payload)
	}
}

func expectErrorCode(t *testing.T, payload []byte, code string) {
	t.Helper()
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("decode error: %v (body %s)", err, payload)
	}
	if envelope.Error.Code != code {
		t.Fatalf("expected error code %q, got %q (%s)", code, envelope.Error.Code, payload)
	}
}
