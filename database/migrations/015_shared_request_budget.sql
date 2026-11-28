CREATE TABLE IF NOT EXISTS lolo_shared_request_budget (
 bucket TEXT PRIMARY KEY CHECK(bucket IN ('paid-minute','paid-day','login-minute')),
 window_start TIMESTAMPTZ NOT NULL,
 used INTEGER NOT NULL CHECK(used>=0)
);
